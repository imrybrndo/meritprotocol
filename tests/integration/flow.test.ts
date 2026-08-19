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
import { sealPendingBatch } from "@/lib/services/batching";
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

  it("rejects a decision against another agent's strategy version", async () => {
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
