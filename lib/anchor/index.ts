/**
 * AnchorService — adapter selection.
 *
 * Selection is by configuration only. If a Solana keypair is present the real
 * devnet/mainnet adapter is used; otherwise the deployment falls back to the
 * local adapter, which is explicit about producing no on-chain record.
 */

import { LocalAnchorAdapter } from "./local";
import { SolanaAnchorAdapter, keypairFromSecret, type SolanaCluster } from "./solana";
import type { AnchorAdapter } from "./types";

export * from "./types";
export { LocalAnchorAdapter } from "./local";
export { SolanaAnchorAdapter, keypairFromSecret } from "./solana";

const DEFAULT_RPC: Record<SolanaCluster, string> = {
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
};

let cached: AnchorAdapter | null = null;

function build(): AnchorAdapter {
  const secret = process.env.SOLANA_ANCHOR_SECRET_KEY?.trim();

  if (!secret) return new LocalAnchorAdapter();

  const cluster = (process.env.SOLANA_CLUSTER ?? "devnet") as SolanaCluster;

  try {
    return new SolanaAnchorAdapter({
      cluster,
      rpcUrl: process.env.SOLANA_RPC_URL?.trim() || DEFAULT_RPC[cluster],
      payer: keypairFromSecret(secret),
    });
  } catch (error) {
    // A malformed key must not silently downgrade to a weaker guarantee
    // without saying so in the logs.
    console.error(
      "[anchor] SOLANA_ANCHOR_SECRET_KEY is set but unreadable; falling back to the local adapter.",
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
