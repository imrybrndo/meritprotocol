import type { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import {
  clientIdentifier,
  ok,
  parseBody,
  rateLimit,
  rateLimitHeaders,
  toErrorResponse,
  tooManyRequests,
} from "@/lib/api/http";
import { verifySchema } from "@/lib/validation/schemas";
import { verifyDecision } from "@/lib/services/verification";

export const runtime = "nodejs";

/**
 * POST /api/v1/verify — independent verification.
 *
 * Deliberately unauthenticated. Verification that required MERIT's permission
 * would not be independent.
 */
export async function POST(request: NextRequest) {
  try {
    const limit = await rateLimit(`verify:${clientIdentifier(request)}`, 60);
    if (!limit.allowed) return tooManyRequests(limit);

    const body = await parseBody(request, verifySchema);
    const prisma = getPrisma();
    const result = await verifyDecision(prisma, body.query);

    // Every attempt is logged, so the verification surface is itself auditable.
    await prisma.verificationRequest
      .create({
        data: {
          queryType: body.type,
          query: body.query,
          valid: result.valid,
          checks: result.checks as never,
        },
      })
      .catch(() => undefined);

    return ok(result, { headers: rateLimitHeaders(limit) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** GET /api/v1/verify?query=… — same check, link-friendly. */
export async function GET(request: NextRequest) {
  try {
    const limit = await rateLimit(`verify:${clientIdentifier(request)}`, 60);
    if (!limit.allowed) return tooManyRequests(limit);

    const query = request.nextUrl.searchParams.get("query");
    if (!query) {
      return toErrorResponse(
        new Error("Missing required 'query' parameter"),
      );
    }

    const result = await verifyDecision(getPrisma(), query);
    return ok(result, { headers: rateLimitHeaders(limit) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
