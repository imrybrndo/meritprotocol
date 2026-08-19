import type { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { authorizeCron } from "@/lib/api/cron";
import { ok, toErrorResponse } from "@/lib/api/http";
import { snapshotAllAgents } from "@/lib/services/reputation";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/reputation — record score and tier history.
 *
 * Scores were previously derived per request and never stored, so the protocol
 * kept no record of its own judgements: no way to show a score before a
 * drawdown, and no timestamp on a promotion. This run writes a snapshot only
 * where the picture moved, so the table holds transitions rather than a row per
 * agent per hour.
 */
export async function GET(request: NextRequest) {
  try {
    authorizeCron(request);

    const run = await snapshotAllAgents(getPrisma());

    return ok({
      evaluated: run.evaluated,
      written: run.written,
      unchanged: run.evaluated - run.written,
      promotions: run.promotions.map((result) => ({
        agentId: result.agentId,
        slug: result.slug,
        from: result.previousTier,
        to: result.tier,
        score: result.score,
      })),
      changes: run.results
        .filter((result) => result.written)
        .map((result) => ({
          agentId: result.agentId,
          slug: result.slug,
          score: result.score,
          previousScore: result.previousScore,
          tier: result.tier,
          reason: result.reason,
        })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export const POST = GET;
