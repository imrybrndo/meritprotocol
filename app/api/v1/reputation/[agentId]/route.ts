import type { NextRequest } from "next/server";
import { apiError, clientIdentifier, ok, rateLimit, toErrorResponse, tooManyRequests } from "@/lib/api/http";
import { getPrisma } from "@/lib/db";
import { buildAgentSummaries } from "@/lib/services/queries";
import { getScoreHistory, getTierHistory } from "@/lib/services/reputation";
import { WEIGHTS } from "@/lib/reputation/engine";

export const runtime = "nodejs";

/**
 * GET /api/v1/reputation/:agentId
 *
 * Returns the components and the weights alongside the score, so the number is
 * reproducible by the caller rather than taken on trust.
 *
 * `?history=1` adds the recorded score and tier history. That history is
 * written by the scheduled snapshot run, so it is empty on a deployment where
 * the scheduler has never run — reported as an empty array rather than as
 * interpolated points, because a score MERIT never recorded is not a
 * measurement.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const limit = await rateLimit(`reputation:${clientIdentifier(request)}`);
    if (!limit.allowed) return tooManyRequests(limit);

    const { agentId } = await params;
    const wantsHistory = ["1", "true"].includes(
      (request.nextUrl.searchParams.get("history") ?? "").toLowerCase(),
    );
    const summaries = await buildAgentSummaries(500);
    const agent = summaries.find((entry) => entry.id === agentId || entry.slug === agentId);

    if (!agent) return apiError("AGENT_NOT_FOUND", "No agent matches this identifier", 404);

    return ok({
      agentId: agent.id,
      slug: agent.slug,
      score: agent.score,
      confidence: agent.confidence,
      tier: agent.tier,
      components: agent.components,
      weights: WEIGHTS,
      sampleSize: agent.tradeCount,
      metrics: {
        roi: agent.roi,
        winRate: agent.winRate,
        maxDrawdown: agent.maxDrawdown,
        sharpeRatio: agent.sharpeRatio,
        sortinoRatio: agent.sortinoRatio,
        profitFactor: agent.profitFactor,
        tradeCount: agent.tradeCount,
        netPnl: agent.netPnl,
      },
      proofCoverage: agent.proofCoverage,
      ...(wantsHistory
        ? {
            history: (await getScoreHistory(getPrisma(), agent.id)).map((point) => ({
              score: point.score,
              rawScore: point.rawScore,
              confidence: point.confidence,
              components: point.components,
              sampleSize: point.sampleSize,
              operatingDays: point.operatingDays,
              computedAt: point.computedAt.toISOString(),
            })),
            tierHistory: (await getTierHistory(getPrisma(), agent.id)).map((event) => ({
              tier: event.tier,
              nextTier: event.nextTier,
              achievedAt: event.achievedAt.toISOString(),
            })),
          }
        : {}),
      note: "Score is derived from verified records only. Token holdings are not an input.",
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
