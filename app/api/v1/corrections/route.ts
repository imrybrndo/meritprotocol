import type { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { audit, authenticate, requireScope } from "@/lib/api/auth";
import {
  apiError,
  clientIdentifier,
  created,
  ok,
  parseBody,
  rateLimit,
  toErrorResponse,
  tooManyRequests,
} from "@/lib/api/http";
import { createCorrectionSchema } from "@/lib/validation/schemas";
import { listCorrections, recordCorrection } from "@/lib/services/corrections";

export const runtime = "nodejs";

/**
 * POST /api/v1/corrections — annotate a committed decision.
 *
 * This is the only write in the API that touches an existing record's meaning,
 * and it still does not touch the record: the decision, its commitment and its
 * outcome are unchanged and continue to verify exactly as before.
 */
export async function POST(request: NextRequest) {
  try {
    const key = await authenticate(request);
    requireScope(key, "corrections:write");

    const limit = await rateLimit(`corrections:${key.id}`, 60);
    if (!limit.allowed) return tooManyRequests(limit);

    const body = await parseBody(request, createCorrectionSchema);
    const correction = await recordCorrection(getPrisma(), body);

    await audit({
      key,
      action: "correction.record",
      subjectId: correction.decisionId,
      request,
      metadata: { correctionId: correction.id, reason: correction.reason },
    });

    return created({
      id: correction.id,
      decisionId: correction.decisionId,
      agentId: correction.agentId,
      reason: correction.reason,
      detail: correction.detail,
      createdAt: correction.createdAt.toISOString(),
      delayMs: correction.delayMs,
      /// Said plainly in the response so no client can read this as an edit.
      originalDecisionModified: false,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * GET /api/v1/corrections?decisionId=… — public.
 *
 * Unauthenticated for the same reason verification is: a correction only an
 * agent's own tooling could read would let a record be amended in private,
 * which is the failure this endpoint exists to make impossible.
 */
export async function GET(request: NextRequest) {
  try {
    const limit = await rateLimit(`corrections:list:${clientIdentifier(request)}`);
    if (!limit.allowed) return tooManyRequests(limit);

    const decisionId = request.nextUrl.searchParams.get("decisionId");
    if (!decisionId) {
      return apiError("MISSING_PARAMETER", "decisionId is required", 400);
    }

    const corrections = await listCorrections(getPrisma(), decisionId);

    return ok(
      corrections.map((correction) => ({
        id: correction.id,
        decisionId: correction.decisionId,
        reason: correction.reason,
        detail: correction.detail,
        createdAt: correction.createdAt.toISOString(),
        delayMs: correction.delayMs,
      })),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
