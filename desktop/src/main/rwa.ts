/**
 * Tokenized real-world assets, read from the chain itself.
 *
 * Every figure this module reports is an `eth_call` an operator could repeat:
 * supply comes from the token contract, the gold price from a Chainlink feed,
 * and each response carries the block it was read at. Nothing here consults a
 * vendor's dashboard, because a reputation protocol that displayed unverifiable
 * AUM numbers would be arguing against itself.
 *
 * That principle also sets what is *not* shown. A fund whose NAV is not
 * published on chain gets a supply and no dollar value, rather than a plausible
 * figure sourced from a press release — see `Denomination` below.
 *
 * Lives in the main process for the same reason the venue clients do: the
 * renderer's CSP blocks it from the network entirely, so every outbound request
 * crosses the IPC bridge and is auditable in one place.
 */

import { Contract, JsonRpcProvider } from "ethers";
import { inlineImage, mapLimited } from "./logos";

/** Same public endpoints the wallet balance check uses; first one to answer wins. */
const RPC_URLS = ["https://ethereum-rpc.publicnode.com", "https://1rpc.io/eth"];

const ERC20 = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
];

const CHAINLINK = [
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function decimals() view returns (uint8)",
];

/** Chainlink XAU/USD on Ethereum — one troy ounce, which is what the gold tokens hold. */
const XAU_USD = "0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6";

export type AssetClass = "treasury" | "credit" | "commodity";

/**
 * What one token is a claim on, which decides whether a dollar value can be
 * stated at all:
 *
 *  - `usd-par` — the instrument holds its unit at one dollar by construction,
 *    accruing yield by minting or rebasing. Supply therefore *is* the dollar
 *    figure, and it is labelled as resting on that design rather than on a
 *    price that was read.
 *  - `share`  — the unit is a fund share whose NAV moves and is published off
 *    chain. Supply is real; the dollar value is not knowable from here, so none
 *    is shown.
 *  - `ounce`  — one fine troy ounce, priced by the Chainlink feed above.
 */
export type Denomination = "usd-par" | "share" | "ounce";

export interface RwaInstrument {
  symbol: string;
  name: string;
  issuer: string;
  assetClass: AssetClass;
  denomination: Denomination;
  address: string;
  /** One line on what the holder actually owns. Shown beside the numbers. */
  note: string;
}

/**
 * The registry.
 *
 * Every address here was read on Ethereum mainnet before it was added, and the
 * symbol the contract reports is checked against the symbol below on every
 * refresh — a registry that silently pointed at the wrong contract would be the
 * one failure mode this panel cannot have. Instruments whose address could not
 * be confirmed were left out rather than guessed at.
 */
const INSTRUMENTS: RwaInstrument[] = [
  {
    symbol: "BUIDL",
    name: "BlackRock USD Institutional Digital Liquidity Fund",
    issuer: "BlackRock · Securitize",
    assetClass: "treasury",
    denomination: "usd-par",
    address: "0x7712c34205737192402172409a8F7ccef8aA2AEc",
    note: "Cash, US Treasury bills and repo. Share price held at $1; yield accrues as new tokens.",
  },
  {
    symbol: "USDY",
    name: "Ondo U.S. Dollar Yield",
    issuer: "Ondo Finance",
    assetClass: "treasury",
    denomination: "share",
    address: "0x96F6eF951840721AdBF46Ac996b59E0235CB985C",
    note: "Short-term Treasuries and bank demand deposits. The token price accrues above $1.",
  },
  {
    symbol: "OUSG",
    name: "Ondo Short-Term U.S. Government Bond Fund",
    issuer: "Ondo Finance",
    assetClass: "treasury",
    denomination: "share",
    address: "0x1B19C19393e2d034D8Ff31ff34c81252FcBbee92",
    note: "Short-duration US government bonds, held largely through BUIDL.",
  },
  {
    symbol: "USTB",
    name: "Invesco Short Duration US Government Securities Fund",
    issuer: "Invesco · Superstate",
    assetClass: "treasury",
    denomination: "share",
    address: "0x43415eB6ff9DB7E26A15b704e7A3eDCe97d31C4e",
    note: "A registered fund with the shareholder register kept on chain.",
  },
  {
    symbol: "TBILL",
    name: "OpenEden T-Bills",
    issuer: "OpenEden",
    assetClass: "treasury",
    denomination: "share",
    address: "0xdd50C053C096CB04A3e3362E2b622529EC5f2e8a",
    note: "Short-dated US Treasury bills and reverse repo, rated by Moody's.",
  },
  {
    symbol: "STBT",
    name: "Short-term Treasury Bill Token",
    issuer: "Matrixdock",
    assetClass: "treasury",
    denomination: "usd-par",
    address: "0x530824DA86689C9C17CdC2871Ff29B058345b44a",
    note: "Treasury bills and repo, rebasing daily to hold the unit at $1.",
  },
  {
    symbol: "USDM",
    name: "Mountain Protocol USD",
    issuer: "Mountain Protocol",
    assetClass: "treasury",
    denomination: "usd-par",
    address: "0x59D9356E565Ab3A36dD77763Fc0d87fEaf85508C",
    note: "A yield-bearing dollar backed by short-term Treasuries; rebases to hold $1.",
  },
  {
    symbol: "bIB01",
    name: "Backed IB01 $ Treasury Bond 0-1yr",
    issuer: "Backed Finance",
    assetClass: "treasury",
    denomination: "share",
    address: "0xCA30c93B02514f86d5C86a6e375E3A330B435Fb5",
    note: "A tokenized share of the iShares $ Treasury Bond 0-1yr UCITS ETF.",
  },
  {
    symbol: "FIDU",
    name: "Goldfinch Senior Pool",
    issuer: "Goldfinch",
    assetClass: "credit",
    denomination: "share",
    address: "0x6a445E9F40e0b97c92d0b8a3366cEF1d67F700BF",
    note: "A senior claim on private credit lent to off-chain borrowers. Illiquid, and not principal-protected.",
  },
  {
    symbol: "PAXG",
    name: "Paxos Gold",
    issuer: "Paxos",
    assetClass: "commodity",
    denomination: "ounce",
    address: "0x45804880De22913dAFE09f4980848ECE6EcbAf78",
    note: "One fine troy ounce of London Good Delivery gold per token, held in vault.",
  },
  {
    symbol: "XAUT",
    name: "Tether Gold",
    issuer: "Tether",
    assetClass: "commodity",
    denomination: "ounce",
    address: "0x68749665FF8D2d112Fa859AA293F07A622782F38",
    note: "One fine troy ounce of gold per token, held in Switzerland.",
  },
];

export const ASSET_CLASSES: Record<AssetClass, string> = {
  treasury: "Treasuries & cash",
  credit: "Private credit",
  commodity: "Commodities",
};

/** How a dollar figure was arrived at, so the interface can say which it is. */
export type ValueBasis = "oracle" | "par";

export interface RwaReading extends RwaInstrument {
  decimals: number | null;
  /** Supply in token units. Null when the read failed. */
  supply: number | null;
  /** Dollars, only where derivable from this machine. Null is a real answer. */
  value: number | null;
  valueBasis: ValueBasis | null;
  /** What the contract itself answers to `symbol()`, checked against `symbol`. */
  onChainSymbol: string | null;
  /** Why this one row is empty, while the rest of the panel still works. */
  error: string | null;
}

export interface GoldPrice {
  usdPerOunce: number;
  updatedAt: string;
  feed: string;
}

export interface RwaSnapshot {
  chain: string;
  /** Host only: the operator should be able to see which endpoint answered. */
  source: string;
  block: number;
  readAt: string;
  gold: GoldPrice | null;
  instruments: RwaReading[];
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * A provider that answers. Public endpoints rate-limit and occasionally drop
 * requests, and a panel that goes blank because one host is having a bad minute
 * is worse than one that quietly used the other.
 */
async function connect(): Promise<{ provider: JsonRpcProvider; url: string; block: number }> {
  const failures: string[] = [];

  for (const url of RPC_URLS) {
    try {
      const provider = new JsonRpcProvider(url, undefined, { staticNetwork: true });
      const block = await provider.getBlockNumber();
      return { provider, url, block };
    } catch (error) {
      failures.push(`${host(url)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(
    `No Ethereum endpoint answered, so nothing could be read on chain. Tried ${failures.join("; ")}.`,
  );
}

async function readGold(provider: JsonRpcProvider): Promise<GoldPrice | null> {
  try {
    const feed = new Contract(XAU_USD, CHAINLINK, provider);
    const [, answer, , updatedAt] = (await feed.latestRoundData()) as [
      bigint, bigint, bigint, bigint, bigint,
    ];
    const decimals = Number((await feed.decimals()) as bigint);

    return {
      usdPerOunce: Number(answer) / 10 ** decimals,
      updatedAt: new Date(Number(updatedAt) * 1000).toISOString(),
      feed: XAU_USD,
    };
  } catch {
    // The gold tokens then report supply without a value, which is the honest
    // outcome — the alternative is pricing an ounce from memory.
    return null;
  }
}

async function readInstrument(
  provider: JsonRpcProvider,
  instrument: RwaInstrument,
  gold: GoldPrice | null,
): Promise<RwaReading> {
  const empty = {
    ...instrument,
    decimals: null,
    supply: null,
    value: null,
    valueBasis: null,
    onChainSymbol: null,
  };

  try {
    const token = new Contract(instrument.address, ERC20, provider);
    const [onChainSymbol, decimals, supplyRaw] = await Promise.all([
      token.symbol() as Promise<string>,
      token.decimals() as Promise<bigint>,
      token.totalSupply() as Promise<bigint>,
    ]);

    const places = Number(decimals);
    const supply = Number(supplyRaw) / 10 ** places;

    // The registry claiming one instrument while the chain answers with another
    // is the one error that would make every number on the row a lie.
    if (onChainSymbol.toLowerCase() !== instrument.symbol.toLowerCase()) {
      return {
        ...empty,
        onChainSymbol,
        error:
          `The contract at this address reports ${onChainSymbol}, not ${instrument.symbol}. ` +
          "Nothing is shown for it until the registry is corrected.",
      };
    }

    const value =
      instrument.denomination === "usd-par"
        ? supply
        : instrument.denomination === "ounce" && gold
          ? supply * gold.usdPerOunce
          : null;

    return {
      ...instrument,
      decimals: places,
      supply,
      value,
      valueBasis: value === null ? null : instrument.denomination === "ounce" ? "oracle" : "par",
      onChainSymbol,
      error: null,
    };
  } catch (error) {
    return {
      ...empty,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Cached briefly. The panel refreshes on every visit and supply moves on the
 * order of hours, so re-reading eleven contracts per navigation would spend an
 * operator's rate limit on numbers that cannot have changed.
 */
let cached: { at: number; snapshot: RwaSnapshot } | null = null;
const TTL_MS = 60_000;

export async function snapshot(force = false): Promise<RwaSnapshot> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.snapshot;

  const { provider, url, block } = await connect();
  const gold = await readGold(provider);
  const instruments = await Promise.all(
    INSTRUMENTS.map((instrument) => readInstrument(provider, instrument, gold)),
  );

  const snapshot: RwaSnapshot = {
    chain: "Ethereum",
    source: host(url),
    block,
    readAt: new Date().toISOString(),
    gold,
    instruments,
  };

  cached = { at: Date.now(), snapshot };
  return snapshot;
}

/* ------------------------------------------------------------------ logos -- */

/**
 * Issuer artwork, keyed by the contract address it belongs to.
 *
 * The list is CoinGecko's Ethereum token list — one request that covers every
 * instrument at once, and keyed by address rather than by ticker, so a logo
 * cannot be attached to the wrong token by a symbol collision. Nine of the
 * eleven instruments are in it; the other two fall back to a monogram, which is
 * why nothing below treats a miss as an error.
 *
 * Icons are decoration. If this whole function fails, the panel still shows
 * every number it read from the chain.
 */
const TOKEN_LIST = "https://tokens.coingecko.com/ethereum/all.json";

let logoCache: Record<string, string> | null = null;

export async function logos(): Promise<Record<string, string>> {
  if (logoCache) return logoCache;

  const sources = new Map<string, string>();
  try {
    const response = await fetch(TOKEN_LIST, { headers: { accept: "application/json" } });
    if (response.ok) {
      const payload = (await response.json()) as {
        tokens?: Array<{ address?: string; logoURI?: string }>;
      };
      for (const token of payload.tokens ?? []) {
        if (token.address && token.logoURI) {
          sources.set(token.address.toLowerCase(), token.logoURI);
        }
      }
    }
  } catch {
    // No list, no icons. Every row still has its monogram.
  }

  const wanted = INSTRUMENTS.map((instrument) => ({
    symbol: instrument.symbol,
    url: sources.get(instrument.address.toLowerCase()),
  })).filter((entry): entry is { symbol: string; url: string } => Boolean(entry.url));

  const fetched = await mapLimited(wanted, 6, (entry) => inlineImage(entry.url, "image/png"));

  const map: Record<string, string> = {};
  wanted.forEach((entry, index) => {
    const uri = fetched[index];
    if (uri) map[entry.symbol] = uri;
  });

  logoCache = map;
  return map;
}

/** The registry itself, for callers that need the list without a network read. */
export function instruments(): RwaInstrument[] {
  return INSTRUMENTS.map((instrument) => ({ ...instrument }));
}
