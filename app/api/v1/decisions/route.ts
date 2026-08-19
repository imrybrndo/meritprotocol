import type { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { audit, authenticate, requireScope } from "@/lib/api/auth";
import {
  clientIdentifier,
  created,
  ok,
  parseBody,
  rateLimit,
  rateLimitHeaders,
  toErrorResponse,
  tooManyRequests,
} from "@/lib/api/http";
import { createDecisionSchema } from "@/lib/validation/schemas";
import { recordDecision } from "@/lib/services/decisions";

export const runtime = "nodejs";

/** POST /api/v1/decisions — commit a decision before its outcome is known. */
export async function POST(request: NextRequest) {
  try {
    const key = await authenticate(request);
    requireScope(key, "decisions:write");

    const limit = await rateLimit(`decisions:${key.id}`, 600);
    if (!limit.allowed) return tooManyRequests(limit);

    const body = await parseBody(request, createDecisionSchema);
    const decision = await recordDecision(getPrisma(), body);

    await audit({
      key,
      action: "decision.commit",
      subjectId: decision.id,
      request,
      metadata: { replayed: decision.replayed },
    });

    const payload = {
      id: decision.id,
      commitmentHash: decision.commitmentHash,
      status: decision.status,
      decidedAt: decision.decidedAt.toISOString(),
      committedAt: decision.committedAt.toISOString(),
      sealed: true,
    };

    // A replayed idempotent request is a 200, not a fresh 201.
    return decision.replayed
      ? ok(payload, { headers: rateLimitHeaders(limit) })
      : created(payload);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** GET /api/v1/decisions — public, paginated decision feed. */
export async function GET(request: NextRequest) {
  try {
    const limit = await rateLimit(`decisions:list:${clientIdentifier(request)}`);
    if (!limit.allowed) return tooManyRequests(limit);

    const params = request.nextUrl.searchParams;
    const take = Math.min(100, Number(params.get("limit") ?? 50));
    const skip = Math.max(0, Number(params.get("offset") ?? 0));
    const agentId = params.get("agentId") ?? undefined;
    const status = params.get("status") ?? undefined;

    const decisions = await getPrisma().decision.findMany({
      where: {
        ...(agentId ? { agentId } : {}),
        ...(status ? { status: status as never } : {}),
      },
      orderBy: { committedAt: "desc" },
      take,
      skip,
      select: {
        id: true,
        agentId: true,
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
        proof: { select: { batchId: true } },
        outcome: { select: { realizedPnl: true, roi: true, settledAt: true } },
      },
    });

    return ok(
      decisions.map((decision) => ({
        id: decision.id,
        agentId: decision.agentId,
        asset: decision.asset,
        action: decision.action,
        price: decision.price.toFixed(8),
        quantity: decision.quantity.toFixed(8),
        confidence: decision.confidence.toFixed(4),
        status: decision.status,
        commitmentHash: decision.commitmentHash,
        decidedAt: decision.decidedAt.toISOString(),
        committedAt: decision.committedAt.toISOString(),
        batched: decision.proof !== null,
        isDemo: decision.isDemo,
        outcome: decision.outcome
          ? {
              realizedPnl: decision.outcome.realizedPnl.toFixed(8),
              roi: decision.outcome.roi.toFixed(8),
              settledAt: decision.outcome.settledAt.toISOString(),
            }
          : null,
      })),
      { headers: rateLimitHeaders(limit) },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
