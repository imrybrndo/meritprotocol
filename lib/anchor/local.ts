/**
 * LocalAnchorAdapter — the no-chain fallback.
 *
 * This exists so the protocol is fully exercisable without a funded wallet or
 * network access. It is deliberately honest about what it is:
 *
 *  - `transactionHash` is always null. It never fabricates a signature.
 *  - `status` is always LOCAL_ONLY, which the UI renders as "not anchored".
 *  - `isOnChain` is false, so no surface can claim on-chain provenance.
 *
 * A local record still binds the root to a timestamp within this deployment,
 * which is useful for development, but it is not a third-party-verifiable fact
 * and must never be presented as one.
 */

import type { Hash } from "../crypto/hash";
import type { AnchorAdapter, AnchorReceipt, AnchorVerification } from "./types";

interface LocalRecord {
  root: Hash;
  anchoredAt: Date;
}

export class LocalAnchorAdapter implements AnchorAdapter {
  readonly network = "local";
  readonly isOnChain = false;

  private readonly records = new Map<string, LocalRecord>();

  async anchor(root: Hash): Promise<AnchorReceipt> {
    const anchoredAt = new Date();
    this.records.set(root, { root, anchoredAt });

    return {
      network: this.network,
      root,
      transactionHash: null,
      blockNumber: null,
      status: "LOCAL_ONLY",
      anchoredAt,
      explorerUrl: null,
    };
  }

  async getAnchor(): Promise<AnchorReceipt | null> {
    // There is no transaction to look up; a local anchor is only meaningful
    // alongside the database row that references it.
    return null;
  }

  async verifyAnchor(root: Hash): Promise<AnchorVerification> {
    const record = this.records.get(root);

    return {
      valid: false,
      status: "LOCAL_ONLY",
      observedRoot: record?.root ?? null,
      network: this.network,
      transactionHash: null,
      blockNumber: null,
      anchoredAt: record?.anchoredAt ?? null,
      reason:
        "Root was sealed locally and never written to a blockchain. Configure EVM_ANCHOR_PRIVATE_KEY and EVM_RPC_URL to produce a third-party-verifiable anchor.",
    };
  }
}
