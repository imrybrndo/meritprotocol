import type { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { apiError, clientIdentifier, ok, rateLimit, toErrorResponse, tooManyRequests } from "@/lib/api/http";

export const runtime = "nodejs";

/** GET /api/v1/outcomes/:id — by outcome id, decision id or outcome hash. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const limit = await rateLimit(`outcome:${clientIdentifier(request)}`);
    if (!limit.allowed) return tooManyRequests(limit);

    const { id } = await params;
    const outcome = await getPrisma().outcome.findFirst({
      where: { OR: [{ id }, { decisionId: id }, { outcomeHash: id.toLowerCase() }] },
      include: { decision: { select: { id: true, agentId: true, commitmentHash: true, action: true, asset: true } } },
    });

    if (!outcome) return apiError("OUTCOME_NOT_FOUND", "No outcome matches this identifier", 404);

    return ok({
      id: outcome.id,
      decision: outcome.decision,
      entryPrice: outcome.entryPrice.toFixed(8),
      exitPrice: outcome.exitPrice.toFixed(8),
      quantity: outcome.quantity.toFixed(8),
      fees: outcome.fees.toFixed(8),
      slippage: outcome.slippage.toFixed(8),
      grossPnl: outcome.grossPnl.toFixed(8),
      realizedPnl: outcome.realizedPnl.toFixed(8),
      roi: outcome.roi.toFixed(8),
      notional: outcome.notional.toFixed(8),
      holdingPeriodMs: Number(outcome.holdingPeriodMs),
      outcomeHash: outcome.outcomeHash,
      settledAt: outcome.settledAt.toISOString(),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
