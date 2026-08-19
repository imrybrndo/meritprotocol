/**
 * Batching and anchoring.
 *
 * Unbatched decisions are collected in commit order, hashed into a Merkle tree,
 * and the root is handed to the AnchorService. Proofs are written in the same
 * transaction as the batch, so a batch can never exist without the proofs that
 * make its members verifiable.
 *
 * Two callers can seal at once — the scheduler and an operator hitting
 * `POST /api/v1/batches`. Rather than locking them against each other, the
 * pending set is claimed inside the transaction with `FOR UPDATE SKIP LOCKED`,
 * so a second sealer simply picks up the decisions the first did not take. Both
 * runs succeed and neither can batch the same commitment twice.
 */

import type { PrismaClient } from "../generated/prisma/client";
import type { Prisma } from "../generated/prisma/client";
import { MerkleService } from "../crypto/merkle";
import type { Hash } from "../crypto/hash";
import { getAnchorService } from "../anchor";
import { emitEvent, emitEvents, type EmitEventInput } from "../events";

export const DEFAULT_BATCH_SIZE = 256;

/**
 * A batch of 256 is one anchor transaction for 256 commitments, which is the
 * cheapest the protocol gets. Waiting for it is also how a quiet week leaves a
 * decision unproven for days, so age is the second trigger: whichever condition
 * is met first seals the batch.
 */
export interface SealPolicy {
  /** Seal as soon as this many commitments are waiting. */
  minBatchSize: number;
  /** Seal regardless of count once the oldest commitment is this old. */
  maxAgeMs: number;
  /** Hard cap on one batch, and so on one Merkle tree. */
  maxBatchSize: number;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/**
 * Read the policy from the environment on every call rather than caching it at
 * module load: a serverless instance can outlive a configuration change, and a
 * stale threshold would be invisible.
 */
export function getSealPolicy(): SealPolicy {
  const maxBatchSize = Math.min(
    positiveInt(process.env.MERIT_SEAL_MAX_BATCH, DEFAULT_BATCH_SIZE),
    DEFAULT_BATCH_SIZE,
  );

  return {
    minBatchSize: Math.min(positiveInt(process.env.MERIT_SEAL_MIN_BATCH, 32), maxBatchSize),
    maxAgeMs: positiveInt(process.env.MERIT_SEAL_MAX_AGE_MINUTES, 60) * 60_000,
    maxBatchSize,
  };
}

export interface SealDecision {
  shouldSeal: boolean;
  /** Why, in words, for the scheduler's response and the operator's logs. */
  reason: string;
  pending: number;
  oldestPendingAt: Date | null;
  oldestAgeMs: number;
  policy: SealPolicy;
}

/**
 * Decide whether there is anything worth sealing right now.
 *
 * Counting is deliberately cheap — a count and a single ordered read, both
 * index-backed — because the scheduler calls this far more often than it
 * actually seals.
 */
export async function evaluateSealPolicy(
  prisma: PrismaClient,
  policy: SealPolicy = getSealPolicy(),
): Promise<SealDecision> {
  const [pending, oldest] = await Promise.all([
    prisma.decision.count({ where: { proof: null } }),
    prisma.decision.findFirst({
      where: { proof: null },
      orderBy: { committedAt: "asc" },
      select: { committedAt: true },
    }),
  ]);

  const oldestPendingAt = oldest?.committedAt ?? null;
  const oldestAgeMs = oldestPendingAt ? Date.now() - oldestPendingAt.getTime() : 0;

  const base = { pending, oldestPendingAt, oldestAgeMs, policy };

  if (pending === 0) {
    return { ...base, shouldSeal: false, reason: "No unbatched commitments" };
  }

  if (pending >= policy.minBatchSize) {
    return {
      ...base,
      shouldSeal: true,
      reason: `${pending} pending commitments reached the batch threshold of ${policy.minBatchSize}`,
    };
  }

  if (oldestAgeMs >= policy.maxAgeMs) {
    const minutes = Math.round(oldestAgeMs / 60_000);
    return {
      ...base,
      shouldSeal: true,
      reason: `Oldest commitment has waited ${minutes} minutes, past the ${Math.round(policy.maxAgeMs / 60_000)}-minute limit`,
    };
  }

  return {
    ...base,
    shouldSeal: false,
    reason: `${pending} pending, below the threshold of ${policy.minBatchSize} and within the age limit`,
  };
}

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

interface PendingRow {
  id: string;
  commitmentHash: string;
  agentId: string;
}

/**
 * Seal every decision that does not yet have a proof into one batch.
 * Returns null when there is nothing to batch.
 */
export async function sealPendingBatch(
  prisma: PrismaClient,
  options: { limit?: number } = {},
): Promise<BatchResult | null> {
  const take = Math.min(options.limit ?? DEFAULT_BATCH_SIZE, DEFAULT_BATCH_SIZE);

  const sealed = await prisma.$transaction(
    async (tx) => {
      // Claiming and batching in one transaction is what makes concurrent
      // sealers safe. `SKIP LOCKED` hands the second caller a disjoint set
      // instead of blocking it behind the first.
      const pending = await tx.$queryRaw<PendingRow[]>`
        SELECT d."id", d."commitmentHash", d."agentId"
        FROM "decisions" d
        WHERE NOT EXISTS (SELECT 1 FROM "proofs" p WHERE p."decisionId" = d."id")
        ORDER BY d."committedAt" ASC
        LIMIT ${take}
        FOR UPDATE OF d SKIP LOCKED
      `;

      if (pending.length === 0) return null;

      const { tree, proofs } = MerkleService.createBatch(
        pending.map((decision) => decision.commitmentHash),
      );

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

      const events: EmitEventInput[] = [
        {
          type: "MERKLE_ROOT_CREATED",
          subjectId: created.id,
          payload: { merkleRoot: tree.root, leafCount: pending.length },
        },
        ...pending.map((decision) => ({
          type: "PROOF_BATCHED" as const,
          agentId: decision.agentId,
          subjectId: decision.id,
          payload: { batchId: created.id, merkleRoot: tree.root },
        })),
      ];
      await emitEvents(tx, events);

      return { batch: created, root: tree.root, leafCount: pending.length };
    },
    // A full 256-leaf batch writes 256 proofs and 257 events. The default 5s
    // interactive limit is comfortable for a small batch and marginal for a
    // full one, and a timeout here would roll back a valid seal.
    { timeout: 30_000, maxWait: 10_000 },
  );

  if (!sealed) return null;

  const { batch, root, leafCount } = sealed;

  const anchorService = getAnchorService();
  const receipt = await anchorService.anchor(root);

  await prisma.$transaction(async (tx) => {
    await tx.blockchainAnchor.create({
      data: {
        batchId: batch.id,
        network: receipt.network,
        merkleRoot: root,
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
          merkleRoot: root,
          network: receipt.network,
          transactionHash: receipt.transactionHash,
        },
      });
    }
  });

  return {
    batchId: batch.id,
    sequence: batch.sequence,
    merkleRoot: root,
    leafCount,
    anchored: receipt.status === "CONFIRMED",
    transactionHash: receipt.transactionHash,
    network: receipt.network,
    status: receipt.status,
  };
}

export interface DrainResult {
  batches: BatchResult[];
  /** Commitments still unbatched when the run stopped. */
  remaining: number;
  /** True when the run hit `maxBatches` rather than clearing the backlog. */
  truncated: boolean;
}

/**
 * Seal repeatedly until the backlog is clear or the round limit is reached.
 *
 * One scheduled run should not leave a backlog behind just because it exceeded
 * one tree — but it also cannot run forever inside a function invocation, so
 * the caller caps the rounds and the response says whether the cap was hit.
 */
export async function drainPendingBatches(
  prisma: PrismaClient,
  options: { maxBatches?: number; limit?: number } = {},
): Promise<DrainResult> {
  const maxBatches = Math.max(1, options.maxBatches ?? 4);
  const batches: BatchResult[] = [];

  for (let round = 0; round < maxBatches; round += 1) {
    const result = await sealPendingBatch(prisma, { limit: options.limit });
    if (!result) break;
    batches.push(result);
  }

  const remaining = await prisma.decision.count({ where: { proof: null } });

  return { batches, remaining, truncated: batches.length === maxBatches && remaining > 0 };
}
