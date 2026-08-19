import { describe, expect, it } from "vitest";
import {
  computeMetrics,
  maxDrawdown,
  sharpeRatio,
  standardDeviation,
  type SettledTrade,
} from "@/lib/reputation/metrics";
import {
  CONFIDENCE_FULL_SAMPLE,
  NEUTRAL_BASELINE,
  ReputationEngine,
  WEIGHTS,
  computeReputation,
  confidenceFactor,
  scoreIntegrity,
} from "@/lib/reputation/engine";
import { qualify, tierRank } from "@/lib/qualification/tiers";

const DAY = 86_400_000;

function trade(roi: number, dayOffset: number, notional = 1_000): SettledTrade {
  const openedAt = new Date(Date.UTC(2026, 0, 1) + dayOffset * DAY);
  return {
    roi,
    notional,
    netPnl: notional * roi,
    openedAt,
    settledAt: new Date(openedAt.getTime() + 6 * 3_600_000),
  };
}

/** A long, healthy record: positive drift, moderate dispersion. */
function healthyRecord(count: number): SettledTrade[] {
  return Array.from({ length: count }, (_, i) =>
    trade(0.012 + Math.sin(i / 5) * 0.02, i),
  );
}

const execution = { averageSlippage: 0.0008, averageFeeRate: 0.0011, fillRate: 0.98 };
const integrity = {
  proofCoverage: 1,
  outcomeVerificationRate: 1,
  anchorRate: 1,
  integrityFailures: 0,
};

describe("metrics", () => {
  it("returns an empty metric set for no trades", () => {
    expect(computeMetrics([]).tradeCount).toBe(0);
    expect(computeMetrics([]).profitFactor).toBeNull();
  });

  it("computes win rate and net pnl", () => {
    const m = computeMetrics([trade(0.1, 0), trade(-0.05, 1), trade(0.2, 2)]);
    expect(m.tradeCount).toBe(3);
    expect(m.winCount).toBe(2);
    expect(m.lossCount).toBe(1);
    expect(m.winRate).toBeCloseTo(2 / 3, 6);
    expect(m.netPnl).toBeCloseTo(100 - 50 + 200, 6);
  });

  it("computes profit factor as gross profit over gross loss", () => {
    const m = computeMetrics([trade(0.1, 0), trade(-0.05, 1)]);
    expect(m.profitFactor).toBeCloseTo(100 / 50, 6);
  });

  it("returns a null profit factor when nothing lost", () => {
    expect(computeMetrics([trade(0.1, 0), trade(0.2, 1)]).profitFactor).toBeNull();
  });

  it("measures peak-to-trough drawdown", () => {
    // +1000 to 11000, then -2200 to 8800 => 20% off the peak.
    const trades = [trade(1, 0, 1_000), trade(-0.2, 1, 11_000)];
    expect(maxDrawdown(trades, 10_000)).toBeCloseTo(0.2, 6);
  });

  it("reports zero drawdown for a monotonically rising curve", () => {
    expect(maxDrawdown([trade(0.05, 0), trade(0.05, 1)])).toBe(0);
  });

  it("returns a null Sharpe when returns do not vary", () => {
    expect(sharpeRatio([0.01, 0.01, 0.01], 252)).toBeNull();
    expect(standardDeviation([5])).toBe(0);
  });

  it("ranks a steadier series above a wilder one with the same mean", () => {
    const steady = computeMetrics([0.02, 0.02, 0.02, 0.021, 0.019].map((r, i) => trade(r, i)));
    const wild = computeMetrics([0.2, -0.16, 0.18, -0.14, 0.02].map((r, i) => trade(r, i)));
    expect(steady.volatility).toBeLessThan(wild.volatility);
  });
});

describe("ReputationEngine", () => {
  it("weights sum to one", () => {
    const total = Object.values(WEIGHTS).reduce((s, w) => s + w, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("scores an agent with no history at the neutral baseline", () => {
    const result = computeReputation({
      metrics: computeMetrics([]),
      execution,
      integrity,
      operatingDays: 0,
    });
    expect(result.confidence).toBe(0);
    expect(result.score).toBe(NEUTRAL_BASELINE);
  });

  it("keeps every score inside 0-100", () => {
    for (const record of [healthyRecord(300), [trade(-0.5, 0)], [trade(9, 0)]]) {
      const result = computeReputation({
        metrics: computeMetrics(record),
        execution,
        integrity,
        operatingDays: 400,
      });
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
  });

  // The headline requirement: sample size must dominate a lucky streak.
  it("ranks 2000 verified trades above 3 lucky ones", () => {
    const lucky = computeReputation({
      metrics: computeMetrics([trade(0.4, 0), trade(0.5, 1), trade(0.45, 2)]),
      execution,
      integrity,
      operatingDays: 3,
    });

    const proven = computeReputation({
      metrics: computeMetrics(healthyRecord(2_000)),
      execution,
      integrity,
      operatingDays: 700,
    });

    expect(lucky.rawScore).toBeGreaterThan(0);
    expect(proven.score).toBeGreaterThan(lucky.score);
  });

  it("pulls a thin record toward the baseline, not toward its raw score", () => {
    const thin = computeReputation({
      metrics: computeMetrics([trade(0.4, 0), trade(0.5, 1), trade(0.45, 2)]),
      execution,
      integrity,
      operatingDays: 3,
    });

    expect(thin.confidence).toBeLessThan(0.2);
    expect(Math.abs(thin.score - NEUTRAL_BASELINE)).toBeLessThan(
      Math.abs(thin.rawScore - NEUTRAL_BASELINE),
    );
  });

  it("grows confidence with both sample size and time, and caps at one", () => {
    expect(confidenceFactor(0, 999)).toBe(0);
    expect(confidenceFactor(10, 365)).toBeLessThan(confidenceFactor(100, 365));
    expect(confidenceFactor(CONFIDENCE_FULL_SAMPLE, 999)).toBeCloseTo(1, 6);
    // A dense but brand-new record stays provisional.
    expect(confidenceFactor(5_000, 2)).toBeLessThan(0.2);
  });

  it("penalises a deep drawdown even when returns are strong", () => {
    const smooth = healthyRecord(400);
    const crashed = [...smooth];
    crashed[200] = trade(-0.55, 200, 20_000);

    const a = computeReputation({
      metrics: computeMetrics(smooth),
      execution,
      integrity,
      operatingDays: 400,
    });
    const b = computeReputation({
      metrics: computeMetrics(crashed),
      execution,
      integrity,
      operatingDays: 400,
    });

    expect(b.components.drawdown).toBeLessThan(a.components.drawdown);
    expect(b.score).toBeLessThan(a.score);
  });

  it("collapses the integrity component on verification failures", () => {
    expect(scoreIntegrity({ ...integrity, integrityFailures: 4 })).toBe(0);
    expect(scoreIntegrity({ ...integrity, integrityFailures: 1 })).toBeLessThan(
      scoreIntegrity(integrity),
    );
  });

  it("scores integrity independently of profitability", () => {
    const losing = computeReputation({
      metrics: computeMetrics(Array.from({ length: 300 }, (_, i) => trade(-0.01, i))),
      execution,
      integrity,
      operatingDays: 400,
    });
    // A fully provable record of losses still has perfect integrity.
    expect(losing.components.integrity).toBe(100);
    expect(losing.components.performance).toBeLessThan(NEUTRAL_BASELINE);
  });

  it("exposes every component used in the blend", () => {
    const result = computeReputation({
      metrics: computeMetrics(healthyRecord(250)),
      execution,
      integrity,
      operatingDays: 300,
    });
    expect(Object.keys(result.components).sort()).toEqual(
      ["consistency", "drawdown", "execution", "integrity", "performance", "risk"].sort(),
    );
  });

  // Protocol invariant from the spec: reputation must never be purchasable.
  it("has no token-balance input anywhere in the engine", () => {
    const source = ReputationEngine.computeReputation.toString();
    for (const forbidden of ["token", "balance", "stake", "holding"]) {
      expect(source.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe("qualification", () => {
  const base = {
    metrics: computeMetrics(healthyRecord(2_000)),
    reputation: computeReputation({
      metrics: computeMetrics(healthyRecord(2_000)),
      execution,
      integrity,
      operatingDays: 700,
    }),
  };

  it("starts an agent with no record at UNVERIFIED", () => {
    const result = qualify({
      verifiedDecisions: 0,
      operatingDays: 0,
      proofCoverage: 0,
      metrics: computeMetrics([]),
      reputation: computeReputation({
        metrics: computeMetrics([]),
        execution,
        integrity,
        operatingDays: 0,
      }),
    });
    expect(result.tier).toBe("UNVERIFIED");
    expect(result.nextTier).toBe("VERIFIED");
    expect(result.unmet.length).toBeGreaterThan(0);
  });

  it("does not skip tiers when a single requirement is unmet", () => {
    const result = qualify({
      ...base,
      verifiedDecisions: 5_000,
      operatingDays: 900,
      proofCoverage: 0.5, // fails even the VERIFIED bar
    });
    expect(result.tier).toBe("UNVERIFIED");
  });

  it("orders tiers monotonically", () => {
    expect(tierRank("BRONZE")).toBeLessThan(tierRank("GOLD"));
    expect(tierRank("GOLD")).toBeLessThan(tierRank("ELITE"));
  });

  it("explains what is missing for the next tier", () => {
    const result = qualify({
      ...base,
      verifiedDecisions: 60,
      operatingDays: 40,
      proofCoverage: 1,
    });
    expect(result.nextTier).toBe("SILVER");
    expect(result.unmet.some((u) => u.requirement === "Verified decisions")).toBe(true);
  });
});
