/**
 * MerkleService — batched commitments.
 *
 * Anchoring every decision individually would be prohibitively expensive, so
 * decisions are batched into a Merkle tree and only the root reaches the chain.
 * Each decision keeps an inclusion proof, which anybody can check against the
 * anchored root without trusting MERIT.
 *
 * Construction details that matter for soundness:
 *  - leaves and internal nodes are hashed under different domain tags, so a
 *    valid internal node can never be presented as a leaf (second-preimage)
 *  - an unpaired node at any level is *promoted* rather than duplicated, which
 *    avoids the duplicate-leaf ambiguity that affects Bitcoin-style trees
 *  - the tree preserves insertion order; proofs carry an explicit side flag
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { DOMAIN, digest, hashEquals, isHash, toHash, type Hash } from "./hash";

export type ProofSide = "left" | "right";

export interface ProofStep {
  /** Sibling digest to combine with the running hash. */
  sibling: Hash;
  /** Which side the sibling sits on. */
  side: ProofSide;
}

export interface InclusionProof {
  leaf: Hash;
  leafIndex: number;
  leafCount: number;
  root: Hash;
  path: ProofStep[];
}

export interface MerkleTree {
  root: Hash;
  leaves: Hash[];
  /** level 0 is the leaves, the last level is the single root. */
  levels: Hash[][];
}

/** Hash a raw commitment into a Merkle leaf under the leaf domain. */
export function hashLeaf(commitment: string): Hash {
  if (!isHash(commitment)) {
    throw new TypeError(`Merkle leaves must be 0x-prefixed 32-byte hex: ${commitment}`);
  }
  return digest(DOMAIN.merkleLeaf, commitment);
}

/** Combine two child digests into their parent. */
export function hashNode(left: Hash, right: Hash): Hash {
  const tag = new TextEncoder().encode(`${DOMAIN.merkleNode} `);
  const leftBytes = hexToBytes(left.slice(2));
  const rightBytes = hexToBytes(right.slice(2));

  const buffer = new Uint8Array(tag.length + leftBytes.length + rightBytes.length);
  buffer.set(tag, 0);
  buffer.set(leftBytes, tag.length);
  buffer.set(rightBytes, tag.length + leftBytes.length);

  return toHash(sha256(buffer));
}

/**
 * Build a tree from already-hashed leaves.
 * Throws on an empty batch: an empty tree has no meaningful root to anchor.
 */
export function buildTree(leaves: Hash[]): MerkleTree {
  if (leaves.length === 0) {
    throw new RangeError("Cannot build a Merkle tree from zero leaves");
  }
  for (const leaf of leaves) {
    if (!isHash(leaf)) throw new TypeError(`Invalid leaf digest: ${leaf}`);
  }

  const levels: Hash[][] = [leaves.slice()];

  while (levels[levels.length - 1].length > 1) {
    const current = levels[levels.length - 1];
    const next: Hash[] = [];

    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 < current.length) {
        next.push(hashNode(current[i], current[i + 1]));
      } else {
        // Odd node out: promote it unchanged to the next level.
        next.push(current[i]);
      }
    }

    levels.push(next);
  }

  return { root: levels[levels.length - 1][0], leaves: levels[0], levels };
}

/** Build a tree directly from decision commitments. */
export function buildTreeFromCommitments(commitments: string[]): MerkleTree {
  return buildTree(commitments.map(hashLeaf));
}

/** Root of a batch, without retaining the intermediate levels. */
export function computeRoot(leaves: Hash[]): Hash {
  return buildTree(leaves).root;
}

/** Generate the inclusion proof for one leaf index. */
export function generateProof(tree: MerkleTree, leafIndex: number): InclusionProof {
  if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= tree.leaves.length) {
    throw new RangeError(
      `Leaf index ${leafIndex} out of range for ${tree.leaves.length} leaves`,
    );
  }

  const path: ProofStep[] = [];
  let index = leafIndex;

  for (let level = 0; level < tree.levels.length - 1; level += 1) {
    const nodes = tree.levels[level];
    const isRightChild = index % 2 === 1;
    const siblingIndex = isRightChild ? index - 1 : index + 1;

    if (siblingIndex < nodes.length) {
      path.push({
        sibling: nodes[siblingIndex],
        side: isRightChild ? "left" : "right",
      });
      index = Math.floor(index / 2);
    } else {
      // Promoted node: it moves up a level without being combined.
      index = Math.floor(index / 2);
    }
  }

  return {
    leaf: tree.leaves[leafIndex],
    leafIndex,
    leafCount: tree.leaves.length,
    root: tree.root,
    path,
  };
}

/**
 * Recompute a root from a leaf and its proof.
 * Pure function — this is what an independent verifier runs.
 */
export function computeRootFromProof(leaf: Hash, path: ProofStep[]): Hash {
  let current = leaf;

  for (const step of path) {
    current =
      step.side === "left" ? hashNode(step.sibling, current) : hashNode(current, step.sibling);
  }

  return current;
}

/** Verify that a leaf belongs to a root. */
export function verifyProof(proof: InclusionProof, expectedRoot?: string): boolean {
  if (!isHash(proof.leaf)) return false;
  if (!Number.isInteger(proof.leafIndex) || proof.leafIndex < 0) return false;
  if (proof.leafIndex >= proof.leafCount) return false;

  for (const step of proof.path) {
    if (!isHash(step.sibling)) return false;
    if (step.side !== "left" && step.side !== "right") return false;
  }

  const recomputed = computeRootFromProof(proof.leaf, proof.path);
  const target = expectedRoot ?? proof.root;

  return hashEquals(recomputed, target) && hashEquals(recomputed, proof.root);
}

/** Verify a raw commitment against a root in one call. */
export function verifyCommitmentInclusion(
  commitment: string,
  path: ProofStep[],
  root: string,
): boolean {
  if (!isHash(commitment) || !isHash(root)) return false;
  return hashEquals(computeRootFromProof(hashLeaf(commitment), path), root);
}

/**
 * Facade used by the batching service. Keeping the surface narrow means the
 * persistence layer never has to know how the tree is shaped.
 */
export const MerkleService = {
  hashLeaf,
  hashNode,
  buildTree,
  buildTreeFromCommitments,
  computeRoot,
  generateProof,
  computeRootFromProof,
  verifyProof,
  verifyCommitmentInclusion,

  /** Build a tree and emit every proof in leaf order. */
  createBatch(commitments: string[]): { tree: MerkleTree; proofs: InclusionProof[] } {
    const tree = buildTreeFromCommitments(commitments);
    const proofs = tree.leaves.map((_, index) => generateProof(tree, index));
    return { tree, proofs };
  },
} as const;
