/**
 * End-to-end protocol flow.
 *
 * Exercises the exact acceptance path: create agent → register strategy version
 * → commit decision → batch → anchor → reveal outcome → verify → score.
 *
 * Requires a database. Without DATABASE_URL the suite skips rather than fails,
 * so `npm test` stays green on a fresh checkout — but the assertions here are
 * the ones that prove the protocol actually works, so run them before shipping:
 *
 *   DATABASE_URL=… npm test
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { recordDecision, recordOutcome, ProtocolError } from "@/lib/services/decisions";
import { drainPendingBatches, evaluateSealPolicy, sealPendingBatch } from "@/lib/services/batching";
import { MAX_CORRECTIONS_PER_DECISION, listCorrections, recordCorrection } from "@/lib/services/corrections";
import { getScoreHistory, snapshotAgent } from "@/lib/services/reputation";
import { verifyDecision } from "@/lib/services/verification";
import { hashStrategyConfig } from "@/lib/crypto/hash";
import { verifyProofOffline } from "@/packages/sdk/src/verify";
import type { ProofStep } from "@/lib/crypto/merkle";

const connectionString = process.env.DATABASE_URL;
const describeDb = connectionString ? describe : describe.skip;

describeDb("protocol flow", () => {
  let prisma: PrismaClient;
  let userId: string;
  let agentId: string;
  let versionId: string;

  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionString! }) });

    const user = await prisma.user.create({
      data: { email: `test-${suffix}@merit.test`, name: "Integration Test" },
    });
    userId = user.id;

    const agent = await prisma.agent.create({
      data: {
        slug: `TEST-${suffix}`,
        name: "Integration Test Agent",
        description: "Created by the integration suite. Removed on teardown.",
        ownerId: userId,
        walletAddress: `Test${suffix}0000000000000000000000000000`,
        venues: ["drift"],
        assets: ["SOL"],
        riskProfile: "MODERATE",
      },
    });
    agentId = agent.id;

    const strategy = await prisma.strategy.create({
      data: {
        agentId,
        name: "Test Momentum",
        description: "Integration test strategy.",
      },
    });

    const config = { lookbackHours: 4, threshold: 0.6 };
    const version = await prisma.strategyVersion.create({
      data: {
        strategyId: strategy.id,
        version: "1.0.0",
        description: "Initial version.",
        model: "Test Model",
        modelVersion: "1",
        configHash: hashStrategyConfig(config),
        config,
      },
    });
    versionId = version.id;
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    // Cascades remove agents, strategies, decisions, outcomes and proofs.
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("commits a decision and seals it before any outcome exists", async () => {
    const decision = await recordDecision(prisma, {
      agentId,
      strategyVersionId: versionId,
      asset: "SOL",
      action: "BUY",
      price: 182.4,
      quantity: 10,
      confidence: 0.81,
    });

    expect(decision.commitmentHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(decision.status).toBe("OPEN");

    const stored = await prisma.decision.findUnique({
      where: { id: decision.id },
      include: { outcome: true },
    });
    expect(stored?.outcome).toBeNull();
  });

  it("replays an idempotent request instead of double-committing", async () => {
    const key = `idem-${suffix}-${Date.now()}`;
    const input = {
      agentId,
      strategyVersionId: versionId,
      asset: "SOL",
      action: "BUY" as const,
      price: 100,
      quantity: 1,
      confidence: 0.5,
      idempotencyKey: key,
    };

    const first = await recordDecision(prisma, input);
    const second = await recordDecision(prisma, input);

    expect(second.replayed).toBe(true);
    expect(second.id).toBe(first.id);
    expect(second.commitmentHash).toBe(first.commitmentHash);
  });

  it("records abstentions as terminal, not as open positions", async () => {
    const abstention = await recordDecision(prisma, {
      agentId,
      strategyVersionId: versionId,
      asset: "SOL",
      action: "ABSTAIN",
      price: 182.4,
      quantity: 0,
      confidence: 0.2,
    });

    expect(abstention.status).toBe("TRADE_ABSTENTION");

    await expect(
      recordOutcome(prisma, {
        decisionId: abstention.id,
        entryPrice: 182.4,
        exitPrice: 190,
        fees: 0,
        slippage: 0,
      }),
    ).rejects.toThrow(ProtocolError);
  });

  it("runs the full acceptance flow end to end", async () => {
    // 1. commit
    const decision = await recordDecision(prisma, {
      agentId,
      strategyVersionId: versionId,
      asset: "SOL",
      action: "BUY",
      price: 182.4,
      quantity: 10,
      confidence: 0.81,
    });

    // 2. batch + anchor
    const batch = await sealPendingBatch(prisma);
    expect(batch).not.toBeNull();
    expect(batch!.merkleRoot).toMatch(/^0x[0-9a-f]{64}$/);
    expect(batch!.leafCount).toBeGreaterThan(0);

    // 3. reveal
    const outcome = await recordOutcome(prisma, {
      decisionId: decision.id,
      entryPrice: 182.4,
      exitPrice: 194.2,
      fees: 2.14,
      slippage: 0.012,
    });

    expect(outcome.status).toBe("SUCCESS");
    expect(Number(outcome.realizedPnl)).toBeGreaterThan(0);
    // Server-derived: (194.20 - 182.40) * 10 = 118 gross.
    expect(Number(outcome.grossPnl)).toBeCloseTo(118, 6);

    // 4. verify
    const result = await verifyDecision(prisma, decision.id);

    const byId = Object.fromEntries(result.checks.map((c) => [c.id, c.state]));
    expect(byId.DECISION_EXISTS).toBe("PASS");
    expect(byId.COMMITMENT_MATCHES).toBe("PASS");
    expect(byId.COMMITTED_BEFORE_OUTCOME).toBe("PASS");
    expect(byId.MERKLE_INCLUSION).toBe("PASS");
    expect(byId.MERKLE_ROOT_MATCHES).toBe("PASS");
    expect(byId.OUTCOME_MATCHES).toBe("PASS");
    expect(result.checks.some((c) => c.state === "FAIL")).toBe(false);

    // 5. the proof verifies with no MERIT code in the path
    expect(result.proof).not.toBeNull();
    const offline = verifyProofOffline({
      commitmentHash: decision.commitmentHash,
      leafHash: result.proof!.leafHash,
      path: result.proof!.path as ProofStep[],
      merkleRoot: result.proof!.merkleRoot,
    });
    expect(offline.valid).toBe(true);
  }, 60_000);

  it("refuses a second outcome for the same decision", async () => {
    const decision = await recordDecision(prisma, {
      agentId,
      strategyVersionId: versionId,
      asset: "SOL",
      action: "BUY",
      price: 150,
      quantity: 2,
      confidence: 0.6,
    });

    await recordOutcome(prisma, {
      decisionId: decision.id,
      entryPrice: 150,
      exitPrice: 155,
      fees: 0,
      slippage: 0,
    });

    await expect(
      recordOutcome(prisma, {
        decisionId: decision.id,
        entryPrice: 150,
        exitPrice: 900, // a much better result, submitted after the fact
        fees: 0,
        slippage: 0,
      }),
    ).rejects.toThrow(/already has a recorded outcome/i);
  });

  it("refuses an outcome that settles before its commitment", async () => {
    const decision = await recordDecision(prisma, {
      agentId,
      strategyVersionId: versionId,
      asset: "SOL",
      action: "BUY",
      price: 120,
      quantity: 1,
      confidence: 0.5,
    });

    await expect(
      recordOutcome(prisma, {
        decisionId: decision.id,
        entryPrice: 120,
        exitPrice: 130,
        settledAt: new Date(Date.now() - 86_400_000).toISOString(),
      }),
    ).rejects.toThrow(/before the decision was committed/i);
  });

  it("records a loss as a loss", async () => {
    const decision = await recordDecision(prisma, {
      agentId,
      strategyVersionId: versionId,
      asset: "SOL",
      action: "BUY",
      price: 200,
      quantity: 5,
      confidence: 0.7,
    });

    const outcome = await recordOutcome(prisma, {
      decisionId: decision.id,
      entryPrice: 200,
      exitPrice: 180,
      fees: 1,
      slippage: 0,
    });

    expect(outcome.status).toBe("LOSS");
    expect(Number(outcome.realizedPnl)).toBeLessThan(0);

    const stored = await prisma.decision.findUnique({ where: { id: decision.id } });
    expect(stored?.status).toBe("LOSS");
  });

  it("computes short PnL in the opposite direction", async () => {
    const decision = await recordDecision(prisma, {
      agentId,
      strategyVersionId: versionId,
      asset: "SOL",
      action: "SHORT",
      price: 200,
      quantity: 5,
      confidence: 0.7,
    });

    // Price falls, so a short profits.
    const outcome = await recordOutcome(prisma, {
      decisionId: decision.id,
      entryPrice: 200,
      exitPrice: 180,
      fees: 0,
      slippage: 0,
    });

    expect(Number(outcome.grossPnl)).toBeCloseTo(100, 6);
    expect(outcome.status).toBe("SUCCESS");
  });

  it("detects a tampered decision record", async () => {
    const decision = await recordDecision(prisma, {
      agentId,
      strategyVersionId: versionId,
      asset: "SOL",
      action: "BUY",
      price: 50,
      quantity: 1,
      confidence: 0.5,
    });

    // Simulate an operator editing history directly in the database. The
    // commitment was computed over the original price, so recomputation fails.
    await prisma.$executeRawUnsafe(
      `UPDATE decisions SET price = 999 WHERE id = $1`,
      decision.id,
    );

    const result = await verifyDecision(prisma, decision.id);
    const commitmentCheck = result.checks.find((c) => c.id === "COMMITMENT_MATCHES");

    expect(commitmentCheck?.state).toBe("FAIL");
    expect(result.valid).toBe(false);
  });

  // ------------------------------------------------------------ scheduling --

  it("does not seal a fresh commitment that is far below the threshold", async () => {
    await drainPendingBatches(prisma, { maxBatches: 10 });

    await recordDecision(prisma, {
      agentId,
      strategyVersionId: versionId,
      asset: "SOL",
      action: "BUY",
      price: 150,
      quantity: 1,
      confidence: 0.6,
    });

    const decision = await evaluateSealPolicy(prisma, {
      minBatchSize: 1_000,
      maxAgeMs: 60 * 60_000,
      maxBatchSize: 256,
    });

    expect(decision.pending).toBeGreaterThan(0);
    expect(decision.shouldSeal).toBe(false);
  });

  it("seals a stale commitment the count threshold would have left waiting", async () => {
    const decision = await evaluateSealPolicy(prisma, {
      minBatchSize: 1_000,
      maxAgeMs: 0, // everything pending is already past the age limit
      maxBatchSize: 256,
    });

    expect(decision.shouldSeal).toBe(true);

    const drained = await drainPendingBatches(prisma, { maxBatches: 10 });
    expect(drained.batches.length).toBeGreaterThan(0);
    expect(drained.remaining).toBe(0);
  });

  it("leaves nothing behind when two sealers run against the same backlog", async () => {
    for (let i = 0; i < 4; i += 1) {
      await recordDecision(prisma, {
        agentId,
        strategyVersionId: versionId,
        asset: "SOL",
        action: "SELL",
        price: 160 + i,
        quantity: 1,
        confidence: 0.55,
      });
    }

    // The concurrency guarantee: `FOR UPDATE SKIP LOCKED` hands the two callers
    // disjoint sets, so neither can batch a commitment the other already took.
    const [first, second] = await Promise.all([
      sealPendingBatch(prisma),
      sealPendingBatch(prisma),
    ]);

    const sealed = [first, second].filter((result) => result !== null);
    expect(sealed.length).toBeGreaterThan(0);

    const leaves = sealed.reduce((sum, result) => sum + result!.leafCount, 0);
    expect(leaves).toBeGreaterThanOrEqual(4);

    // Every decision has exactly one proof — the unique constraint would have
    // caught a duplicate, but the real assertion is that none was dropped.
    expect(await prisma.decision.count({ where: { agentId, proof: null } })).toBe(0);
  });

  // ----------------------------------------------------------- corrections --

  it("records a correction without altering the decision it corrects", async () => {
    const original = await recordDecision(prisma, {
      agentId,
      strategyVersionId: versionId,
      asset: "SOL",
      action: "BUY",
      price: 200,
      quantity: 2,
      confidence: 0.7,
    });

    const before = await prisma.decision.findUnique({ where: { id: original.id } });

    const correction = await recordCorrection(prisma, {
      decisionId: original.id,
      reason: "Quantity was misreported by the execution adapter.",
      detail: { field: "quantity", reported: 2, actual: 1.8 },
    });

    const after = await prisma.decision.findUnique({ where: { id: original.id } });

    // The point of the whole design: the sealed record is untouched.
    expect(after?.commitmentHash).toBe(before?.commitmentHash);
    expect(after?.quantity.toString()).toBe(before?.quantity.toString());
    expect(after?.committedAt.getTime()).toBe(before?.committedAt.getTime());

    expect(correction.decisionId).toBe(original.id);
    expect(correction.delayMs).toBeGreaterThanOrEqual(0);

    const listed = await listCorrections(prisma, original.id);
    expect(listed).toHaveLength(1);
    expect(listed[0].reason).toMatch(/misreported/);
  });

  it("refuses a correction against a decision that does not exist", async () => {
    await expect(
      recordCorrection(prisma, {
        decisionId: "decision_does_not_exist",
        reason: "Pointing at nothing in particular.",
      }),
    ).rejects.toThrow(/not match/i);
  });

  it("caps corrections so a record cannot be buried under amendments", async () => {
    const target = await recordDecision(prisma, {
      agentId,
      strategyVersionId: versionId,
      asset: "SOL",
      action: "BUY",
      price: 210,
      quantity: 1,
      confidence: 0.6,
    });

    for (let i = 0; i < MAX_CORRECTIONS_PER_DECISION; i += 1) {
      await recordCorrection(prisma, {
        decisionId: target.id,
        reason: `Amendment number ${i + 1} to this record.`,
      });
    }

    await expect(
      recordCorrection(prisma, {
        decisionId: target.id,
        reason: "One amendment too many for this record.",
      }),
    ).rejects.toThrow(/at most/i);
  });

  // ------------------------------------------------------------ reputation --

  it("writes a reputation snapshot and does not repeat it unchanged", async () => {
    const first = await snapshotAgent(prisma, agentId);
    expect(first?.written).toBe(true);

    const history = await getScoreHistory(prisma, agentId);
    expect(history).toHaveLength(1);
    expect(history[0].score).toBeCloseTo(first!.score, 2);

    // Nothing about the agent moved between these two calls, so the second must
    // not add a row — the history records transitions, not heartbeats.
    const second = await snapshotAgent(prisma, agentId);
    expect(second?.written).toBe(false);
    expect(await getScoreHistory(prisma, agentId)).toHaveLength(1);
  });

  it("records a new snapshot once the record actually moves", async () => {
    const before = await getScoreHistory(prisma, agentId);

    const decision = await recordDecision(prisma, {
      agentId,
      strategyVersionId: versionId,
      asset: "SOL",
      action: "BUY",
      price: 100,
      quantity: 5,
      confidence: 0.9,
    });
    await sealPendingBatch(prisma);
    await recordOutcome(prisma, {
      decisionId: decision.id,
      entryPrice: 100,
      exitPrice: 140,
    });

    const result = await snapshotAgent(prisma, agentId);
    expect(result?.written).toBe(true);

    const after = await getScoreHistory(prisma, agentId);
    expect(after.length).toBe(before.length + 1);
    // Oldest first, so the history is chart-ready without re-sorting.
    expect(after[after.length - 1].computedAt.getTime()).toBeGreaterThanOrEqual(
      after[0].computedAt.getTime(),
    );
  });

  it("rejects a decision against another agent\'s strategy version", async () => {
    const other = await prisma.agent.create({
      data: {
        slug: `OTHER-${suffix}`,
        name: "Other Agent",
        description: "Second agent for the cross-ownership check.",
        ownerId: userId,
        walletAddress: `Other${suffix}000000000000000000000000000`,
        venues: ["drift"],
        assets: ["SOL"],
      },
    });

    await expect(
      recordDecision(prisma, {
        agentId: other.id,
        strategyVersionId: versionId, // belongs to the first agent
        asset: "SOL",
        action: "BUY",
        price: 100,
        quantity: 1,
        confidence: 0.5,
      }),
    ).rejects.toThrow(/different agent/i);
  });
});
