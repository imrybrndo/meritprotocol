import type { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { clientIdentifier, ok, rateLimit, toErrorResponse, tooManyRequests } from "@/lib/api/http";
import { verifyDecision } from "@/lib/services/verification";

export const runtime = "nodejs";

/** POST /api/v1/proofs/:id/verify — run the full check chain for one decision. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const limit = await rateLimit(`proof-verify:${clientIdentifier(request)}`, 60);
    if (!limit.allowed) return tooManyRequests(limit);

    const { id } = await params;
    const prisma = getPrisma();
    const result = await verifyDecision(prisma, id);

    await prisma.verificationRequest
      .create({
        data: { queryType: "decision", query: id, valid: result.valid, checks: result.checks as never },
      })
      .catch(() => undefined);

    return ok(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
