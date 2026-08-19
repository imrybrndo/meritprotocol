/**
 * Commitment hashing.
 *
 * SHA-256 from @noble/hashes — audited, isomorphic, and synchronous, so the
 * browser on /verify runs the exact same code path as the server that issued
 * the commitment. No custom cryptography is defined here; this module only
 * decides *what bytes* get hashed.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  canonicalDecimal,
  canonicalize,
  canonicalTimestamp,
  type CanonicalValue,
} from "./canonical";

/**
 * Domain separation tags. Every hash in the protocol is prefixed so that a
 * digest produced for one purpose can never be replayed as another.
 */
export const DOMAIN = {
  decision: "merit.decision.v1",
  outcome: "merit.outcome.v1",
  strategyConfig: "merit.strategy-config.v1",
  merkleLeaf: "merit.merkle.leaf.v1",
  merkleNode: "merit.merkle.node.v1",
  anchorPayload: "merit.anchor.v1",
} as const;

export type Domain = (typeof DOMAIN)[keyof typeof DOMAIN];

/** Lowercase, 0x-prefixed hex of a 32-byte digest. */
export type Hash = `0x${string}`;

export function toHash(bytes: Uint8Array): Hash {
  return `0x${bytesToHex(bytes)}`;
}

export function sha256Hex(input: string): Hash {
  return toHash(sha256(utf8ToBytes(input)));
}

/**
 * Hash a payload under a domain tag.
 *
 * The separator is a single space, and the payload must always be included —
 * an implementation that drops it would return a constant per domain and
 * silently destroy every commitment. tests/commitment.test.ts pins this.
 */
export function digest(domain: Domain, payload: string): Hash {
  return sha256Hex(domain + " " + payload);
}

export function isHash(value: unknown): value is Hash {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
}

/** Constant-time-ish comparison. Digests are public, but avoid early exit anyway. */
export function hashEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * The exact set of fields a decision commits to. Anything outside this shape is
 * metadata that travels with the record but does not bind it.
 */
export interface DecisionCommitmentInput {
  agentId: string;
  strategyVersionId: string;
  strategyVersion: string;
  asset: string;
  action: string;
  price: number | string;
  quantity: number | string;
  confidence: number | string;
  decidedAt: Date | string | number;
  nonce: string;
  metadata?: Record<string, CanonicalValue | undefined>;
}

/**
 * Deterministic commitment over a trading decision.
 *
 * The nonce is supplied by the caller and stored alongside the record. It makes
 * the pre-image unguessable, so publishing a commitment before the outcome is
 * known does not leak the decision to anybody watching the chain.
 */
export function commitDecision(input: DecisionCommitmentInput): Hash {
  const payload = canonicalize({
    action: input.action,
    agentId: input.agentId,
    asset: input.asset,
    confidence: canonicalDecimal(input.confidence),
    decidedAt: canonicalTimestamp(input.decidedAt),
    metadata: input.metadata ? canonicalize(input.metadata) : null,
    nonce: input.nonce,
    price: canonicalDecimal(input.price),
    quantity: canonicalDecimal(input.quantity),
    strategyVersion: input.strategyVersion,
    strategyVersionId: input.strategyVersionId,
  });

  return digest(DOMAIN.decision, payload);
}

export interface OutcomeCommitmentInput {
  decisionId: string;
  commitmentHash: string;
  entryPrice: number | string;
  exitPrice: number | string;
  quantity: number | string;
  fees: number | string;
  slippage: number | string;
  realizedPnl: number | string;
  settledAt: Date | string | number;
}

/** Deterministic commitment over the revealed outcome of a decision. */
export function commitOutcome(input: OutcomeCommitmentInput): Hash {
  const payload = canonicalize({
    commitmentHash: input.commitmentHash,
    decisionId: input.decisionId,
    entryPrice: canonicalDecimal(input.entryPrice),
    exitPrice: canonicalDecimal(input.exitPrice),
    fees: canonicalDecimal(input.fees),
    quantity: canonicalDecimal(input.quantity),
    realizedPnl: canonicalDecimal(input.realizedPnl),
    settledAt: canonicalTimestamp(input.settledAt),
    slippage: canonicalDecimal(input.slippage),
  });

  return digest(DOMAIN.outcome, payload);
}

/**
 * Configuration hash for an immutable strategy version. Two versions with
 * identical configuration produce the same hash, which makes an undisclosed
 * config swap detectable.
 */
export function hashStrategyConfig(
  config: Record<string, CanonicalValue | undefined>,
): Hash {
  return digest(DOMAIN.strategyConfig, canonicalize(config));
}
