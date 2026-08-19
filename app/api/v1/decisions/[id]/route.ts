import type { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { apiError, clientIdentifier, ok, rateLimit, toErrorResponse, tooManyRequests } from "@/lib/api/http";

export const runtime = "nodejs";

/** GET /api/v1/decisions/:id */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const limit = await rateLimit(`decision:${clientIdentifier(request)}`);
    if (!limit.allowed) return tooManyRequests(limit);

    const { id } = await params;
    const decision = await getPrisma().decision.findFirst({
      where: { OR: [{ id }, { commitmentHash: id.toLowerCase() }] },
      include: {
        agent: { select: { id: true, slug: true, name: true } },
        strategyVersion: { select: { version: true, model: true, modelVersion: true, configHash: true } },
        outcome: true,
        proof: { include: { batch: { include: { anchor: true } } } },
      },
    });

    if (!decision) return apiError("DECISION_NOT_FOUND", "No decision matches this identifier", 404);

    return ok({
      id: decision.id,
      agent: decision.agent,
      asset: decision.asset,
      action: decision.action,
      price: decision.price.toFixed(8),
      quantity: decision.quantity.toFixed(8),
      confidence: decision.confidence.toFixed(4),
      status: decision.status,
      commitmentHash: decision.commitmentHash,
      nonce: decision.nonce,
      metadata: decision.metadata,
      decidedAt: decision.decidedAt.toISOString(),
      committedAt: decision.committedAt.toISOString(),
      expiresAt: decision.expiresAt?.toISOString() ?? null,
      isDemo: decision.isDemo,
      strategyVersion: decision.strategyVersion,
      outcome: decision.outcome
        ? {
            entryPrice: decision.outcome.entryPrice.toFixed(8),
            exitPrice: decision.outcome.exitPrice.toFixed(8),
            quantity: decision.outcome.quantity.toFixed(8),
            fees: decision.outcome.fees.toFixed(8),
            slippage: decision.outcome.slippage.toFixed(8),
            grossPnl: decision.outcome.grossPnl.toFixed(8),
            realizedPnl: decision.outcome.realizedPnl.toFixed(8),
            roi: decision.outcome.roi.toFixed(8),
            notional: decision.outcome.notional.toFixed(8),
            holdingPeriodMs: Number(decision.outcome.holdingPeriodMs),
            outcomeHash: decision.outcome.outcomeHash,
            settledAt: decision.outcome.settledAt.toISOString(),
          }
        : null,
      proof: decision.proof
        ? {
            leafHash: decision.proof.leafHash,
            leafIndex: decision.proof.leafIndex,
            path: decision.proof.path,
            batch: {
              sequence: decision.proof.batch.sequence,
              merkleRoot: decision.proof.batch.merkleRoot,
              leafCount: decision.proof.batch.leafCount,
              status: decision.proof.batch.status,
            },
            anchor: decision.proof.batch.anchor
              ? {
                  network: decision.proof.batch.anchor.network,
                  transactionHash: decision.proof.batch.anchor.transactionHash,
                  blockNumber: decision.proof.batch.anchor.blockNumber?.toString() ?? null,
                  status: decision.proof.batch.anchor.status,
                  explorerUrl: decision.proof.batch.anchor.explorerUrl,
                }
              : null,
          }
        : null,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
