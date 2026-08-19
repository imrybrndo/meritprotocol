import { describe, expect, it } from "vitest";
import { sha256Hex, type Hash } from "@/lib/crypto/hash";
import {
  MerkleService,
  buildTree,
  buildTreeFromCommitments,
  computeRootFromProof,
  generateProof,
  hashLeaf,
  hashNode,
  verifyCommitmentInclusion,
  verifyProof,
} from "@/lib/crypto/merkle";

const commitments = (count: number): Hash[] =>
  Array.from({ length: count }, (_, i) => sha256Hex(`decision-${i}`));

describe("MerkleService", () => {
  it("rejects an empty batch", () => {
    expect(() => buildTree([])).toThrow(RangeError);
  });

  it("builds a single-leaf tree whose root is the leaf", () => {
    const tree = buildTreeFromCommitments(commitments(1));
    expect(tree.root).toBe(hashLeaf(commitments(1)[0]));
    expect(tree.levels).toHaveLength(1);
  });

  it("is deterministic across rebuilds", () => {
    const input = commitments(9);
    expect(buildTreeFromCommitments(input).root).toBe(
      buildTreeFromCommitments(input).root,
    );
  });

  it("changes the root when any leaf changes", () => {
    const base = commitments(8);
    const mutated = [...base];
    mutated[3] = sha256Hex("tampered");

    expect(buildTreeFromCommitments(base).root).not.toBe(
      buildTreeFromCommitments(mutated).root,
    );
  });

  it("changes the root when leaf order changes", () => {
    const base = commitments(6);
    const swapped = [...base];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];

    expect(buildTreeFromCommitments(base).root).not.toBe(
      buildTreeFromCommitments(swapped).root,
    );
  });

  it("separates leaf and node domains", () => {
    const [a, b] = commitments(2);
    // An internal node must not collide with a leaf over the same bytes.
    expect(hashNode(hashLeaf(a), hashLeaf(b))).not.toBe(hashLeaf(a));
  });

  // Odd counts exercise node promotion; powers of two exercise the balanced path.
  for (const size of [1, 2, 3, 4, 5, 7, 8, 9, 16, 17, 33, 64, 100]) {
    it(`generates and verifies every proof for a batch of ${size}`, () => {
      const input = commitments(size);
      const { tree, proofs } = MerkleService.createBatch(input);

      expect(proofs).toHaveLength(size);

      proofs.forEach((proof, index) => {
        expect(proof.leafIndex).toBe(index);
        expect(proof.leafCount).toBe(size);
        expect(verifyProof(proof, tree.root)).toBe(true);
        expect(computeRootFromProof(proof.leaf, proof.path)).toBe(tree.root);
        expect(verifyCommitmentInclusion(input[index], proof.path, tree.root)).toBe(true);
      });
    });
  }

  it("rejects a proof against the wrong root", () => {
    const { tree, proofs } = MerkleService.createBatch(commitments(8));
    const otherRoot = buildTreeFromCommitments(commitments(4)).root;

    expect(tree.root).not.toBe(otherRoot);
    expect(verifyProof(proofs[0], otherRoot)).toBe(false);
  });

  it("rejects a proof with a tampered sibling", () => {
    const { tree, proofs } = MerkleService.createBatch(commitments(8));
    const tampered = {
      ...proofs[2],
      path: proofs[2].path.map((step, i) =>
        i === 0 ? { ...step, sibling: sha256Hex("evil") } : step,
      ),
    };

    expect(verifyProof(tampered, tree.root)).toBe(false);
  });

  it("rejects a proof with a flipped side", () => {
    const { tree, proofs } = MerkleService.createBatch(commitments(8));
    const flipped = {
      ...proofs[5],
      path: proofs[5].path.map((step, i) =>
        i === 0 ? { ...step, side: step.side === "left" ? ("right" as const) : ("left" as const) } : step,
      ),
    };

    expect(verifyProof(flipped, tree.root)).toBe(false);
  });

  it("rejects a commitment that is not in the batch", () => {
    const input = commitments(8);
    const { tree, proofs } = MerkleService.createBatch(input);

    expect(verifyCommitmentInclusion(sha256Hex("outsider"), proofs[0].path, tree.root)).toBe(
      false,
    );
  });

  it("rejects malformed digests", () => {
    expect(() => hashLeaf("not-a-hash")).toThrow(TypeError);
    expect(verifyCommitmentInclusion("0xzz", [], sha256Hex("x"))).toBe(false);
  });

  it("rejects an out-of-range leaf index", () => {
    const tree = buildTreeFromCommitments(commitments(4));
    expect(() => generateProof(tree, 4)).toThrow(RangeError);
    expect(() => generateProof(tree, -1)).toThrow(RangeError);
  });

  it("keeps proof length logarithmic in batch size", () => {
    const { proofs } = MerkleService.createBatch(commitments(1024));
    for (const proof of proofs) {
      expect(proof.path.length).toBeLessThanOrEqual(10);
    }
  });
});
