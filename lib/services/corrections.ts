/**
 * Corrections.
 *
 * A committed decision has no update path and no delete path. That is the whole
 * point — hiding a loss is the failure this protocol exists to prevent — but it
 * leaves a real problem unanswered: agents do make honest mistakes, and a
 * record with no way to say "this figure was wrong" forces the operator to
 * choose between an inaccurate history and no history at all.
 *
 * A correction is the answer, and it is deliberately not an edit. The original
 * decision, its commitment and its outcome all stay exactly as they were and
 * still verify. The correction is a new row pointing at them, timestamped after
 * the fact, and it is public. Anyone reading the record sees both the original
 * claim and the amendment, along with how long the amendment took to arrive.
 *
 * This is strictly weaker than mutability, and that is the intent: an agent can
 * annotate its record but can never make the original disappear.
 */

import type { PrismaClient, Prisma } from "../generated/prisma/client";
import { emitEvent } from "../events";
import { ProtocolError } from "./decisions";

export interface RecordCorrectionInput {
  decisionId: string;
  reason: string;
  detail?: Record<string, unknown>;
}

export interface RecordedCorrection {
  id: string;
  decisionId: string;
  agentId: string;
  reason: string;
  detail: unknown;
  createdAt: Date;
  /** How long after the original commitment the correction arrived. */
  delayMs: number;
}

/**
 * How many corrections one decision may carry.
 *
 * Without a cap, "append a correction" becomes an unbounded channel for
 * rewriting the meaning of a record by burying it — a hundred amendments say
 * nothing except that the original is no longer readable.
 */
export const MAX_CORRECTIONS_PER_DECISION = 5;

export async function recordCorrection(
  prisma: PrismaClient,
  input: RecordCorrectionInput,
): Promise<RecordedCorrection> {
  const decision = await prisma.decision.findUnique({
    where: { id: input.decisionId },
    select: { id: true, agentId: true, committedAt: true },
  });

  if (!decision) {
    throw new ProtocolError(
      "No decision matches this identifier",
      "DECISION_NOT_FOUND",
      404,
    );
  }

  const existing = await prisma.correction.count({
    where: { decisionId: decision.id },
  });

  if (existing >= MAX_CORRECTIONS_PER_DECISION) {
    throw new ProtocolError(
      `A decision may carry at most ${MAX_CORRECTIONS_PER_DECISION} corrections`,
      "CORRECTION_LIMIT_REACHED",
      409,
    );
  }

  const detail = (input.detail ?? {}) as Prisma.InputJsonValue;

  const correction = await prisma.$transaction(async (tx) => {
    const row = await tx.correction.create({
      data: {
        decisionId: decision.id,
        reason: input.reason,
        detail,
      },
    });

    await emitEvent(tx, {
      type: "CORRECTION_RECORDED",
      agentId: decision.agentId,
      subjectId: decision.id,
      payload: {
        correctionId: row.id,
        reason: input.reason,
        sequence: existing + 1,
        // Recorded in the event too, so the delay survives even if the
        // correction row is read on its own later.
        delayMs: row.createdAt.getTime() - decision.committedAt.getTime(),
      },
    });

    return row;
  });

  return {
    id: correction.id,
    decisionId: decision.id,
    agentId: decision.agentId,
    reason: correction.reason,
    detail: correction.detail,
    createdAt: correction.createdAt,
    delayMs: correction.createdAt.getTime() - decision.committedAt.getTime(),
  };
}

export interface CorrectionView {
  id: string;
  decisionId: string;
  reason: string;
  detail: unknown;
  createdAt: Date;
  delayMs: number;
}

/** Every correction on a decision, oldest first. Public by design. */
export async function listCorrections(
  prisma: PrismaClient,
  decisionId: string,
): Promise<CorrectionView[]> {
  const rows = await prisma.correction.findMany({
    where: { decisionId },
    orderBy: { createdAt: "asc" },
    include: { decision: { select: { committedAt: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    decisionId: row.decisionId,
    reason: row.reason,
    detail: row.detail,
    createdAt: row.createdAt,
    delayMs: row.createdAt.getTime() - row.decision.committedAt.getTime(),
  }));
}

/**
 * Correction counts for a set of decisions, for list views that need to mark
 * amended rows without loading every correction body.
 */
export async function countCorrections(
  prisma: PrismaClient,
  decisionIds: string[],
): Promise<Map<string, number>> {
  if (decisionIds.length === 0) return new Map();

  const grouped = await prisma.correction.groupBy({
    by: ["decisionId"],
    where: { decisionId: { in: decisionIds } },
    _count: { _all: true },
  });

  return new Map(grouped.map((row) => [row.decisionId, row._count._all]));
}
