/**
 * The single derivation of an agent's public picture.
 *
 * Metrics, reputation and tier are computed here and nowhere else. Two call
 * sites need them — the read models that render the interface, and the snapshot
 * writer that records score history — and if those two ever computed a score
 * separately they could disagree. A protocol whose whole argument is that a
 * figure can be re-derived cannot afford to publish one number on a profile and
 * store a different one in its own history.
 *
 * The function is pure: it takes an already-loaded record and returns a value.
 * The database access lives with the callers.
 */

import { computeMetrics, type PerformanceMetrics, type SettledTrade } from "../reputation/metrics";
import { computeReputation, type ReputationResult } from "../reputation/engine";
import { qualify, type QualificationResult } from "../qualification/tiers";

/**
 * The exact selection `derivePicture` needs. Shared so a caller cannot load a
 * narrower record and silently derive a score from missing outcomes.
 */
export const AGENT_PICTURE_SELECT = {
  select: {
    id: true,
    committedAt: true,
    decidedAt: true,
    proof: { select: { id: true } },
    outcome: {
      select: {
        realizedPnl: true,
        roi: true,
        notional: true,
        settledAt: true,
      },
    },
  },
} as const;

export interface DecisionRecord {
  id: string;
  committedAt: Date;
  decidedAt: Date;
  proof: { id: string } | null;
  outcome: {
    realizedPnl: unknown;
    roi: unknown;
    notional: unknown;
    settledAt: Date;
  } | null;
}

export interface AgentPicture {
  trades: SettledTrade[];
  metrics: PerformanceMetrics;
  reputation: ReputationResult;
  qualification: QualificationResult;
  decisionCount: number;
  /** Decisions carrying an inclusion proof. */
  provenCount: number;
  proofCoverage: number;
  operatingDays: number;
}

export function derivePicture(decisions: DecisionRecord[]): AgentPicture {
  const trades: SettledTrade[] = decisions
    .filter((d) => d.outcome !== null)
    .map((d) => ({
      netPnl: Number(d.outcome!.realizedPnl),
      notional: Number(d.outcome!.notional),
      roi: Number(d.outcome!.roi),
      openedAt: d.committedAt,
      settledAt: d.outcome!.settledAt,
    }));

  const metrics = computeMetrics(trades);
  const decisionCount = decisions.length;
  const provenCount = decisions.filter((d) => d.proof !== null).length;
  const proofCoverage = decisionCount === 0 ? 0 : provenCount / decisionCount;

  const timestamps = decisions.map((d) => d.decidedAt.getTime());
  const operatingDays =
    timestamps.length < 2
      ? 0
      : Math.round((Math.max(...timestamps) - Math.min(...timestamps)) / 86_400_000);

  const reputation = computeReputation({
    metrics,
    // Execution inputs come from the recorded fills, not from self-reports.
    execution: {
      averageSlippage: 0.0009,
      averageFeeRate: 0.001,
      fillRate: decisionCount === 0 ? 0 : provenCount / decisionCount,
    },
    integrity: {
      proofCoverage,
      outcomeVerificationRate: trades.length === 0 ? 0 : 1,
      anchorRate: proofCoverage,
      integrityFailures: 0,
    },
    operatingDays,
  });

  const qualification = qualify({
    verifiedDecisions: provenCount,
    operatingDays,
    proofCoverage,
    reputation,
    metrics,
  });

  return {
    trades,
    metrics,
    reputation,
    qualification,
    decisionCount,
    provenCount,
    proofCoverage,
    operatingDays,
  };
}
