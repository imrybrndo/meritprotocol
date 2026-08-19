/**
 * Shared HTTP plumbing for /api/v1: envelopes, error mapping and rate limits.
 */

import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { DatabaseNotConfiguredError } from "../db";
import { ProtocolError } from "../services/decisions";
import { ForbiddenError, UnauthorizedError } from "./auth";
import { CronAuthError } from "./cron";
import { consume, type RateLimitResult } from "./rate-limit";

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, { status: 200, ...init });
}

export function created<T>(data: T): NextResponse {
  return NextResponse.json({ data }, { status: 201 });
}

export function apiError(
  code: string,
  message: string,
  status: number,
  details?: unknown,
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

/** Map a thrown value onto a stable error envelope. */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return apiError("VALIDATION_FAILED", "Request body failed validation", 422, {
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  if (error instanceof UnauthorizedError) {
    return apiError("UNAUTHORIZED", error.message, 401);
  }
  if (error instanceof ForbiddenError) {
    return apiError("FORBIDDEN", error.message, 403);
  }
  if (error instanceof ProtocolError) {
    return apiError(error.code, error.message, error.status);
  }
  if (error instanceof DatabaseNotConfiguredError) {
    return apiError("DATABASE_UNAVAILABLE", error.message, 503);
  }
  if (error instanceof CronAuthError) {
    return apiError(error.code, error.message, error.status);
  }

  console.error("[api] unhandled error", error);
  return apiError("INTERNAL_ERROR", "Unexpected server error", 500);
}

/** Parse and validate a JSON body. */
export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ZodError([
      {
        code: "custom",
        path: [],
        message: "Request body must be valid JSON",
      },
    ]);
  }
  return schema.parse(raw);
}

/* ------------------------------------------------------------ rate limits -- */

/**
 * Fixed-window limiter.
 *
 * The counting lives in rate-limit.ts, which uses Redis when one is configured
 * and process memory when it is not. This stays the only entry point so the
 * routes never have to know which.
 */
export type { RateLimitResult };

export async function rateLimit(
  identifier: string,
  limit = 120,
  windowMs = 60_000,
): Promise<RateLimitResult> {
  return consume(identifier, limit, windowMs);
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
}

export function tooManyRequests(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Slow down and retry after the reset window.",
      },
    },
    {
      status: 429,
      headers: {
        ...rateLimitHeaders(result),
        "Retry-After": String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))),
      },
    },
  );
}

/** Identify an unauthenticated caller for limiting purposes. */
export function clientIdentifier(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "anonymous"
  );
}
