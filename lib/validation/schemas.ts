/**
 * Request validation. Every API write goes through one of these schemas before
 * it reaches a service, so invalid input never becomes an immutable record.
 */

import { z } from "zod";

const decimalString = z
  .union([z.number(), z.string()])
  .refine(
    (value) =>
      typeof value === "number"
        ? Number.isFinite(value)
        : /^-?\d+(\.\d+)?$/.test(value.trim()),
    { message: "Must be a finite decimal number" },
  );

const positiveDecimal = decimalString.refine(
  (value) => Number(value) > 0,
  { message: "Must be greater than zero" },
);

const nonNegativeDecimal = decimalString.refine(
  (value) => Number(value) >= 0,
  { message: "Must be zero or greater" },
);

export const DECISION_ACTIONS = [
  "BUY",
  "SELL",
  "SHORT",
  "COVER",
  "HOLD",
  "ABSTAIN",
] as const;

/** Actions that can produce a settled outcome. HOLD and ABSTAIN cannot. */
export const ACTIONABLE = ["BUY", "SELL", "SHORT", "COVER"] as const;

/* ------------------------------------------------------------ wallet auth -- */

/** A 20-byte EVM address, any casing — the route checksums it. */
const evmAddress = z.string().trim().regex(/^0x[0-9a-fA-F]{40}$/, "Must be a 0x EVM address");

export const walletChallengeSchema = z.object({
  address: evmAddress,
});

export const walletSignInSchema = z.object({
  address: evmAddress,
  nonce: z.string().trim().min(16).max(64),
  /** EIP-191 signature over the challenge text: 65 bytes as 0x hex. */
  signature: z.string().trim().regex(/^0x[0-9a-fA-F]{130}$/, "Must be a 0x signature"),
});

export const createAgentSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[A-Z0-9][A-Z0-9-]*$/, "Use uppercase letters, digits and hyphens"),
  description: z.string().min(10).max(1_000),
  walletAddress: z.string().min(32).max(64),
  venues: z.array(z.string().min(1)).min(1).max(20),
  assets: z.array(z.string().min(1)).min(1).max(50),
  chain: z.string().min(2).max(32).default("robinhood"),
  riskProfile: z.enum(["CONSERVATIVE", "MODERATE", "AGGRESSIVE"]).default("MODERATE"),
});

export const createStrategySchema = z.object({
  agentId: z.string().min(1),
  name: z.string().min(2).max(80),
  description: z.string().min(10).max(1_000),
});

export const createStrategyVersionSchema = z.object({
  strategyId: z.string().min(1),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "Use semantic versioning, e.g. 2.1.0"),
  description: z.string().min(5).max(1_000),
  model: z.string().min(2).max(120),
  modelVersion: z.string().min(1).max(40),
  config: z.record(z.string(), z.unknown()).default({}),
  creatorSignature: z.string().max(200).optional(),
});

export const createDecisionSchema = z
  .object({
    agentId: z.string().min(1),
    strategyVersionId: z.string().min(1),
    asset: z.string().min(1).max(20),
    action: z.enum(DECISION_ACTIONS),
    price: nonNegativeDecimal,
    quantity: nonNegativeDecimal,
    confidence: decimalString.refine(
      (value) => Number(value) >= 0 && Number(value) <= 1,
      { message: "Confidence must be between 0 and 1" },
    ),
    decidedAt: z.iso.datetime().optional(),
    expiresAt: z.iso.datetime().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    /** Caller-supplied idempotency key; replays return the original decision. */
    idempotencyKey: z.string().min(8).max(200).optional(),
  })
  .refine(
    (value) =>
      !ACTIONABLE.includes(value.action as (typeof ACTIONABLE)[number]) ||
      Number(value.quantity) > 0,
    { message: "Actionable decisions require a quantity above zero", path: ["quantity"] },
  );

export const createOutcomeSchema = z.object({
  decisionId: z.string().min(1),
  entryPrice: positiveDecimal,
  exitPrice: nonNegativeDecimal,
  quantity: positiveDecimal.optional(),
  fees: nonNegativeDecimal.default(0),
  slippage: nonNegativeDecimal.default(0),
  settledAt: z.iso.datetime().optional(),
});

export const createCorrectionSchema = z.object({
  decisionId: z.string().min(1),
  /// Free text, but bounded: a correction is an annotation, not a second record.
  reason: z.string().min(8).max(500),
  detail: z.record(z.string(), z.unknown()).optional(),
});

export const verifySchema = z.object({
  query: z.string().min(3).max(200),
  type: z.enum(["auto", "decision", "commitment", "agent", "transaction"]).default("auto"),
});

export const listAgentsSchema = z.object({
  search: z.string().max(80).optional(),
  tier: z.string().max(20).optional(),
  strategy: z.string().max(80).optional(),
  asset: z.string().max(20).optional(),
  chain: z.string().max(32).optional(),
  risk: z.enum(["CONSERVATIVE", "MODERATE", "AGGRESSIVE"]).optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  minRoi: z.coerce.number().optional(),
  maxDrawdown: z.coerce.number().min(0).max(1).optional(),
  minWinRate: z.coerce.number().min(0).max(1).optional(),
  minTrades: z.coerce.number().int().min(0).optional(),
  sort: z
    .enum(["score", "roi", "sharpe", "drawdown", "consistency", "trades"])
    .default("score"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type CreateStrategyInput = z.infer<typeof createStrategySchema>;
export type CreateStrategyVersionInput = z.infer<typeof createStrategyVersionSchema>;
export type CreateDecisionInput = z.infer<typeof createDecisionSchema>;
/**
 * Output type: defaults applied. What a service receives after parsing.
 */
export type CreateOutcomeInput = z.infer<typeof createOutcomeSchema>;
/**
 * Input type: defaults still optional. What a caller may legitimately supply,
 * so internal callers do not have to restate zero fees and zero slippage.
 */
export type CreateOutcomeArgs = z.input<typeof createOutcomeSchema>;
export type CreateCorrectionInput = z.infer<typeof createCorrectionSchema>;
export type ListAgentsInput = z.infer<typeof listAgentsSchema>;
