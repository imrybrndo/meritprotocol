/**
 * Decision and outcome recording.
 *
 * The ordering guarantee lives here: a commitment is computed and stored before
 * any outcome can be attached, and the outcome is bound to that commitment. An
 * outcome written for a decision that has one already is rejected, not merged —
 * there is no path that rewrites a settled result.
 */

import { randomBytes } from "node:crypto";
import { Prisma } from "../generated/prisma/client";
import type { PrismaClient } from "../generated/prisma/client";
import { commitDecision, commitOutcome, type Hash } from "../crypto/hash";
import { emitEvent } from "../events";
import { ACTIONABLE, type CreateDecisionInput, type CreateOutcomeArgs } from "../validation/schemas";

export class ProtocolError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}

/** 128 bits of salt per decision. */
function createNonce(): string {
  return randomBytes(16).toString("hex");
}

const toDecimal = (value: number | string) => new Prisma.Decimal(value);

export interface RecordedDecision {
  id: string;
  commitmentHash: Hash;
  committedAt: Date;
  decidedAt: Date;
  status: string;
  replayed: boolean;
}

/**
 * Commit a decision.
 *
 * `idempotencyKey` protects against a retried request creating a second record
 * for the same call. Without one, a duplicate is still caught by the unique
 * constraint on `commitmentHash`, since identical inputs and nonce would
 * collide — but the nonce makes that unlikely, so callers should send a key.
 */
export async function recordDecision(
  prisma: PrismaClient,
  input: CreateDecisionInput,
  options: { isDemo?: boolean } = {},
): Promise<RecordedDecision> {
  const agent = await prisma.agent.findUnique({
    where: { id: input.agentId },
    select: { id: true, status: true },
  });
  if (!agent) throw new ProtocolError("Agent not found", "AGENT_NOT_FOUND", 404);
  if (agent.status !== "ACTIVE") {
    throw new ProtocolError("Agent is not active", "AGENT_INACTIVE", 409);
  }

  const version = await prisma.strategyVersion.findUnique({
    where: { id: input.strategyVersionId },
    select: {
      id: true,
      version: true,
      status: true,
      strategy: { select: { agentId: true } },
    },
  });
  if (!version) {
    throw new ProtocolError("Strategy version not found", "VERSION_NOT_FOUND", 404);
  }
  if (version.strategy.agentId !== agent.id) {
    throw new ProtocolError(
      "Strategy version belongs to a different agent",
      "VERSION_AGENT_MISMATCH",
      409,
    );
  }
  if (version.status === "RETIRED") {
    throw new ProtocolError("Strategy version is retired", "VERSION_RETIRED", 409);
  }

  if (input.idempotencyKey) {
    const existing = await prisma.decision.findFirst({
      where: {
        agentId: agent.id,
        metadata: { path: ["idempotencyKey"], equals: input.idempotencyKey },
      },
      select: {
        id: true,
        commitmentHash: true,
        committedAt: true,
        decidedAt: true,
        status: true,
      },
    });

    if (existing) {
      return {
        id: existing.id,
        commitmentHash: existing.commitmentHash as Hash,
        committedAt: existing.committedAt,
        decidedAt: existing.decidedAt,
        status: existing.status,
        replayed: true,
      };
    }
  }

  const decidedAt = input.decidedAt ? new Date(input.decidedAt) : new Date();
  const nonce = createNonce();

  const metadata = {
    ...(input.metadata ?? {}),
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
  };

  // The commitment is computed here, before any outcome exists to influence it.
  const commitmentHash = commitDecision({
    agentId: agent.id,
    strategyVersionId: version.id,
    strategyVersion: version.version,
    asset: input.asset,
    action: input.action,
    price: input.price,
    quantity: input.quantity,
    confidence: input.confidence,
    decidedAt,
    nonce,
    metadata: input.metadata as Record<string, never> | undefined,
  });

  // Non-actionable calls are terminal the moment they are recorded: an
  // abstention has no outcome to reveal, but it still counts in the history.
  const status = ACTIONABLE.includes(input.action as (typeof ACTIONABLE)[number])
    ? "OPEN"
    : input.action === "ABSTAIN"
      ? "TRADE_ABSTENTION"
      : "NO_GO";

  try {
    return await prisma.$transaction(async (tx) => {
      const decision = await tx.decision.create({
        data: {
          agentId: agent.id,
          strategyVersionId: version.id,
          asset: input.asset.toUpperCase(),
          action: input.action,
          price: toDecimal(input.price),
          quantity: toDecimal(input.quantity),
          confidence: toDecimal(input.confidence),
          nonce,
          commitmentHash,
          metadata: Object.keys(metadata).length > 0 ? (metadata as Prisma.InputJsonValue) : undefined,
          status,
          isDemo: options.isDemo ?? false,
          decidedAt,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        },
      });

      await emitEvent(tx, {
        type: "DECISION_COMMITTED",
        agentId: agent.id,
        subjectId: decision.id,
        payload: {
          commitmentHash,
          asset: decision.asset,
          action: decision.action,
          strategyVersion: version.version,
        },
      });

      return {
        id: decision.id,
        commitmentHash: commitmentHash,
        committedAt: decision.committedAt,
        decidedAt: decision.decidedAt,
        status: decision.status,
        replayed: false,
      };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ProtocolError(
        "A decision with this commitment already exists",
        "DUPLICATE_COMMITMENT",
        409,
      );
    }
    throw error;
  }
}

export interface RecordedOutcome {
  id: string;
  decisionId: string;
  outcomeHash: Hash;
  grossPnl: string;
  realizedPnl: string;
  roi: string;
  notional: string;
  holdingPeriodMs: number;
  status: string;
}

/**
 * Reveal the outcome of a committed decision.
 *
 * Derived figures are computed server-side from entry/exit/quantity/fees. The
 * caller does not get to assert its own PnL.
 */
export async function recordOutcome(
  prisma: PrismaClient,
  input: CreateOutcomeArgs,
): Promise<RecordedOutcome> {
  const decision = await prisma.decision.findUnique({
    where: { id: input.decisionId },
    select: {
      id: true,
      agentId: true,
      action: true,
      quantity: true,
      status: true,
      commitmentHash: true,
      committedAt: true,
      outcome: { select: { id: true } },
    },
  });

  if (!decision) throw new ProtocolError("Decision not found", "DECISION_NOT_FOUND", 404);

  if (decision.outcome) {
    throw new ProtocolError(
      "This decision already has a recorded outcome. Record a correction instead.",
      "OUTCOME_EXISTS",
      409,
    );
  }

  if (!ACTIONABLE.includes(decision.action as (typeof ACTIONABLE)[number])) {
    throw new ProtocolError(
      `A ${decision.action} decision has no outcome to reveal`,
      "NOT_ACTIONABLE",
      409,
    );
  }

  if (decision.status !== "OPEN") {
    throw new ProtocolError(
      `Decision is ${decision.status} and cannot be settled`,
      "DECISION_NOT_OPEN",
      409,
    );
  }

  const settledAt = input.settledAt ? new Date(input.settledAt) : new Date();

  // Chronology is a protocol invariant, not a formality.
  if (settledAt.getTime() < decision.committedAt.getTime()) {
    throw new ProtocolError(
      "Outcome cannot settle before the decision was committed",
      "SETTLED_BEFORE_COMMIT",
      409,
    );
  }

  const quantity = new Prisma.Decimal(input.quantity ?? decision.quantity);
  const entryPrice = new Prisma.Decimal(input.entryPrice);
  const exitPrice = new Prisma.Decimal(input.exitPrice);
  const fees = new Prisma.Decimal(input.fees ?? 0);
  const slippage = new Prisma.Decimal(input.slippage ?? 0);

  // Short and cover profit when price falls, so direction flips the sign.
  const direction = decision.action === "SHORT" || decision.action === "SELL" ? -1 : 1;
  const grossPnl = exitPrice.minus(entryPrice).times(quantity).times(direction);
  const realizedPnl = grossPnl.minus(fees).minus(slippage.times(quantity));
  const notional = entryPrice.times(quantity);
  const roi = notional.isZero() ? new Prisma.Decimal(0) : realizedPnl.dividedBy(notional);

  const holdingPeriodMs = Math.max(
    0,
    settledAt.getTime() - decision.committedAt.getTime(),
  );

  const outcomeHash = commitOutcome({
    decisionId: decision.id,
    commitmentHash: decision.commitmentHash,
    entryPrice: entryPrice.toFixed(12),
    exitPrice: exitPrice.toFixed(12),
    quantity: quantity.toFixed(12),
    fees: fees.toFixed(12),
    slippage: slippage.toFixed(12),
    realizedPnl: realizedPnl.toFixed(12),
    settledAt,
  });

  const status = realizedPnl.greaterThanOrEqualTo(0) ? "SUCCESS" : "LOSS";

  return await prisma.$transaction(async (tx) => {
    const outcome = await tx.outcome.create({
      data: {
        decisionId: decision.id,
        entryPrice,
        exitPrice,
        quantity,
        fees,
        slippage,
        grossPnl,
        realizedPnl,
        roi,
        notional,
        holdingPeriodMs: BigInt(holdingPeriodMs),
        outcomeHash,
        settledAt,
      },
    });

    // The decision's committed fields are untouched; only its lifecycle status
    // moves, and a loss can only ever move it to LOSS.
    await tx.decision.update({
      where: { id: decision.id },
      data: { status },
    });

    await emitEvent(tx, {
      type: "OUTCOME_REVEALED",
      agentId: decision.agentId,
      subjectId: decision.id,
      payload: {
        outcomeHash,
        realizedPnl: realizedPnl.toFixed(6),
        roi: roi.toFixed(6),
        status,
      },
    });

    return {
      id: outcome.id,
      decisionId: decision.id,
      outcomeHash,
      grossPnl: grossPnl.toFixed(8),
      realizedPnl: realizedPnl.toFixed(8),
      roi: roi.toFixed(8),
      notional: notional.toFixed(8),
      holdingPeriodMs,
      status,
    };
  });
}
