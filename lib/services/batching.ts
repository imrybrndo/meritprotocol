/**
 * Batching and anchoring.
 *
 * Unbatched decisions are collected in commit order, hashed into a Merkle tree,
 * and the root is handed to the AnchorService. Proofs are written in the same
 * transaction as the batch, so a batch can never exist without the proofs that
 * make its members verifiable.
 */

import type { PrismaClient } from "../generated/prisma/client";
import type { Prisma } from "../generated/prisma/client";
import { MerkleService } from "../crypto/merkle";
import type { Hash } from "../crypto/hash";
import { getAnchorService } from "../anchor";
import { emitEvent } from "../events";

export const DEFAULT_BATCH_SIZE = 256;

export interface BatchResult {
  batchId: string;
  sequence: number;
  merkleRoot: Hash;
  leafCount: number;
  anchored: boolean;
  transactionHash: string | null;
  network: string;
  status: string;
}

/**
 * Seal every decision that does not yet have a proof into one batch.
 * Returns null when there is nothing to batch.
 */
export async function sealPendingBatch(
  prisma: PrismaClient,
  options: { limit?: number } = {},
): Promise<BatchResult | null> {
  const pending = await prisma.decision.findMany({
    where: { proof: null },
    orderBy: { committedAt: "asc" },
    take: options.limit ?? DEFAULT_BATCH_SIZE,
    select: { id: true, commitmentHash: true, agentId: true },
  });

  if (pending.length === 0) return null;

  const { tree, proofs } = MerkleService.createBatch(
    pending.map((decision) => decision.commitmentHash),
  );

  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.merkleBatch.create({
      data: {
        merkleRoot: tree.root,
        leafCount: pending.length,
        status: "SEALED",
        sealedAt: new Date(),
      },
    });

    await tx.proof.createMany({
      data: proofs.map((proof, index) => ({
        decisionId: pending[index].id,
        batchId: created.id,
        leafHash: proof.leaf,
        leafIndex: proof.leafIndex,
        path: proof.path as unknown as Prisma.InputJsonValue,
      })),
    });

    await emitEvent(tx, {
      type: "MERKLE_ROOT_CREATED",
      subjectId: created.id,
      payload: { merkleRoot: tree.root, leafCount: pending.length },
    });

    for (const decision of pending) {
      await emitEvent(tx, {
        type: "PROOF_BATCHED",
        agentId: decision.agentId,
        subjectId: decision.id,
        payload: { batchId: created.id, merkleRoot: tree.root },
      });
    }

    return created;
  });

  const anchorService = getAnchorService();
  const receipt = await anchorService.anchor(tree.root);

  await prisma.$transaction(async (tx) => {
    await tx.blockchainAnchor.create({
      data: {
        batchId: batch.id,
        network: receipt.network,
        merkleRoot: tree.root,
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber === null ? null : BigInt(receipt.blockNumber),
        explorerUrl: receipt.explorerUrl,
        status: receipt.status,
        anchoredAt: receipt.anchoredAt,
        confirmedAt: receipt.status === "CONFIRMED" ? receipt.anchoredAt : null,
      },
    });

    await tx.merkleBatch.update({
      where: { id: batch.id },
      data: { status: receipt.status === "FAILED" ? "FAILED" : "ANCHORED" },
    });

    if (receipt.status === "CONFIRMED") {
      await emitEvent(tx, {
        type: "ANCHOR_CONFIRMED",
        subjectId: batch.id,
        payload: {
          merkleRoot: tree.root,
          network: receipt.network,
          transactionHash: receipt.transactionHash,
        },
      });
    }
  });

  return {
    batchId: batch.id,
    sequence: batch.sequence,
    merkleRoot: tree.root,
    leafCount: pending.length,
    anchored: receipt.status === "CONFIRMED",
    transactionHash: receipt.transactionHash,
    network: receipt.network,
    status: receipt.status,
  };
}
