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
import {
  CHALLENGE_TTL_MS,
  challengeMessage,
  createNonce,
  parseAddress,
} from "@/lib/api/wallet-auth";
import { walletChallengeSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

/**
 * POST /api/v1/auth/challenge — issue a nonce for a wallet to sign.
 *
 * Public by definition: asking for a challenge proves nothing and grants
 * nothing. Only a signature over the returned text does.
 */
export async function POST(request: NextRequest) {
  try {
    const limit = await rateLimit(`auth:challenge:${clientIdentifier(request)}`, 30);
    if (!limit.allowed) return tooManyRequests(limit);

    const body = await parseBody(request, walletChallengeSchema);
    const address = parseAddress(body.address);

    const challenge = await getPrisma().walletChallenge.create({
      data: {
        address,
        nonce: createNonce(),
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      },
      select: { nonce: true, createdAt: true, expiresAt: true },
    });

    return ok(
      {
        nonce: challenge.nonce,
        message: challengeMessage({
          address,
          nonce: challenge.nonce,
          issuedAt: challenge.createdAt,
        }),
        expiresAt: challenge.expiresAt.toISOString(),
      },
      { headers: rateLimitHeaders(limit) },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
