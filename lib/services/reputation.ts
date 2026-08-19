/**
 * Reputation snapshots.
 *
 * A score computed on the fly answers "what is this agent worth now" and
 * nothing else. It cannot show that an agent was rated 78 before a drawdown, or
 * when it reached SILVER, and it gives an observer no way to check that the
 * figure on a profile today is the one the protocol actually derived.
 *
 * So the score is also written down. Snapshots are append-only like everything
 * else here — a score is never updated in place, because the point of the
 * history is that it cannot be tidied up after a bad month.
 *
 * A snapshot is only written when the picture actually moved. Recording an
 * identical score every hour would bury the transitions that matter under noise
 * and grow the table without adding a single fact.
 */

import type { PrismaClient, Prisma } from "../generated/prisma/client";
import type { Tier } from "../qualification/tiers";
import { emitEvent } from "../events";
import { AGENT_PICTURE_SELECT, derivePicture, type AgentPicture } from "./agent-picture";

/**
 * Scores are stored at two decimals, so anything below that is not a change —
 * it is the same stored number computed twice.
 */
const SCORE_EPSILON = 0.005;

const round2 = (value: number): number => Math.round(value * 100) / 100;

export interface SnapshotResult {
  agentId: string;
  slug: string;
  written: boolean;
  reason: string;
  score: number;
  previousScore: number | null;
  tier: Tier;
  previousTier: Tier | null;
  tierChanged: boolean;
}

/**
 * Decide whether this picture differs from the last one on record.
 *
 * Tier is checked as well as score because a tier can change without the score
 * moving at all — crossing a decision count or an operating-history threshold
 * promotes an agent whose score sat still.
 */
function describeChange(
  picture: AgentPicture,
  previous: { score: number; tier: Tier } | null,
): { changed: boolean; reason: string } {
  const score = round2(picture.reputation.score);
  const tier = picture.qualification.tier;

  if (!previous) return { changed: true, reason: "First snapshot" };

  if (previous.tier !== tier) {
    return { changed: true, reason: `Tier moved ${previous.tier} → ${tier}` };
  }

  if (Math.abs(previous.score - score) >= SCORE_EPSILON) {
    return {
      changed: true,
      reason: `Score moved ${previous.score.toFixed(2)} → ${score.toFixed(2)}`,
    };
  }

  return { changed: false, reason: "Unchanged since the last snapshot" };
}

/**
 * Record one agent's current reputation and tier, if either has moved.
 *
 * The write is transactional: a score without its qualification would leave the
 * two histories disagreeing about the same instant.
 */
export async function snapshotAgent(
  prisma: PrismaClient,
  agentId: string,
): Promise<SnapshotResult | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, slug: true, decisions: AGENT_PICTURE_SELECT },
  });
  if (!agent) return null;

  const picture = derivePicture(agent.decisions);

  const [lastScore, lastQualification] = await Promise.all([
    prisma.reputationScore.findFirst({
      where: { agentId: agent.id },
      orderBy: { computedAt: "desc" },
      select: { score: true },
    }),
    prisma.qualification.findFirst({
      where: { agentId: agent.id },
      orderBy: { achievedAt: "desc" },
      select: { tier: true },
    }),
  ]);

  const previous =
    lastScore && lastQualification
      ? { score: Number(lastScore.score), tier: lastQualification.tier as Tier }
      : null;

  const { changed, reason } = describeChange(picture, previous);
  const score = round2(picture.reputation.score);
  const tier = picture.qualification.tier;
  const tierChanged = previous !== null && previous.tier !== tier;

  const result: SnapshotResult = {
    agentId: agent.id,
    slug: agent.slug,
    written: changed,
    reason,
    score,
    previousScore: previous?.score ?? null,
    tier,
    previousTier: previous?.tier ?? null,
    tierChanged,
  };

  if (!changed) return result;

  const { reputation, metrics, qualification } = picture;

  await prisma.$transaction(async (tx) => {
    await tx.reputationScore.create({
      data: {
        agentId: agent.id,
        score,
        rawScore: round2(reputation.rawScore),
        confidence: Math.round(reputation.confidence * 10_000) / 10_000,
        performance: round2(reputation.components.performance),
        risk: round2(reputation.components.risk),
        drawdown: round2(reputation.components.drawdown),
        consistency: round2(reputation.components.consistency),
        execution: round2(reputation.components.execution),
        integrity: round2(reputation.components.integrity),
        metrics: metrics as unknown as Prisma.InputJsonValue,
        sampleSize: reputation.sampleSize,
        operatingDays: reputation.operatingDays,
      },
    });

    await tx.qualification.create({
      data: {
        agentId: agent.id,
        tier,
        nextTier: qualification.nextTier,
        unmet: qualification.unmet as unknown as Prisma.InputJsonValue,
      },
    });

    await emitEvent(tx, {
      type: "REPUTATION_UPDATED",
      agentId: agent.id,
      subjectId: agent.id,
      payload: {
        score,
        previousScore: previous?.score ?? null,
        tier,
        previousTier: previous?.tier ?? null,
        tierChanged,
        confidence: reputation.confidence,
        sampleSize: reputation.sampleSize,
        operatingDays: reputation.operatingDays,
        reason,
      },
    });
  });

  return result;
}

export interface SnapshotRunResult {
  evaluated: number;
  written: number;
  promotions: SnapshotResult[];
  results: SnapshotResult[];
}

/** Snapshot every agent. Returns what moved and what did not. */
export async function snapshotAllAgents(
  prisma: PrismaClient,
  options: { limit?: number } = {},
): Promise<SnapshotRunResult> {
  const agents = await prisma.agent.findMany({
    take: options.limit ?? 500,
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  const results: SnapshotResult[] = [];
  // Sequential on purpose: each agent's decision set is loaded in full, and
  // running them in parallel would put the whole registry in memory at once.
  for (const agent of agents) {
    const result = await snapshotAgent(prisma, agent.id);
    if (result) results.push(result);
  }

  return {
    evaluated: results.length,
    written: results.filter((r) => r.written).length,
    promotions: results.filter((r) => r.tierChanged),
    results,
  };
}

export interface ScoreHistoryPoint {
  score: number;
  rawScore: number;
  confidence: number;
  components: {
    performance: number;
    risk: number;
    drawdown: number;
    consistency: number;
    execution: number;
    integrity: number;
  };
  sampleSize: number;
  operatingDays: number;
  computedAt: Date;
}

/** An agent's recorded score history, oldest first, for charting. */
export async function getScoreHistory(
  prisma: PrismaClient,
  agentId: string,
  limit = 200,
): Promise<ScoreHistoryPoint[]> {
  const rows = await prisma.reputationScore.findMany({
    where: { agentId },
    orderBy: { computedAt: "desc" },
    take: Math.min(limit, 500),
  });

  return rows
    .map((row) => ({
      score: Number(row.score),
      rawScore: Number(row.rawScore),
      confidence: Number(row.confidence),
      components: {
        performance: Number(row.performance),
        risk: Number(row.risk),
        drawdown: Number(row.drawdown),
        consistency: Number(row.consistency),
        execution: Number(row.execution),
        integrity: Number(row.integrity),
      },
      sampleSize: row.sampleSize,
      operatingDays: row.operatingDays,
      computedAt: row.computedAt,
    }))
    .reverse();
}

export interface TierEvent {
  tier: Tier;
  nextTier: Tier | null;
  achievedAt: Date;
}

/** An agent's tier history, oldest first. */
export async function getTierHistory(
  prisma: PrismaClient,
  agentId: string,
  limit = 100,
): Promise<TierEvent[]> {
  const rows = await prisma.qualification.findMany({
    where: { agentId },
    orderBy: { achievedAt: "desc" },
    take: Math.min(limit, 200),
    select: { tier: true, nextTier: true, achievedAt: true },
  });

  return rows
    .map((row) => ({
      tier: row.tier as Tier,
      nextTier: (row.nextTier as Tier | null) ?? null,
      achievedAt: row.achievedAt,
    }))
    .reverse();
}
