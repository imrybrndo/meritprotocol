import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/crypto/hash";
import { MerkleService } from "@/lib/crypto/merkle";
import {
  computeRootFromProof as sdkComputeRoot,
  hashLeaf as sdkHashLeaf,
  hashNode as sdkHashNode,
  verifyProofOffline,
} from "@/packages/sdk/src/verify";

/**
 * The SDK reimplements the Merkle algorithm so that a client can verify without
 * MERIT's code. That only helps if the two implementations agree exactly — a
 * divergence would mean honest proofs failing, or forged ones passing.
 */
describe("SDK offline verification", () => {
  const commitments = (count: number) =>
    Array.from({ length: count }, (_, i) => sha256Hex(`sdk-decision-${i}`));

  it("agrees with the protocol on leaf hashing", () => {
    for (const commitment of commitments(5)) {
      expect(sdkHashLeaf(commitment)).toBe(MerkleService.hashLeaf(commitment));
    }
  });

  it("agrees with the protocol on node hashing", () => {
    const [a, b] = commitments(2).map(MerkleService.hashLeaf);
    expect(sdkHashNode(a, b)).toBe(MerkleService.hashNode(a, b));
  });

  for (const size of [1, 2, 3, 5, 8, 17, 64, 129]) {
    it(`recomputes the same root as the protocol for ${size} leaves`, () => {
      const input = commitments(size);
      const { tree, proofs } = MerkleService.createBatch(input);

      proofs.forEach((proof, index) => {
        const viaSdk = sdkComputeRoot(sdkHashLeaf(input[index]), proof.path);
        expect(viaSdk).toBe(tree.root);

        const result = verifyProofOffline({
          commitmentHash: input[index],
          leafHash: proof.leaf,
          path: proof.path,
          merkleRoot: tree.root,
        });
        expect(result.valid).toBe(true);
        expect(result.computedRoot).toBe(tree.root);
        expect(result.reason).toBeNull();
      });
    });
  }

  it("rejects a forged commitment against a real root", () => {
    const input = commitments(16);
    const { tree, proofs } = MerkleService.createBatch(input);

    const result = verifyProofOffline({
      commitmentHash: sha256Hex("forged"),
      path: proofs[3].path,
      merkleRoot: tree.root,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/does not match/i);
  });

  it("rejects a leaf hash that disagrees with its commitment", () => {
    const input = commitments(8);
    const { tree, proofs } = MerkleService.createBatch(input);

    const result = verifyProofOffline({
      commitmentHash: input[0],
      leafHash: sha256Hex("wrong-leaf"),
      path: proofs[0].path,
      merkleRoot: tree.root,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/leaf hash/i);
  });

  it("rejects a tampered sibling", () => {
    const input = commitments(32);
    const { tree, proofs } = MerkleService.createBatch(input);
    const path = proofs[9].path.map((step, i) =>
      i === 1 ? { ...step, sibling: sha256Hex("evil") } : step,
    );

    expect(
      verifyProofOffline({
        commitmentHash: input[9],
        path,
        merkleRoot: tree.root,
      }).valid,
    ).toBe(false);
  });

  it("rejects malformed inputs rather than throwing", () => {
    expect(
      verifyProofOffline({
        commitmentHash: "not-a-hash",
        path: [],
        merkleRoot: sha256Hex("root"),
      }).valid,
    ).toBe(false);

    expect(
      verifyProofOffline({
        commitmentHash: sha256Hex("c"),
        path: [],
        merkleRoot: "0xnope",
      }).valid,
    ).toBe(false);
  });
});
