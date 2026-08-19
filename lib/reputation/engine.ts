/**
 * ReputationEngine.
 *
 * The MERIT score is deliberately *not* ROI. It is a weighted blend of five
 * components, then damped by a confidence factor derived from sample size and
 * operating history. An agent with three profitable trades cannot outrank an
 * agent with two thousand verified ones, because the confidence factor pulls a
 * thin record toward the neutral baseline rather than toward its raw score.
 *
 * Token holdings are not an input. There is no code path by which they could be.
 */

import type { PerformanceMetrics } from "./metrics";

export const WEIGHTS = {
  /** Raw return. */
  performance: 0.25,
  /** Risk-adjusted return (Sharpe/Sortino). */
  risk: 0.25,
  /** Maximum drawdown. */
  drawdown: 0.15,
  /** Consistency of results over time. */
  consistency: 0.15,
  /** Execution quality: slippage and fee drag against intent. */
  execution: 0.1,
  /** Proof integrity: coverage and validity of the cryptographic record. */
  integrity: 0.1,
} as const;

/** Below this many settled trades a record is treated as provisional. */
export const CONFIDENCE_FULL_SAMPLE = 200;
/** Below this many days of history a record is treated as provisional. */
export const CONFIDENCE_FULL_DAYS = 180;
/** Score a fully-unproven agent is pulled toward. */
export const NEUTRAL_BASELINE = 50;

export interface ExecutionInputs {
  /** Mean absolute slippage as a fraction of notional. */
  averageSlippage: number;
  /** Mean fees as a fraction of notional. */
  averageFeeRate: number;
  /** Decisions that were committed and then executed, over all actionable decisions. */
  fillRate: number;
}

export interface IntegrityInputs {
  /** Decisions carrying a valid inclusion proof, over all decisions. */
  proofCoverage: number;
  /** Settled decisions whose outcome commitment verified, over all settled. */
  outcomeVerificationRate: number;
  /** Merkle roots confirmed on-chain, over all roots. */
  anchorRate: number;
  /** Count of records that failed verification. Any failure is heavily penalised. */
  integrityFailures: number;
}

export interface ReputationInput {
  metrics: PerformanceMetrics;
  execution: ExecutionInputs;
  integrity: IntegrityInputs;
  /** Days between the agent's first and most recent verified decision. */
  operatingDays: number;
}

export interface ReputationComponents {
  performance: number;
  risk: number;
  drawdown: number;
  consistency: number;
  execution: number;
  integrity: number;
}

export interface ReputationResult {
  /** Final, confidence-adjusted score in [0, 100]. */
  score: number;
  /** Score before the confidence adjustment. */
  rawScore: number;
  /** Multiplier in [0, 1] applied between the baseline and the raw score. */
  confidence: number;
  components: ReputationComponents;
  sampleSize: number;
  operatingDays: number;
}

const clamp = (value: number, min = 0, max = 100): number =>
  Math.min(max, Math.max(min, value));

/** Map an unbounded value onto 0-100 with a soft, monotonic curve. */
function logistic(value: number, midpoint: number, steepness: number): number {
  return 100 / (1 + Math.exp(-steepness * (value - midpoint)));
}

/** Return component: aggregate ROI, saturating so outliers cannot dominate. */
export function scorePerformance(metrics: PerformanceMetrics): number {
  if (metrics.tradeCount === 0) return NEUTRAL_BASELINE;
  // 0% ROI scores 50; +50% approaches the top; -50% approaches the floor.
  return clamp(logistic(metrics.roi, 0, 6));
}

/** Risk component: Sharpe first, Sortino as corroboration. */
export function scoreRisk(metrics: PerformanceMetrics): number {
  const { sharpeRatio, sortinoRatio } = metrics;
  if (sharpeRatio === null && sortinoRatio === null) return NEUTRAL_BASELINE;

  // A Sharpe of 1.0 is respectable, 2.0 is strong, 3.0+ is exceptional.
  const sharpeScore = sharpeRatio === null ? null : clamp(logistic(sharpeRatio, 1, 1.1));
  const sortinoScore = sortinoRatio === null ? null : clamp(logistic(sortinoRatio, 1.4, 0.9));

  const parts = [sharpeScore, sortinoScore].filter((v): v is number => v !== null);
  return parts.reduce((sum, v) => sum + v, 0) / parts.length;
}

/** Drawdown component: shallower is better, scored on the decline itself. */
export function scoreDrawdown(metrics: PerformanceMetrics): number {
  if (metrics.tradeCount === 0) return NEUTRAL_BASELINE;
  // 0% drawdown scores 100, 20% scores ~50, 40%+ approaches 0.
  return clamp(100 * Math.exp(-3.5 * metrics.maxDrawdown));
}

/**
 * Consistency component: rewards a steady win rate and low return dispersion,
 * and requires the agent to actually have been active across its lifetime.
 */
export function scoreConsistency(metrics: PerformanceMetrics): number {
  if (metrics.tradeCount < 2) return NEUTRAL_BASELINE;

  const winRateScore = clamp(metrics.winRate * 100);
  // Lower dispersion of per-trade ROI is steadier.
  const dispersionScore = clamp(100 * Math.exp(-8 * metrics.volatility));
  const cadenceScore = clamp(metrics.activeDayRatio * 100);
  const profitFactorScore =
    metrics.profitFactor === null
      ? clamp(winRateScore)
      : clamp(logistic(metrics.profitFactor, 1.3, 2.2));

  return (
    winRateScore * 0.3 +
    dispersionScore * 0.25 +
    profitFactorScore * 0.3 +
    cadenceScore * 0.15
  );
}

/** Execution component: how much of the intended edge survived to settlement. */
export function scoreExecution(execution: ExecutionInputs): number {
  const slippageScore = clamp(100 * Math.exp(-120 * Math.abs(execution.averageSlippage)));
  const feeScore = clamp(100 * Math.exp(-90 * Math.abs(execution.averageFeeRate)));
  const fillScore = clamp(execution.fillRate * 100);

  return slippageScore * 0.45 + feeScore * 0.2 + fillScore * 0.35;
}

/**
 * Integrity component: the only component that can be a hard zero.
 *
 * This measures the *cryptographic record*, not the trading. A perfect 100 says
 * every decision is provable and anchored — it says nothing about profitability.
 */
export function scoreIntegrity(integrity: IntegrityInputs): number {
  const base =
    clamp(integrity.proofCoverage * 100) * 0.4 +
    clamp(integrity.outcomeVerificationRate * 100) * 0.35 +
    clamp(integrity.anchorRate * 100) * 0.25;

  if (integrity.integrityFailures <= 0) return clamp(base);

  // Any verification failure is disqualifying in proportion to how many.
  const penalty = Math.min(1, integrity.integrityFailures * 0.25);
  return clamp(base * (1 - penalty));
}

/**
 * Confidence factor in [0, 1].
 *
 * Combines sample size and operating history; both must be satisfied. A short
 * but dense record, or a long but sparse one, stays provisional.
 */
export function confidenceFactor(sampleSize: number, operatingDays: number): number {
  if (sampleSize <= 0) return 0;

  const sampleTerm = Math.min(1, Math.sqrt(sampleSize / CONFIDENCE_FULL_SAMPLE));
  const timeTerm = Math.min(1, Math.sqrt(Math.max(0, operatingDays) / CONFIDENCE_FULL_DAYS));

  return Math.min(sampleTerm, timeTerm);
}

/** Compute the full reputation result. */
export function computeReputation(input: ReputationInput): ReputationResult {
  const components: ReputationComponents = {
    performance: scorePerformance(input.metrics),
    risk: scoreRisk(input.metrics),
    drawdown: scoreDrawdown(input.metrics),
    consistency: scoreConsistency(input.metrics),
    execution: scoreExecution(input.execution),
    integrity: scoreIntegrity(input.integrity),
  };

  const rawScore =
    components.performance * WEIGHTS.performance +
    components.risk * WEIGHTS.risk +
    components.drawdown * WEIGHTS.drawdown +
    components.consistency * WEIGHTS.consistency +
    components.execution * WEIGHTS.execution +
    components.integrity * WEIGHTS.integrity;

  const confidence = confidenceFactor(input.metrics.tradeCount, input.operatingDays);

  // Interpolate from the neutral baseline toward the earned score.
  const score = NEUTRAL_BASELINE + (rawScore - NEUTRAL_BASELINE) * confidence;

  return {
    score: Number(clamp(score).toFixed(1)),
    rawScore: Number(clamp(rawScore).toFixed(1)),
    confidence: Number(confidence.toFixed(4)),
    components: {
      performance: Number(components.performance.toFixed(1)),
      risk: Number(components.risk.toFixed(1)),
      drawdown: Number(components.drawdown.toFixed(1)),
      consistency: Number(components.consistency.toFixed(1)),
      execution: Number(components.execution.toFixed(1)),
      integrity: Number(components.integrity.toFixed(1)),
    },
    sampleSize: input.metrics.tradeCount,
    operatingDays: input.operatingDays,
  };
}

export const ReputationEngine = {
  WEIGHTS,
  computeReputation,
  confidenceFactor,
  scorePerformance,
  scoreRisk,
  scoreDrawdown,
  scoreConsistency,
  scoreExecution,
  scoreIntegrity,
} as const;
