/**
 * AnchorService contract.
 *
 * The protocol publishes one Merkle root per batch. Everything chain-specific
 * lives behind this interface so a second chain is an added adapter, not a
 * rewrite. The chain stores the minimum needed to bind a root to a point in
 * time; all metadata stays in the database.
 */

import type { Hash } from "../crypto/hash";

export type AnchorStatus =
  /** Submitted, not yet confirmed by the network. */
  | "PENDING"
  /** Confirmed on-chain and independently re-readable. */
  | "CONFIRMED"
  /** Submission failed; the root is not anchored. */
  | "FAILED"
  /**
   * Recorded by the local adapter only. The root is sealed and tamper-evident
   * within this deployment but has NO on-chain existence, and the UI must say
   * so rather than implying a chain write happened.
   */
  | "LOCAL_ONLY";

export interface AnchorReceipt {
  /** Chain identifier, e.g. "robinhood:1234" or "local". */
  network: string;
  /** The anchored Merkle root. */
  root: Hash;
  /**
   * Real transaction signature/hash, or null when no chain write occurred.
   * Adapters must never invent a value here.
   */
  transactionHash: string | null;
  /** Block/slot number, or null when not applicable. */
  blockNumber: number | null;
  status: AnchorStatus;
  /** When the network (or local adapter) recorded it. */
  anchoredAt: Date;
  /** Explorer URL when one exists for this network. */
  explorerUrl: string | null;
}

export interface AnchorVerification {
  valid: boolean;
  status: AnchorStatus;
  /** What the chain actually returned, for display next to the expectation. */
  observedRoot: Hash | null;
  network: string;
  transactionHash: string | null;
  blockNumber: number | null;
  anchoredAt: Date | null;
  /** Human-readable reason when `valid` is false. */
  reason: string | null;
}

export interface AnchorAdapter {
  readonly network: string;
  /** False for the local adapter. The UI keys its wording off this. */
  readonly isOnChain: boolean;

  /** Publish a root. Throws only on unrecoverable configuration errors. */
  anchor(root: Hash): Promise<AnchorReceipt>;

  /** Re-read a previously published anchor by its transaction reference. */
  getAnchor(transactionHash: string): Promise<AnchorReceipt | null>;

  /** Confirm that `transactionHash` really commits to `root`. */
  verifyAnchor(root: Hash, transactionHash: string): Promise<AnchorVerification>;
}

/** Payload written on-chain. Kept short — chains charge by the byte. */
export function encodeAnchorPayload(root: Hash): string {
  return `merit:v1:${root}`;
}

export function decodeAnchorPayload(payload: string): Hash | null {
  const match = /^merit:v1:(0x[0-9a-f]{64})$/.exec(payload.trim());
  return match ? (match[1] as Hash) : null;
}
