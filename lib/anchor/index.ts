/**
 * AnchorService — adapter selection.
 *
 * Selection is by configuration only. With an EVM signing key and an RPC URL
 * present the real chain adapter is used; otherwise the deployment falls back
 * to the local adapter, which is explicit about producing no on-chain record.
 *
 * There is no default RPC URL, unlike the Solana adapter this replaced. Public
 * Solana clusters have well-known endpoints; an EVM deployment does not, and
 * guessing one would mean anchoring to whatever chain the guess happened to
 * hit. An unset `EVM_RPC_URL` is treated as "not configured for chain writes",
 * which is a state the protocol already renders honestly.
 */

import { LocalAnchorAdapter } from "./local";
import { EvmAnchorAdapter, walletFromSecret } from "./evm";
import type { AnchorAdapter } from "./types";

export * from "./types";
export { LocalAnchorAdapter } from "./local";
export { EvmAnchorAdapter, walletFromSecret, decodeCalldata } from "./evm";

let cached: AnchorAdapter | null = null;

function optionalInt(raw: string | undefined): number | null {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function build(): AnchorAdapter {
  const secret = process.env.EVM_ANCHOR_PRIVATE_KEY?.trim();
  const rpcUrl = process.env.EVM_RPC_URL?.trim();

  if (!secret) return new LocalAnchorAdapter();

  if (!rpcUrl) {
    // A key with nowhere to send the transaction is a half-configured
    // deployment, and silently behaving like an unconfigured one would hide
    // the mistake until somebody asked why nothing was ever anchored.
    console.error(
      "[anchor] EVM_ANCHOR_PRIVATE_KEY is set but EVM_RPC_URL is not; " +
        "falling back to the local adapter.",
    );
    return new LocalAnchorAdapter();
  }

  try {
    return new EvmAnchorAdapter({
      chainName: process.env.EVM_CHAIN_NAME?.trim() || "evm",
      chainId: optionalInt(process.env.EVM_CHAIN_ID),
      rpcUrl,
      wallet: walletFromSecret(secret),
      explorerBaseUrl: process.env.EVM_EXPLORER_URL?.trim() || null,
      confirmations: optionalInt(process.env.EVM_ANCHOR_CONFIRMATIONS) ?? 1,
    });
  } catch (error) {
    // A malformed key must not silently downgrade to a weaker guarantee
    // without saying so in the logs.
    console.error(
      "[anchor] EVM_ANCHOR_PRIVATE_KEY is set but unreadable; falling back to the local adapter.",
      error,
    );
    return new LocalAnchorAdapter();
  }
}

/** The process-wide anchor adapter. */
export function getAnchorService(): AnchorAdapter {
  cached ??= build();
  return cached;
}

/** Test seam. */
export function setAnchorService(adapter: AnchorAdapter | null): void {
  cached = adapter;
}
