import type { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { authorizeCron } from "@/lib/api/cron";
import { ok, toErrorResponse } from "@/lib/api/http";
import { drainPendingBatches, evaluateSealPolicy, getSealPolicy } from "@/lib/services/batching";

export const runtime = "nodejs";
/// Anchoring waits on a chain confirmation; the default 300s ceiling applies.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/seal — seal and anchor whatever is waiting.
 *
 * Before this route existed the protocol's core loop did not close on its own.
 * `sealPendingBatch` was reachable only from an authenticated write endpoint
 * and a manual script, so a committed decision stayed unproven until a human
 * remembered to run something. Everything the protocol claims about a decision
 * being anchored to a public timeline depended on that person.
 *
 * The schedule runs often; the policy decides whether a run does anything. Most
 * invocations evaluate the backlog, find it below threshold and return without
 * writing — that is the intended behaviour, not a wasted run.
 */
export async function GET(request: NextRequest) {
  try {
    authorizeCron(request);

    const prisma = getPrisma();
    const policy = getSealPolicy();
    const decision = await evaluateSealPolicy(prisma, policy);

    if (!decision.shouldSeal) {
      return ok({
        sealed: false,
        reason: decision.reason,
        pending: decision.pending,
        oldestPendingAt: decision.oldestPendingAt?.toISOString() ?? null,
        policy,
      });
    }

    const result = await drainPendingBatches(prisma, { limit: policy.maxBatchSize });

    return ok({
      sealed: result.batches.length > 0,
      reason: decision.reason,
      batches: result.batches.map((batch) => ({
        id: batch.batchId,
        sequence: batch.sequence,
        merkleRoot: batch.merkleRoot,
        leafCount: batch.leafCount,
        anchored: batch.anchored,
        transactionHash: batch.transactionHash,
        network: batch.network,
        status: batch.status,
      })),
      leavesSealed: result.batches.reduce((sum, batch) => sum + batch.leafCount, 0),
      remaining: result.remaining,
      /// True when the backlog outlived this run and the next one has work left.
      truncated: result.truncated,
      policy,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Vercel Cron issues GET; POST is here so any other scheduler works too. */
export const POST = GET;
