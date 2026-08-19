import type { NextRequest } from "next/server";
import { authenticate } from "@/lib/api/auth";
import {
  clientIdentifier,
  ok,
  rateLimit,
  rateLimitHeaders,
  toErrorResponse,
  tooManyRequests,
} from "@/lib/api/http";

export const runtime = "nodejs";

/**
 * GET /api/v1/session — who is this key?
 *
 * Every other authenticated route writes something, which leaves a client with
 * no way to check a credential except by using it. This is that check: it reads
 * nothing but the key's own record, so an operator console can verify a key at
 * sign-in instead of discovering at the first commit that it was mistyped or
 * revoked.
 *
 * It returns only what the holder of the key already knows — the public prefix,
 * the label they chose, and the scopes it carries. Never the digest, and
 * nothing about the account behind it.
 */
export async function GET(request: NextRequest) {
  try {
    // Limited before authentication, unlike the write routes: this is the one
    // endpoint whose whole purpose is to answer "is this key good?", so the
    // rejection path is the one worth throttling.
    const limit = await rateLimit(`session:${clientIdentifier(request)}`, 60);
    if (!limit.allowed) return tooManyRequests(limit);

    const key = await authenticate(request);

    return ok(
      { prefix: key.prefix, label: key.label, scopes: key.scopes },
      { headers: rateLimitHeaders(limit) },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
