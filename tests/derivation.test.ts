/**
 * The single-derivation invariant.
 *
 * A score is now shown on a profile *and* written into history. Those are two
 * consumers of one number, and the moment either computes it independently the
 * protocol can publish a figure that disagrees with its own record — the one
 * failure a system built on re-derivable numbers cannot absorb.
 *
 * So the derivation lives in exactly one module, and that is asserted here
 * rather than left to convention.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { derivePicture, type DecisionRecord } from "@/lib/services/agent-picture";

const DAY = 86_400_000;
const ROOT = join(import.meta.dirname, "..");
/**
 * Both trees are scanned. Scanning only `lib` is how the agent profile page
 * came to keep its own copy of the derivation — and, because it derived from
 * the 400 most recent decisions rather than the whole record, showed a
 * different score than the leaderboard did for the same agent.
 */
const SCANNED = ["lib", "app", "components"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      // The generated Prisma client is machine-written and enormous.
      return entry === "generated" ? [] : sourceFiles(path);
    }
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

function decision(options: {
  dayOffset: number;
  roi?: number;
  notional?: number;
  proven?: boolean;
}): DecisionRecord {
  const { dayOffset, roi, notional = 1_000, proven = true } = options;
  const decidedAt = new Date(Date.UTC(2026, 0, 1) + dayOffset * DAY);

  return {
    id: `d_${dayOffset}`,
    decidedAt,
    committedAt: decidedAt,
    proof: proven ? { id: `p_${dayOffset}` } : null,
    outcome:
      roi === undefined
        ? null
        : {
            realizedPnl: notional * roi,
            roi,
            notional,
            settledAt: new Date(decidedAt.getTime() + 6 * 3_600_000),
          },
  };
}

describe("single derivation", () => {
  /**
   * The guard. `computeReputation` and `qualify` may only be called from
   * agent-picture.ts; every other module goes through `derivePicture`.
   */
  it("computes reputation and tier in exactly one module", () => {
    const offenders: string[] = [];
    const files = SCANNED.flatMap((dir) => sourceFiles(join(ROOT, dir)));

    for (const path of files) {
      // The engine and the tier module define these; the picture consumes them.
      if (
        path.endsWith(join("reputation", "engine.ts")) ||
        path.endsWith(join("qualification", "tiers.ts")) ||
        path.endsWith(join("services", "agent-picture.ts"))
      ) {
        continue;
      }

      const source = readFileSync(path, "utf8");
      if (/\bcomputeReputation\s*\(/.test(source) || /\bqualify\s*\(/.test(source)) {
        offenders.push(path.slice(ROOT.length + 1));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("is deterministic — the same record derives the same score twice", () => {
    const record = [
      decision({ dayOffset: 0, roi: 0.04 }),
      decision({ dayOffset: 30, roi: -0.02 }),
      decision({ dayOffset: 60, roi: 0.07 }),
    ];

    expect(derivePicture(record).reputation.score).toBe(
      derivePicture(record).reputation.score,
    );
  });
});

describe("derived picture", () => {
  it("reports an empty record without inventing a score", () => {
    const picture = derivePicture([]);
    expect(picture.decisionCount).toBe(0);
    expect(picture.trades).toHaveLength(0);
    expect(picture.proofCoverage).toBe(0);
    expect(picture.operatingDays).toBe(0);
    expect(picture.qualification.tier).toBe("UNVERIFIED");
  });

  it("counts proof coverage over all decisions, not just settled ones", () => {
    const picture = derivePicture([
      decision({ dayOffset: 0, roi: 0.05, proven: true }),
      decision({ dayOffset: 1, roi: 0.05, proven: true }),
      decision({ dayOffset: 2, proven: false }),
      decision({ dayOffset: 3, proven: false }),
    ]);

    expect(picture.decisionCount).toBe(4);
    expect(picture.provenCount).toBe(2);
    expect(picture.proofCoverage).toBe(0.5);
  });

  it("measures operating history from first to last decision", () => {
    const picture = derivePicture([
      decision({ dayOffset: 0, roi: 0.01 }),
      decision({ dayOffset: 90, roi: 0.01 }),
    ]);
    expect(picture.operatingDays).toBe(90);
  });

  it("treats a single decision as no operating history", () => {
    expect(derivePicture([decision({ dayOffset: 0, roi: 0.01 })]).operatingDays).toBe(0);
  });

  /**
   * Confidence damping, seen from the derivation rather than the engine: a
   * short flawless record must not outrank the neutral baseline by much.
   */
  it("damps a thin record toward the baseline", () => {
    const thin = derivePicture([
      decision({ dayOffset: 0, roi: 0.4 }),
      decision({ dayOffset: 1, roi: 0.4 }),
      decision({ dayOffset: 2, roi: 0.4 }),
    ]);

    expect(thin.reputation.score).toBeLessThan(60);
    expect(thin.reputation.rawScore).toBeGreaterThan(thin.reputation.score);
  });

  it("leaves an unproven record short of a tier that requires coverage", () => {
    const unproven = derivePicture(
      Array.from({ length: 60 }, (_, i) =>
        decision({ dayOffset: i, roi: 0.03, proven: false }),
      ),
    );

    expect(unproven.proofCoverage).toBe(0);
    expect(unproven.qualification.tier).toBe("UNVERIFIED");
  });
});
