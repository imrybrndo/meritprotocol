/**
 * Offline verification.
 *
 * This is the part of the SDK that matters most: it recomputes a Merkle root
 * from a proof bundle using only local code. If this function disagrees with
 * MERIT's API, believe this function.
 *
 * The algorithm mirrors the protocol exactly:
 *   leaf   = SHA-256("merit.merkle.leaf.v1 " || commitmentHex)
 *   node   = SHA-256("merit.merkle.node.v1 " || leftBytes || rightBytes)
 *   unpaired nodes are promoted, never duplicated.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export const LEAF_DOMAIN = "merit.merkle.leaf.v1";
export const NODE_DOMAIN = "merit.merkle.node.v1";

export interface ProofStep {
  sibling: string;
  side: "left" | "right";
}

const isHash = (value: string): boolean => /^0x[0-9a-f]{64}$/.test(value);

export function hashLeaf(commitment: string): string {
  if (!isHash(commitment)) {
    throw new TypeError(`Expected a 0x-prefixed 32-byte hex digest: ${commitment}`);
  }
  return `0x${bytesToHex(sha256(utf8ToBytes(`${LEAF_DOMAIN} ${commitment}`)))}`;
}

export function hashNode(left: string, right: string): string {
  const tag = utf8ToBytes(`${NODE_DOMAIN} `);
  const l = hexToBytes(left.slice(2));
  const r = hexToBytes(right.slice(2));

  const buffer = new Uint8Array(tag.length + l.length + r.length);
  buffer.set(tag, 0);
  buffer.set(l, tag.length);
  buffer.set(r, tag.length + l.length);

  return `0x${bytesToHex(sha256(buffer))}`;
}

/** Fold a leaf and its sibling path back into a root. */
export function computeRootFromProof(leaf: string, path: ProofStep[]): string {
  let current = leaf;
  for (const step of path) {
    current =
      step.side === "left" ? hashNode(step.sibling, current) : hashNode(current, step.sibling);
  }
  return current;
}

export interface OfflineVerification {
  valid: boolean;
  computedRoot: string;
  expectedRoot: string;
  reason: string | null;
}

/**
 * Verify a proof bundle without contacting MERIT.
 *
 * Pass the bundle from `getProof()`. A `true` result means the commitment is
 * genuinely a member of the batch whose root was anchored — nothing more, and
 * nothing that depends on MERIT being honest.
 */
export function verifyProofOffline(bundle: {
  commitmentHash: string;
  leafHash?: string;
  path: ProofStep[];
  merkleRoot: string;
}): OfflineVerification {
  const expectedRoot = bundle.merkleRoot;

  if (!isHash(bundle.commitmentHash)) {
    return {
      valid: false,
      computedRoot: "",
      expectedRoot,
      reason: "Commitment is not a valid 32-byte hex digest.",
    };
  }
  if (!isHash(expectedRoot)) {
    return {
      valid: false,
      computedRoot: "",
      expectedRoot,
      reason: "Merkle root is not a valid 32-byte hex digest.",
    };
  }

  const leaf = hashLeaf(bundle.commitmentHash);

  if (bundle.leafHash && bundle.leafHash !== leaf) {
    return {
      valid: false,
      computedRoot: "",
      expectedRoot,
      reason: "Reported leaf hash does not match the commitment.",
    };
  }

  const computedRoot = computeRootFromProof(leaf, bundle.path);

  return {
    valid: computedRoot === expectedRoot,
    computedRoot,
    expectedRoot,
    reason:
      computedRoot === expectedRoot
        ? null
        : "Recomputed root does not match the anchored root.",
  };
}
