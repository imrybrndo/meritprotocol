/**
 * Qualification tiers.
 *
 * Tiers gate discovery, not capital. Every requirement below is a function of
 * verified protocol activity: decisions committed, time elapsed, proof coverage,
 * and measured performance. There is no token balance in this module, and none
 * may be added — see the invariant test in tests/reputation.test.ts.
 */

import type { PerformanceMetrics } from "../reputation/metrics";
import type { ReputationResult } from "../reputation/engine";

export const TIERS = [
  "UNVERIFIED",
  "VERIFIED",
  "BRONZE",
  "SILVER",
  "GOLD",
  "ELITE",
] as const;

export type Tier = (typeof TIERS)[number];

export interface TierRequirement {
  tier: Tier;
  label: string;
  description: string;
  minVerifiedDecisions: number;
  minOperatingDays: number;
  minMeritScore: number;
  maxDrawdown: number;
  minProofCoverage: number;
  minWinRate: number;
}

export const TIER_REQUIREMENTS: TierRequirement[] = [
  {
    tier: "UNVERIFIED",
    label: "Unverified",
    description: "Registered, but without a verified decision record yet.",
    minVerifiedDecisions: 0,
    minOperatingDays: 0,
    minMeritScore: 0,
    maxDrawdown: 1,
    minProofCoverage: 0,
    minWinRate: 0,
  },
  {
    tier: "VERIFIED",
    label: "Verified",
    description: "Has anchored decisions with valid inclusion proofs.",
    minVerifiedDecisions: 10,
    minOperatingDays: 7,
    minMeritScore: 0,
    maxDrawdown: 1,
    minProofCoverage: 0.9,
    minWinRate: 0,
  },
  {
    tier: "BRONZE",
    label: "Bronze",
    description: "A short but complete and fully provable track record.",
    minVerifiedDecisions: 50,
    minOperatingDays: 30,
    minMeritScore: 55,
    maxDrawdown: 0.4,
    minProofCoverage: 0.95,
    minWinRate: 0.4,
  },
  {
    tier: "SILVER",
    label: "Silver",
    description: "A sustained record with controlled drawdown.",
    minVerifiedDecisions: 200,
    minOperatingDays: 90,
    minMeritScore: 65,
    maxDrawdown: 0.3,
    minProofCoverage: 0.97,
    minWinRate: 0.45,
  },
  {
    tier: "GOLD",
    label: "Gold",
    description: "A long, consistent record with strong risk-adjusted returns.",
    minVerifiedDecisions: 500,
    minOperatingDays: 180,
    minMeritScore: 75,
    maxDrawdown: 0.22,
    minProofCoverage: 0.99,
    minWinRate: 0.5,
  },
  {
    tier: "ELITE",
    label: "Elite",
    description: "Deep history, complete proof coverage, top-decile performance.",
    minVerifiedDecisions: 1_000,
    minOperatingDays: 365,
    minMeritScore: 85,
    maxDrawdown: 0.15,
    minProofCoverage: 1,
    minWinRate: 0.55,
  },
];

export interface QualificationInput {
  verifiedDecisions: number;
  operatingDays: number;
  proofCoverage: number;
  reputation: ReputationResult;
  metrics: PerformanceMetrics;
}

export interface UnmetRequirement {
  requirement: string;
  actual: string;
  required: string;
}

export interface QualificationResult {
  tier: Tier;
  label: string;
  /** The next tier up, or null at ELITE. */
  nextTier: Tier | null;
  /** What is still missing for the next tier. Empty at ELITE. */
  unmet: UnmetRequirement[];
}

function meets(input: QualificationInput, requirement: TierRequirement): UnmetRequirement[] {
  const unmet: UnmetRequirement[] = [];
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

  if (input.verifiedDecisions < requirement.minVerifiedDecisions) {
    unmet.push({
      requirement: "Verified decisions",
      actual: String(input.verifiedDecisions),
      required: `≥ ${requirement.minVerifiedDecisions}`,
    });
  }
  if (input.operatingDays < requirement.minOperatingDays) {
    unmet.push({
      requirement: "Operating history",
      actual: `${input.operatingDays} days`,
      required: `≥ ${requirement.minOperatingDays} days`,
    });
  }
  if (input.reputation.score < requirement.minMeritScore) {
    unmet.push({
      requirement: "MERIT score",
      actual: input.reputation.score.toFixed(1),
      required: `≥ ${requirement.minMeritScore}`,
    });
  }
  if (input.metrics.maxDrawdown > requirement.maxDrawdown) {
    unmet.push({
      requirement: "Max drawdown",
      actual: pct(input.metrics.maxDrawdown),
      required: `≤ ${pct(requirement.maxDrawdown)}`,
    });
  }
  if (input.proofCoverage < requirement.minProofCoverage) {
    unmet.push({
      requirement: "Proof coverage",
      actual: pct(input.proofCoverage),
      required: `≥ ${pct(requirement.minProofCoverage)}`,
    });
  }
  if (input.metrics.winRate < requirement.minWinRate) {
    unmet.push({
      requirement: "Win rate",
      actual: pct(input.metrics.winRate),
      required: `≥ ${pct(requirement.minWinRate)}`,
    });
  }

  return unmet;
}

/** Highest tier whose requirements are fully satisfied. */
export function qualify(input: QualificationInput): QualificationResult {
  let achieved = TIER_REQUIREMENTS[0];

  for (const requirement of TIER_REQUIREMENTS) {
    if (meets(input, requirement).length === 0) achieved = requirement;
    else break;
  }

  const index = TIER_REQUIREMENTS.findIndex((r) => r.tier === achieved.tier);
  const next = TIER_REQUIREMENTS[index + 1] ?? null;

  return {
    tier: achieved.tier,
    label: achieved.label,
    nextTier: next?.tier ?? null,
    unmet: next ? meets(input, next) : [],
  };
}

export function tierRank(tier: Tier): number {
  return TIERS.indexOf(tier);
}
