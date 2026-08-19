/**
 * Funding the venue account.
 *
 * Hyperliquid's bridge credits **the address that sent the USDC**. That single
 * fact decides the whole flow: the operator cannot fund this wallet's venue
 * account by withdrawing from an exchange to the bridge, because the exchange's
 * address would be credited instead. The USDC has to arrive at this address
 * first, and then be forwarded from here.
 *
 * Which is why this module exists at all. The key lives only inside this app,
 * so without a deposit action the operator would have to export it into a
 * browser wallet to complete a step the app is already holding the key for.
 *
 * Below the minimum the bridge does not refund — it keeps the deposit. That is
 * enforced here rather than left to the operator to remember.
 */

import { Contract, JsonRpcProvider, formatEther, formatUnits, parseUnits } from "ethers";
import QRCode from "qrcode";
import { signer } from "./wallet";

const ARBITRUM_RPC = "https://arb1.arbitrum.io/rpc";

export const NETWORK = { name: "Arbitrum One", chainId: 42161 };

/** Native USDC on Arbitrum One — the only token the bridge credits. */
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

/**
 * Bridged USDC.e. Read only to warn about it: it reports the symbol "USDC" too,
 * so an operator moving it from another wallet has no way to see the difference
 * — and the bridge does not take it.
 */
const USDC_E = "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8";

/** Hyperliquid's Arbitrum bridge. */
const BRIDGE = "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7";

/** Anything smaller is not credited and is not returned. */
const MINIMUM_USDC = 5;

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

function provider(): JsonRpcProvider {
  return new JsonRpcProvider(ARBITRUM_RPC, undefined, { staticNetwork: true });
}

export interface FundingState {
  address: string;
  /** Native USDC sitting on Arbitrum, ready to forward. */
  usdc: number;
  /** Bridged USDC.e, which the bridge will not credit. Non-zero is a problem. */
  usdcE: number;
  /** ETH on Arbitrum, needed for the gas of that transfer. */
  gas: number;
  minimum: number;
  /** Both conditions for the deposit to be possible at all. */
  canDeposit: boolean;
  bridge: string;
  network: typeof NETWORK;
  /** The exact token to send. Two different contracts answer to "USDC" here. */
  token: { symbol: string; address: string; decimals: number };
  /** The receiving address as a PNG data URI, for scanning from a phone. */
  qr: string;
}

export async function fundingState(): Promise<FundingState> {
  const address = signer().address;
  const rpc = provider();
  const usdc = new Contract(USDC, ERC20, rpc);

  const bridged = new Contract(USDC_E, ERC20, rpc);

  const [balance, legacy, gas, qr] = await Promise.all([
    usdc.balanceOf(address) as Promise<bigint>,
    // BigInt(0), not 0n: the repo-wide tsconfig targets below ES2020 and rejects
    // the literal, even though the desktop's own config would accept it.
    (bridged.balanceOf(address) as Promise<bigint>).catch(() => BigInt(0)),
    rpc.getBalance(address),
    QRCode.toDataURL(address, { width: 220, margin: 1, color: { dark: "#e9ecef", light: "#0e1013" } }),
  ]);

  const held = Number(formatUnits(balance, 6));
  const ether = Number(formatEther(gas));

  return {
    address,
    usdc: held,
    usdcE: Number(formatUnits(legacy, 6)),
    gas: ether,
    minimum: MINIMUM_USDC,
    canDeposit: held >= MINIMUM_USDC && ether > 0,
    bridge: BRIDGE,
    network: NETWORK,
    token: { symbol: "USDC", address: USDC, decimals: 6 },
    qr,
  };
}

export interface DepositReceipt {
  hash: string;
  amount: number;
  explorer: string;
}

/**
 * Forward USDC from this wallet to the bridge. A plain ERC-20 transfer — the
 * bridge watches for incoming USDC and credits the sender on the L1.
 */
export async function deposit(amount: number): Promise<DepositReceipt> {
  if (!Number.isFinite(amount) || amount < MINIMUM_USDC) {
    throw new Error(
      `The bridge keeps anything under ${MINIMUM_USDC} USDC without crediting it. Send at least that much.`,
    );
  }

  const wallet = signer().connect(provider());
  const state = await fundingState();

  if (amount > state.usdc) {
    throw new Error(`This address holds ${state.usdc} USDC on Arbitrum, less than the ${amount} requested.`);
  }
  if (state.gas <= 0) {
    throw new Error("No ETH on Arbitrum to pay gas with. Send a small amount to this address first.");
  }

  const usdc = new Contract(USDC, ERC20, wallet);
  const tx = await usdc.transfer(BRIDGE, parseUnits(String(amount), 6));
  await tx.wait();

  return {
    hash: tx.hash,
    amount,
    explorer: `https://arbiscan.io/tx/${tx.hash}`,
  };
}
