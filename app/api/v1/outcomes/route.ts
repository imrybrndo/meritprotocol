import type { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { audit, authenticate, requireScope } from "@/lib/api/auth";
import {
  created,
  parseBody,
  rateLimit,
  toErrorResponse,
  tooManyRequests,
} from "@/lib/api/http";
import { createOutcomeSchema } from "@/lib/validation/schemas";
import { recordOutcome } from "@/lib/services/decisions";

export const runtime = "nodejs";

/**
 * POST /api/v1/outcomes — reveal the result of a committed decision.
 *
 * PnL, ROI and holding period are derived server-side. A decision that already
 * has an outcome is rejected with 409; corrections are separate records.
 */
export async function POST(request: NextRequest) {
  try {
    const key = await authenticate(request);
    requireScope(key, "outcomes:write");

    const limit = rateLimit(`outcomes:${key.id}`, 600);
    if (!limit.allowed) return tooManyRequests(limit);

    const body = await parseBody(request, createOutcomeSchema);
    const outcome = await recordOutcome(getPrisma(), body);

    await audit({
      key,
      action: "outcome.reveal",
      subjectId: outcome.decisionId,
      request,
      metadata: { status: outcome.status },
    });

    return created(outcome);
  } catch (error) {
    return toErrorResponse(error);
  }
}
