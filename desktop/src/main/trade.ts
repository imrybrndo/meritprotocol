/**
 * Order placement on Hyperliquid.
 *
 * This is the only module in the console that can move money. Three rules hold
 * it in place:
 *
 *  1. Signing is delegated. Hyperliquid's L1 actions are msgpack-hashed into an
 *     EIP-712 "phantom agent" struct, and their own documentation tells you not
 *     to reimplement it — a mismatch does not fail loudly, it fails at the point
 *     where you have signed something other than what you meant. The SDK owns
 *     that; this file owns intent.
 *  2. The key never leaves the main process. The renderer sends an intent and
 *     receives a result; it cannot sign, and cannot read the key that does.
 *  3. Nothing is placed that the operator did not explicitly confirm, and every
 *     order is sealed on MERIT first — see main.ts. A commitment written after
 *     the fill proves nothing, which is the whole premise of the product.
 *
 * There is no testnet switch: this is mainnet, by the operator's decision.
 */

import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { signer } from "./wallet";
import { assetIndex, listMarkets } from "./hyperliquid";

const transport = new HttpTransport();
const infoClient = new InfoClient({ transport });

export interface AccountState {
  address: string;
  /** Total account value in USDC, as Hyperliquid marks it. */
  accountValue: number;
  withdrawable: number;
  /** Margin already committed to open positions. */
  marginUsed: number;
  funded: boolean;
  positions: Array<{
    symbol: string;
    /** Signed: negative is short. */
    size: number;
    entryPrice: number | null;
    positionValue: number;
    unrealizedPnl: number;
    leverage: number | null;
    liquidationPrice: number | null;
  }>;
}

const num = (value: string | number | undefined | null): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * What Hyperliquid knows about an address.
 *
 * There is no registration step to check for: every EVM address is already an
 * account, and the only question that matters is whether it holds collateral.
 */
export async function accountState(address: string): Promise<AccountState> {
  const state = await infoClient.clearinghouseState({ user: address as `0x${string}` });
  const summary = state.marginSummary;

  return {
    address,
    accountValue: num(summary?.accountValue),
    withdrawable: num(state.withdrawable),
    marginUsed: num(summary?.totalMarginUsed),
    funded: num(summary?.accountValue) > 0,
    positions: (state.assetPositions ?? [])
      .map((entry) => entry.position)
      .filter((position) => num(position.szi) !== 0)
      .map((position) => ({
        symbol: position.coin,
        size: num(position.szi),
        entryPrice: position.entryPx ? num(position.entryPx) : null,
        positionValue: num(position.positionValue),
        unrealizedPnl: num(position.unrealizedPnl),
        leverage: position.leverage ? num(position.leverage.value) : null,
        liquidationPrice: position.liquidationPx ? num(position.liquidationPx) : null,
      })),
  };
}

export interface OrderIntent {
  symbol: string;
  side: "long" | "short";
  /** Size in the base asset. */
  size: number;
  /** Absent for a market order. */
  limitPrice?: number;
  reduceOnly?: boolean;
}

export interface OrderReceipt {
  status: "filled" | "resting" | "unknown";
  /** Average fill price, when it filled. */
  price: number | null;
  size: number | null;
  orderId: number | null;
  raw: unknown;
}

/**
 * Hyperliquid has no market order: a "market" order is an IOC limit priced far
 * enough through the book to cross it. The 3% cap is the slippage the operator
 * is accepting by not naming a price — wide enough to cross a normal book,
 * narrow enough that a dislocated one rejects instead of filling anywhere.
 */
const MARKET_SLIPPAGE = 0.03;

function roundPrice(price: number): string {
  // Hyperliquid takes at most 5 significant figures on a perp price.
  return Number(price.toPrecision(5)).toString();
}

export async function placeOrder(intent: OrderIntent): Promise<OrderReceipt> {
  const wallet = signer();
  const client = new ExchangeClient({ transport, wallet });

  const [index, markets] = await Promise.all([assetIndex(intent.symbol), listMarkets()]);
  if (!markets.some((market) => market.symbol === intent.symbol)) {
    throw new Error(`${intent.symbol} is not a market on this venue.`);
  }

  const isBuy = intent.side === "long";
  let price = intent.limitPrice;

  if (price === undefined) {
    // Cross the book from the current mark rather than guess a price.
    const [, assetCtxs] = await infoClient.metaAndAssetCtxs();
    // Same index the order carries: the contexts are aligned to the full
    // universe, not to the filtered market list.
    const mark = num(assetCtxs[index]?.markPx);
    if (mark <= 0) throw new Error(`No mark price for ${intent.symbol} right now.`);
    price = isBuy ? mark * (1 + MARKET_SLIPPAGE) : mark * (1 - MARKET_SLIPPAGE);
  }

  const response = await client.order({
    orders: [
      {
        a: index,
        b: isBuy,
        p: roundPrice(price),
        s: String(intent.size),
        r: intent.reduceOnly ?? false,
        // IOC for a market order so it never rests at the slippage cap; GTC for
        // a limit order the operator priced themselves.
        t: { limit: { tif: intent.limitPrice === undefined ? "Ioc" : "Gtc" } },
      },
    ],
    grouping: "na",
  });

  const status = response.response?.data?.statuses?.[0] as
    | { filled?: { avgPx: string; totalSz: string; oid: number }; resting?: { oid: number }; error?: string }
    | undefined;

  if (status?.error) throw new Error(status.error);

  if (status?.filled) {
    return {
      status: "filled",
      price: num(status.filled.avgPx),
      size: num(status.filled.totalSz),
      orderId: status.filled.oid,
      raw: response,
    };
  }
  if (status?.resting) {
    return { status: "resting", price: price ?? null, size: intent.size, orderId: status.resting.oid, raw: response };
  }
  return { status: "unknown", price: null, size: null, orderId: null, raw: response };
}

export async function setLeverage(symbol: string, leverage: number): Promise<void> {
  const wallet = signer();
  const client = new ExchangeClient({ transport, wallet });
  await client.updateLeverage({
    asset: await assetIndex(symbol),
    isCross: true,
    leverage: Math.max(1, Math.round(leverage)),
  });
}

/**
 * Proves the signing path works without risking anything: cancelling an order
 * id that cannot exist is authenticated the same way an order is, but has
 * nothing to cancel. A signature problem answers differently from "no such
 * order", which is the distinction being checked.
 */
export type SigningCheck =
  | { result: "authenticated"; detail: string }
  | { result: "unfunded"; detail: string }
  | { result: "rejected"; detail: string };

export async function verifySigning(): Promise<SigningCheck> {
  const wallet = signer();
  const client = new ExchangeClient({ transport, wallet });

  try {
    await client.cancel({ cancels: [{ a: 0, o: 1 }] });
    return { result: "authenticated", detail: "The venue accepted the request." };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    // An address with no collateral is not an account here at all, and the
    // exchange refuses it before it ever considers the signature. Reporting
    // that as a signing failure would be a lie about which thing is wrong.
    if (/does not exist/i.test(detail)) {
      return {
        result: "unfunded",
        detail: "This address holds no collateral yet, so Hyperliquid has no account for it to check.",
      };
    }
    if (/never placed|already canceled|already cancelled|filled/i.test(detail)) {
      return {
        result: "authenticated",
        detail: "The venue authenticated the request and found nothing to cancel.",
      };
    }
    return { result: "rejected", detail };
  }
}
