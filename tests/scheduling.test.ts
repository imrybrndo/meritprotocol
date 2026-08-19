/**
 * The scheduling layer: when a batch gets sealed, and who is allowed to ask.
 *
 * Neither of these needs a database. The policy is a decision about two
 * numbers, and the credential check is a string comparison — both are worth
 * testing precisely because the consequences of getting them wrong are a
 * decision that never gets anchored, or an open endpoint that spends money.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateSealPolicy, getSealPolicy, DEFAULT_BATCH_SIZE } from "@/lib/services/batching";
import { authorizeCron, CronAuthError } from "@/lib/api/cron";
import type { PrismaClient } from "@/lib/generated/prisma/client";

const MINUTE = 60_000;

/** The only two reads `evaluateSealPolicy` performs. */
function fakePrisma(pending: number, oldestAgeMs: number | null): PrismaClient {
  return {
    decision: {
      count: async () => pending,
      findFirst: async () =>
        oldestAgeMs === null
          ? null
          : { committedAt: new Date(Date.now() - oldestAgeMs) },
    },
  } as unknown as PrismaClient;
}

describe("seal policy", () => {
  const original = { ...process.env };

  beforeEach(() => {
    delete process.env.MERIT_SEAL_MIN_BATCH;
    delete process.env.MERIT_SEAL_MAX_AGE_MINUTES;
    delete process.env.MERIT_SEAL_MAX_BATCH;
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("falls back to sane defaults with nothing configured", () => {
    const policy = getSealPolicy();
    expect(policy.minBatchSize).toBe(32);
    expect(policy.maxAgeMs).toBe(60 * MINUTE);
    expect(policy.maxBatchSize).toBe(DEFAULT_BATCH_SIZE);
  });

  it("reads thresholds from the environment", () => {
    process.env.MERIT_SEAL_MIN_BATCH = "8";
    process.env.MERIT_SEAL_MAX_AGE_MINUTES = "15";
    const policy = getSealPolicy();
    expect(policy.minBatchSize).toBe(8);
    expect(policy.maxAgeMs).toBe(15 * MINUTE);
  });

  it("ignores junk rather than sealing on a NaN threshold", () => {
    process.env.MERIT_SEAL_MIN_BATCH = "not-a-number";
    process.env.MERIT_SEAL_MAX_AGE_MINUTES = "-5";
    const policy = getSealPolicy();
    expect(policy.minBatchSize).toBe(32);
    expect(policy.maxAgeMs).toBe(60 * MINUTE);
  });

  it("never lets a batch exceed the Merkle batch cap", () => {
    process.env.MERIT_SEAL_MAX_BATCH = "100000";
    process.env.MERIT_SEAL_MIN_BATCH = "100000";
    const policy = getSealPolicy();
    expect(policy.maxBatchSize).toBe(DEFAULT_BATCH_SIZE);
    expect(policy.minBatchSize).toBeLessThanOrEqual(policy.maxBatchSize);
  });

  it("does nothing when there is nothing pending", async () => {
    const decision = await evaluateSealPolicy(fakePrisma(0, null));
    expect(decision.shouldSeal).toBe(false);
    expect(decision.pending).toBe(0);
  });

  it("seals once the count threshold is reached", async () => {
    const decision = await evaluateSealPolicy(fakePrisma(32, 1 * MINUTE));
    expect(decision.shouldSeal).toBe(true);
    expect(decision.reason).toContain("threshold");
  });

  it("holds a small batch that is still fresh", async () => {
    const decision = await evaluateSealPolicy(fakePrisma(3, 5 * MINUTE));
    expect(decision.shouldSeal).toBe(false);
  });

  /**
   * The reason the age trigger exists: without it a single decision in a quiet
   * week stays unproven indefinitely, which is exactly the state the protocol
   * promises not to leave a record in.
   */
  it("seals a single stale commitment even far below the count threshold", async () => {
    const decision = await evaluateSealPolicy(fakePrisma(1, 90 * MINUTE));
    expect(decision.shouldSeal).toBe(true);
    expect(decision.reason).toContain("waited");
  });

  it("holds at exactly one under the threshold and seals at it", async () => {
    expect((await evaluateSealPolicy(fakePrisma(31, MINUTE))).shouldSeal).toBe(false);
    expect((await evaluateSealPolicy(fakePrisma(32, MINUTE))).shouldSeal).toBe(true);
  });
});

describe("scheduler credential", () => {
  // NODE_ENV is readonly in the app's type environment; stubEnv is the
  // supported way to move it for the duration of a test.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const withHeader = (value: string | null) =>
    new Request("https://merit.test/api/cron/seal", {
      headers: value === null ? {} : { authorization: value },
    });

  it("accepts the configured secret", () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => authorizeCron(withHeader("Bearer s3cret-value"))).not.toThrow();
  });

  it("rejects a wrong secret", () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => authorizeCron(withHeader("Bearer wrong"))).toThrow(CronAuthError);
  });

  it("rejects a missing header", () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => authorizeCron(withHeader(null))).toThrow(CronAuthError);
  });

  it("rejects a bare token without the Bearer scheme", () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => authorizeCron(withHeader("s3cret-value"))).toThrow(CronAuthError);
  });

  /**
   * The important one. An unconfigured deployment must refuse to run the
   * scheduled routes, not run them for anyone who finds the URL — these seal
   * batches and pay for anchor transactions.
   */
  it("stays closed when no secret is configured in production", () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");

    let thrown: unknown;
    try {
      authorizeCron(withHeader("Bearer anything"));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CronAuthError);
    expect((thrown as CronAuthError).status).toBe(503);
  });

  it("stays open in development so an unconfigured checkout still works", () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(() => authorizeCron(withHeader(null))).not.toThrow();
  });
});
