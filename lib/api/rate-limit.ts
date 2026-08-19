/**
 * The rate-limit store.
 *
 * In-process counting is correct for one instance and useless across many: on
 * Vercel every serverless instance gets its own Map, so a limit of 60 becomes
 * 60 per instance and resets whenever one is recycled. That matters most for
 * the two endpoints where it is the actual defence — the wallet challenge and
 * the signature exchange.
 *
 * So: Redis when it is configured, memory when it is not. Local development and
 * self-hosting keep working with no external service, and production gets a
 * counter every instance shares.
 *
 * Talking to Upstash over its REST API rather than through a client library —
 * it is one POST with a pipeline of three commands, and a dependency that only
 * ever issues that request is not carrying its weight.
 */

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Vercel's KV integration and a direct Upstash database publish the same pair
 * of variables under different names; accept either rather than making the
 * operator rename them.
 */
function redisConfig(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

function memory(identifier: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(identifier);

  if (!existing || existing.resetAt <= now) {
    const bucket = { count: 1, resetAt: now + windowMs };
    buckets.set(identifier, bucket);
    return { allowed: true, limit, remaining: limit - 1, resetAt: bucket.resetAt };
  }

  existing.count += 1;
  return {
    allowed: existing.count <= limit,
    limit,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
  };
}

/**
 * One round trip: count the hit, start the window if this hit opened it, and
 * read back how long is left.
 *
 * `EXPIRE … NX` only sets the TTL when the key has none, so a burst inside one
 * window cannot keep pushing the reset time forward — without it a client
 * hitting the endpoint continuously would never be released.
 */
async function redis(
  config: { url: string; token: string },
  identifier: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const key = `ratelimit:${identifier}`;
  const seconds = Math.max(1, Math.ceil(windowMs / 1000));

  const response = await fetch(`${config.url}/pipeline`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", key],
      ["EXPIRE", key, String(seconds), "NX"],
      ["TTL", key],
    ]),
    // A limiter must not become the slowest thing in the request.
    signal: AbortSignal.timeout(1_000),
  });

  if (!response.ok) throw new Error(`Upstash answered ${response.status}`);

  const results = (await response.json()) as Array<{ result?: unknown; error?: string }>;
  const failed = results.find((entry) => entry.error);
  if (failed) throw new Error(failed.error);

  const count = Number(results[0]?.result);
  const ttl = Number(results[2]?.result);
  if (!Number.isFinite(count)) throw new Error("Upstash returned no count");

  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    // A missing TTL should not produce a reset time in the past.
    resetAt: Date.now() + (ttl > 0 ? ttl : seconds) * 1000,
  };
}

let warned = false;

/**
 * Count one hit against `identifier`.
 *
 * Deliberately fails open to the in-process counter: if the store is
 * unreachable, the choice is between a weaker limit and a dead API, and an
 * outage caused by the rate limiter is worse than the rate limiter being
 * per-instance for a few minutes.
 */
export async function consume(
  identifier: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const config = redisConfig();
  if (!config) return memory(identifier, limit, windowMs);

  try {
    return await redis(config, identifier, limit, windowMs);
  } catch (error) {
    if (!warned) {
      warned = true;
      console.error("[rate-limit] store unreachable; counting in memory instead", error);
    }
    return memory(identifier, limit, windowMs);
  }
}

/** Whether a shared store is configured, for the health surface. */
export function isShared(): boolean {
  return redisConfig() !== null;
}
