import { describe, expect, it } from "vitest";
import {
  canonicalDecimal,
  canonicalTimestamp,
  canonicalize,
} from "@/lib/crypto/canonical";
import {
  DOMAIN,
  commitDecision,
  digest,
  commitOutcome,
  hashStrategyConfig,
  isHash,
  sha256Hex,
  type DecisionCommitmentInput,
} from "@/lib/crypto/hash";

const decision: DecisionCommitmentInput = {
  agentId: "agent_001",
  strategyVersionId: "sv_001",
  strategyVersion: "2.1.0",
  asset: "SOL",
  action: "BUY",
  price: 182.4,
  quantity: 10,
  confidence: 0.81,
  decidedAt: new Date("2026-07-14T21:47:00.000Z"),
  nonce: "b6f1c0e2d3a44f5b8c9d0e1f2a3b4c5d",
  metadata: { venue: "drift", timeframe: "4h" },
};

describe("canonical serialisation", () => {
  it("sorts object keys regardless of insertion order", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it("omits undefined but preserves null", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalize({ a: null })).toBe('{"a":null}');
  });

  it("normalises equivalent decimal spellings", () => {
    expect(canonicalDecimal(182.4)).toBe(canonicalDecimal("182.40"));
    expect(canonicalDecimal("182.400000")).toBe(canonicalDecimal(182.4));
    expect(canonicalDecimal(0)).toBe(canonicalDecimal("-0"));
  });

  it("distinguishes values that genuinely differ", () => {
    expect(canonicalDecimal(182.4)).not.toBe(canonicalDecimal(182.41));
  });

  it("rejects non-finite numbers and junk decimals", () => {
    expect(() => canonicalDecimal(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalDecimal(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => canonicalDecimal("12.3.4")).toThrow(TypeError);
  });

  it("refuses to silently round away significant precision", () => {
    expect(() => canonicalDecimal("1.0000000000001", 6)).toThrow(RangeError);
    expect(canonicalDecimal("1.000000000000", 6)).toBe("1.000000");
  });

  it("commits timestamps as epoch milliseconds", () => {
    expect(canonicalTimestamp("2026-07-14T21:47:00.000Z")).toBe(
      String(Date.parse("2026-07-14T21:47:00.000Z")),
    );
    expect(canonicalTimestamp(new Date(0))).toBe("0");
  });

  it("nests deterministically", () => {
    const a = canonicalize({ outer: { z: [1, 2, { y: "x" }], a: true } });
    const b = canonicalize({ outer: { a: true, z: [1, 2, { y: "x" }] } });
    expect(a).toBe(b);
  });
});

describe("digest", () => {
  // Regression: an implementation that dropped the payload would return one
  // constant per domain, quietly making every commitment identical.
  it("varies with the payload", () => {
    expect(digest(DOMAIN.decision, "a")).not.toBe(digest(DOMAIN.decision, "b"));
  });

  it("varies with the domain", () => {
    expect(digest(DOMAIN.decision, "a")).not.toBe(digest(DOMAIN.outcome, "a"));
  });

  it("is exactly SHA-256 over `domain SPACE payload`", () => {
    expect(digest(DOMAIN.decision, "payload")).toBe(
      sha256Hex(`${DOMAIN.decision} payload`),
    );
  });

  it("cannot be collided by shifting the separator", () => {
    // "a.v1" + " " + "b" must not equal "a.v1 b" + " " + "" by construction.
    expect(digest(DOMAIN.decision, "x y")).not.toBe(digest(DOMAIN.decision, "x  y"));
  });
});

describe("decision commitments", () => {
  it("produces a 32-byte hex digest", () => {
    expect(isHash(commitDecision(decision))).toBe(true);
  });

  it("is deterministic", () => {
    expect(commitDecision(decision)).toBe(commitDecision({ ...decision }));
  });

  it("is insensitive to how equivalent numbers were written", () => {
    expect(commitDecision(decision)).toBe(
      commitDecision({ ...decision, price: "182.40", quantity: "10" }),
    );
  });

  it("is insensitive to metadata key order", () => {
    expect(commitDecision(decision)).toBe(
      commitDecision({ ...decision, metadata: { timeframe: "4h", venue: "drift" } }),
    );
  });

  // Each committed field must actually bind the record.
  const mutations: Array<[string, Partial<DecisionCommitmentInput>]> = [
    ["agentId", { agentId: "agent_002" }],
    ["strategyVersion", { strategyVersion: "2.1.1" }],
    ["strategyVersionId", { strategyVersionId: "sv_002" }],
    ["asset", { asset: "BTC" }],
    ["action", { action: "SELL" }],
    ["price", { price: 182.41 }],
    ["quantity", { quantity: 11 }],
    ["confidence", { confidence: 0.82 }],
    ["decidedAt", { decidedAt: new Date("2026-07-14T21:47:00.001Z") }],
    ["nonce", { nonce: "different-nonce" }],
    ["metadata", { metadata: { venue: "jupiter", timeframe: "4h" } }],
  ];

  for (const [field, patch] of mutations) {
    it(`changes when ${field} changes`, () => {
      expect(commitDecision({ ...decision, ...patch })).not.toBe(commitDecision(decision));
    });
  }

  it("separates the decision and outcome domains", () => {
    const shared = { a: 1 };
    expect(sha256Hex(`${DOMAIN.decision} ${canonicalize(shared)}`)).not.toBe(
      sha256Hex(`${DOMAIN.outcome} ${canonicalize(shared)}`),
    );
  });
});

describe("outcome commitments", () => {
  const outcome = {
    decisionId: "dec_9182",
    commitmentHash: commitDecision(decision),
    entryPrice: 182.4,
    exitPrice: 194.2,
    quantity: 10,
    fees: 2.14,
    slippage: 0.12,
    realizedPnl: 115.86,
    settledAt: new Date("2026-07-16T09:12:00.000Z"),
  };

  it("is deterministic and binds to the decision commitment", () => {
    expect(commitOutcome(outcome)).toBe(commitOutcome({ ...outcome }));
    expect(commitOutcome({ ...outcome, commitmentHash: sha256Hex("other") })).not.toBe(
      commitOutcome(outcome),
    );
  });

  it("changes when the realised result changes", () => {
    expect(commitOutcome({ ...outcome, exitPrice: 194.21 })).not.toBe(commitOutcome(outcome));
    expect(commitOutcome({ ...outcome, realizedPnl: 115.87 })).not.toBe(
      commitOutcome(outcome),
    );
  });
});

describe("strategy config hashing", () => {
  it("detects an undisclosed configuration change", () => {
    const v1 = hashStrategyConfig({ lookback: 24, threshold: 0.6 });
    const v2 = hashStrategyConfig({ lookback: 24, threshold: 0.61 });
    expect(v1).not.toBe(v2);
  });

  it("is order-independent", () => {
    expect(hashStrategyConfig({ a: 1, b: 2 })).toBe(hashStrategyConfig({ b: 2, a: 1 }));
  });
});
