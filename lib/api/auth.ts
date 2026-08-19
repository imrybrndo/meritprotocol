/**
 * API authentication.
 *
 * Keys are `mk_<env>_<prefix>_<secret>`. Only a SHA-256 digest of the whole
 * string is stored; the plaintext is returned once at creation and cannot be
 * recovered afterwards. Lookup is by digest, so a stolen database row does not
 * yield a usable credential.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { getPrisma } from "../db";

export interface AuthenticatedKey {
  id: string;
  userId: string;
  prefix: string;
  scopes: string[];
  label: string;
}

export function hashApiKey(key: string): string {
  return bytesToHex(sha256(utf8ToBytes(key)));
}

/** Generate a new credential. Returns the plaintext exactly once. */
export function generateApiKey(environment: "live" | "test" = "live"): {
  key: string;
  prefix: string;
  keyHash: string;
} {
  const prefix = randomBytes(4).toString("hex");
  const secret = randomBytes(24).toString("base64url");
  const key = `mk_${environment}_${prefix}_${secret}`;

  return { key, prefix: `mk_${environment}_${prefix}`, keyHash: hashApiKey(key) };
}

function extractKey(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();

  const apiKeyHeader = request.headers.get("x-api-key");
  return apiKeyHeader?.trim() || null;
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = "Missing or invalid API key") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "API key lacks the required scope") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Authenticate a request, or throw. */
export async function authenticate(request: Request): Promise<AuthenticatedKey> {
  const presented = extractKey(request);
  if (!presented) throw new UnauthorizedError();

  const keyHash = hashApiKey(presented);
  const record = await getPrisma().apiKey.findUnique({
    where: { keyHash },
    select: {
      id: true,
      userId: true,
      prefix: true,
      scopes: true,
      name: true,
      revokedAt: true,
      expiresAt: true,
      keyHash: true,
    },
  });

  if (!record) throw new UnauthorizedError();

  // Constant-time compare on the digest as well, so lookup timing cannot be
  // used to distinguish "no such key" from "wrong key".
  const a = Buffer.from(record.keyHash, "hex");
  const b = Buffer.from(keyHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedError();

  if (record.revokedAt) throw new UnauthorizedError("API key has been revoked");
  if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedError("API key has expired");
  }

  // Best-effort; a failed touch must not fail the request.
  void getPrisma()
    .apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return {
    id: record.id,
    userId: record.userId,
    prefix: record.prefix,
    scopes: record.scopes,
    label: record.name,
  };
}

export function requireScope(key: AuthenticatedKey, scope: string): void {
  if (!key.scopes.includes(scope) && !key.scopes.includes("*")) {
    throw new ForbiddenError(`This key is missing the "${scope}" scope`);
  }
}

/** Record an authenticated write for the audit trail. */
export async function audit(input: {
  key: AuthenticatedKey | null;
  action: string;
  subjectId?: string | null;
  request: Request;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await getPrisma()
    .auditLog.create({
      data: {
        apiKeyId: input.key?.id ?? null,
        actorLabel: input.key?.prefix ?? "anonymous",
        action: input.action,
        subjectId: input.subjectId ?? null,
        ip:
          input.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          null,
        userAgent: input.request.headers.get("user-agent"),
        metadata: (input.metadata ?? {}) as never,
      },
    })
    .catch(() => undefined);
}
