import type { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { apiError, clientIdentifier, ok, rateLimit, toErrorResponse, tooManyRequests } from "@/lib/api/http";
import { countCorrections } from "@/lib/services/corrections";

export const runtime = "nodejs";

/**
 * GET /api/v1/agents/:id/history — the full decision history.
 *
 * There is no filter that removes losses. `status` may narrow the view, but the
 * unfiltered default is the complete record, wins and losses alike.
 *
 * Each row carries its correction count. An amended decision has to be visible
 * as amended from the same read that returns it — a correction filed where the
 * history does not show it would be a private edit with extra steps.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const limit = await rateLimit(`history:${clientIdentifier(request)}`);
    if (!limit.allowed) return tooManyRequests(limit);

    const { id } = await params;
    const prisma = getPrisma();

    const agent = await prisma.agent.findFirst({
      where: { OR: [{ id }, { slug: id }] },
      select: { id: true, slug: true, name: true },
    });
    if (!agent) return apiError("AGENT_NOT_FOUND", "No agent matches this identifier", 404);

    const searchParams = request.nextUrl.searchParams;
    const take = Math.min(200, Number(searchParams.get("limit") ?? 100));
    const skip = Math.max(0, Number(searchParams.get("offset") ?? 0));
    const status = searchParams.get("status") ?? undefined;

    const [total, decisions] = await Promise.all([
      prisma.decision.count({ where: { agentId: agent.id, ...(status ? { status: status as never } : {}) } }),
      prisma.decision.findMany({
        where: { agentId: agent.id, ...(status ? { status: status as never } : {}) },
        orderBy: { decidedAt: "desc" },
        take,
        skip,
        select: {
          id: true,
          asset: true,
          action: true,
          price: true,
          quantity: true,
          confidence: true,
          status: true,
          commitmentHash: true,
          decidedAt: true,
          committedAt: true,
          isDemo: true,
          strategyVersion: { select: { version: true, model: true, modelVersion: true } },
          proof: { select: { leafIndex: true, batch: { select: { sequence: true, merkleRoot: true } } } },
          outcome: {
            select: {
              entryPrice: true,
              exitPrice: true,
              realizedPnl: true,
              roi: true,
              fees: true,
              slippage: true,
              holdingPeriodMs: true,
              outcomeHash: true,
              settledAt: true,
            },
          },
        },
      }),
    ]);

    const corrections = await countCorrections(prisma, decisions.map((d) => d.id));

    return ok({
      agent,
      total,
      decisions: decisions.map((decision) => ({
        id: decision.id,
        asset: decision.asset,
        action: decision.action,
        price: decision.price.toFixed(8),
        quantity: decision.quantity.toFixed(8),
        confidence: decision.confidence.toFixed(4),
        status: decision.status,
        commitmentHash: decision.commitmentHash,
        decidedAt: decision.decidedAt.toISOString(),
        committedAt: decision.committedAt.toISOString(),
        isDemo: decision.isDemo,
        corrections: corrections.get(decision.id) ?? 0,
        strategyVersion: decision.strategyVersion.version,
        model: decision.strategyVersion.model,
        modelVersion: decision.strategyVersion.modelVersion,
        proof: decision.proof
          ? {
              leafIndex: decision.proof.leafIndex,
              batchSequence: decision.proof.batch.sequence,
              merkleRoot: decision.proof.batch.merkleRoot,
            }
          : null,
        outcome: decision.outcome
          ? {
              entryPrice: decision.outcome.entryPrice.toFixed(8),
              exitPrice: decision.outcome.exitPrice.toFixed(8),
              realizedPnl: decision.outcome.realizedPnl.toFixed(8),
              roi: decision.outcome.roi.toFixed(8),
              fees: decision.outcome.fees.toFixed(8),
              slippage: decision.outcome.slippage.toFixed(8),
              holdingPeriodMs: Number(decision.outcome.holdingPeriodMs),
              outcomeHash: decision.outcome.outcomeHash,
              settledAt: decision.outcome.settledAt.toISOString(),
            }
          : null,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
