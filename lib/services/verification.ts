/**
 * Verification engine.
 *
 * Runs the full chain of checks from a stored decision back to its on-chain
 * anchor. Every check is reported individually — a verdict without a reason is
 * just another claim, which is the thing MERIT exists to replace.
 *
 * Scope note, deliberately surfaced in the result: these checks prove the
 * integrity and chronology of what was *registered*. They do not prove that the
 * market data behind a decision was truthful, that no unregistered trading
 * occurred, or anything at all about future performance.
 */

import type { PrismaClient } from "../generated/prisma/client";
import { commitDecision, commitOutcome, hashEquals, type Hash } from "../crypto/hash";
import {
  computeRootFromProof,
  hashLeaf,
  type ProofStep,
} from "../crypto/merkle";
import { getAnchorService } from "../anchor";

export type CheckId =
  | "DECISION_EXISTS"
  | "COMMITMENT_MATCHES"
  | "COMMITTED_BEFORE_OUTCOME"
  | "MERKLE_INCLUSION"
  | "MERKLE_ROOT_MATCHES"
  | "ANCHOR_EXISTS"
  | "OUTCOME_MATCHES";

export type CheckState = "PASS" | "FAIL" | "SKIPPED";

export interface VerificationCheck {
  id: CheckId;
  label: string;
  state: CheckState;
  detail: string;
}

export interface VerificationResult {
  valid: boolean;
  /** True when every applicable check passed but some were not applicable yet. */
  partial: boolean;
  checks: VerificationCheck[];
  decision: {
    id: string;
    agentId: string;
    agentName: string;
    agentSlug: string;
    asset: string;
    action: string;
    price: string;
    quantity: string;
    confidence: string;
    status: string;
    commitmentHash: string;
    decidedAt: string;
    committedAt: string;
    strategyVersion: string;
    model: string;
    modelVersion: string;
    isDemo: boolean;
  } | null;
  outcome: {
    entryPrice: string;
    exitPrice: string;
    realizedPnl: string;
    roi: string;
    fees: string;
    slippage: string;
    outcomeHash: string;
    settledAt: string;
  } | null;
  proof: {
    leafHash: string;
    leafIndex: number;
    path: ProofStep[];
    merkleRoot: string;
    batchSequence: number;
    leafCount: number;
  } | null;
  anchor: {
    network: string;
    transactionHash: string | null;
    blockNumber: string | null;
    status: string;
    explorerUrl: string | null;
    anchoredAt: string | null;
    isOnChain: boolean;
  } | null;
}

const pass = (id: CheckId, label: string, detail: string): VerificationCheck => ({
  id,
  label,
  state: "PASS",
  detail,
});
const fail = (id: CheckId, label: string, detail: string): VerificationCheck => ({
  id,
  label,
  state: "FAIL",
  detail,
});
const skip = (id: CheckId, label: string, detail: string): VerificationCheck => ({
  id,
  label,
  state: "SKIPPED",
  detail,
});

function emptyResult(checks: VerificationCheck[]): VerificationResult {
  return {
    valid: false,
    partial: false,
    checks,
    decision: null,
    outcome: null,
    proof: null,
    anchor: null,
  };
}

/**
 * Resolve a free-text query to a decision.
 * Accepts a decision id, a commitment hash, or an anchor transaction hash.
 */
async function resolveDecisionId(
  prisma: PrismaClient,
  query: string,
): Promise<string | null> {
  const trimmed = query.trim();

  const byId = await prisma.decision.findUnique({
    where: { id: trimmed },
    select: { id: true },
  });
  if (byId) return byId.id;

  const byCommitment = await prisma.decision.findUnique({
    where: { commitmentHash: trimmed.toLowerCase() },
    select: { id: true },
  });
  if (byCommitment) return byCommitment.id;

  // A transaction hash identifies a batch; return its first member so the user
  // lands somewhere useful rather than on a dead end.
  const anchor = await prisma.blockchainAnchor.findFirst({
    where: { transactionHash: trimmed },
    select: { batch: { select: { proofs: { take: 1, select: { decisionId: true } } } } },
  });
  return anchor?.batch.proofs[0]?.decisionId ?? null;
}

/** Verify one decision end to end. */
export async function verifyDecision(
  prisma: PrismaClient,
  query: string,
): Promise<VerificationResult> {
  const decisionId = await resolveDecisionId(prisma, query);

  if (!decisionId) {
    return emptyResult([
      fail(
        "DECISION_EXISTS",
        "Decision exists",
        "No decision, commitment or anchor transaction matches this query.",
      ),
    ]);
  }

  const decision = await prisma.decision.findUnique({
    where: { id: decisionId },
    include: {
      agent: { select: { id: true, name: true, slug: true } },
      strategyVersion: { select: { id: true, version: true, model: true, modelVersion: true } },
      outcome: true,
      proof: { include: { batch: { include: { anchor: true } } } },
    },
  });

  if (!decision) {
    return emptyResult([
      fail("DECISION_EXISTS", "Decision exists", "Decision disappeared during lookup."),
    ]);
  }

  const checks: VerificationCheck[] = [
    pass(
      "DECISION_EXISTS",
      "Decision exists",
      `Registered ${decision.committedAt.toISOString()} by ${decision.agent.name}.`,
    ),
  ];

  // 1. Recompute the commitment from the stored fields.
  const recomputed = commitDecision({
    agentId: decision.agentId,
    strategyVersionId: decision.strategyVersionId,
    strategyVersion: decision.strategyVersion.version,
    asset: decision.asset,
    action: decision.action,
    price: decision.price.toFixed(12),
    quantity: decision.quantity.toFixed(12),
    confidence: decision.confidence.toFixed(12),
    decidedAt: decision.decidedAt,
    nonce: decision.nonce,
    metadata: stripInternalMetadata(decision.metadata),
  });

  const commitmentMatches = hashEquals(recomputed, decision.commitmentHash);
  checks.push(
    commitmentMatches
      ? pass(
          "COMMITMENT_MATCHES",
          "Commitment matches record",
          `Recomputed SHA-256 equals the stored commitment ${decision.commitmentHash.slice(0, 18)}…`,
        )
      : fail(
          "COMMITMENT_MATCHES",
          "Commitment matches record",
          `Recomputed ${recomputed.slice(0, 18)}… does not equal stored ${decision.commitmentHash.slice(0, 18)}…. The record has been altered.`,
        ),
  );

  // 2. Chronology: the commitment must predate the outcome.
  if (!decision.outcome) {
    checks.push(
      skip(
        "COMMITTED_BEFORE_OUTCOME",
        "Committed before outcome",
        "No outcome revealed yet — nothing to order against.",
      ),
    );
  } else {
    const ordered = decision.committedAt.getTime() <= decision.outcome.settledAt.getTime();
    checks.push(
      ordered
        ? pass(
            "COMMITTED_BEFORE_OUTCOME",
            "Committed before outcome",
            `Committed ${decision.committedAt.toISOString()}, settled ${decision.outcome.settledAt.toISOString()}.`,
          )
        : fail(
            "COMMITTED_BEFORE_OUTCOME",
            "Committed before outcome",
            "Outcome timestamp precedes the commitment.",
          ),
    );
  }

  // 3 & 4. Merkle inclusion against the batch root.
  const proof = decision.proof;
  if (!proof) {
    checks.push(
      skip("MERKLE_INCLUSION", "Merkle inclusion is valid", "Not yet included in a batch."),
      skip("MERKLE_ROOT_MATCHES", "Merkle root matches batch", "Not yet included in a batch."),
    );
  } else {
    const path = proof.path as unknown as ProofStep[];
    const leaf = hashLeaf(decision.commitmentHash as Hash);
    const leafOk = hashEquals(leaf, proof.leafHash);
    const recomputedRoot = computeRootFromProof(leaf, path);
    const rootOk = hashEquals(recomputedRoot, proof.batch.merkleRoot);

    checks.push(
      leafOk
        ? pass(
            "MERKLE_INCLUSION",
            "Merkle inclusion is valid",
            `Leaf ${proof.leafIndex + 1} of ${proof.batch.leafCount}, ${path.length} sibling${path.length === 1 ? "" : "s"} on the path.`,
          )
        : fail(
            "MERKLE_INCLUSION",
            "Merkle inclusion is valid",
            "Stored leaf hash does not match the decision commitment.",
          ),
      rootOk
        ? pass(
            "MERKLE_ROOT_MATCHES",
            "Merkle root matches batch",
            `Recomputed root equals batch #${proof.batch.sequence} root ${proof.batch.merkleRoot.slice(0, 18)}…`,
          )
        : fail(
            "MERKLE_ROOT_MATCHES",
            "Merkle root matches batch",
            `Recomputed ${recomputedRoot.slice(0, 18)}… does not equal the batch root.`,
          ),
    );
  }

  // 5. Anchor. Re-read the chain rather than trusting the stored row.
  const anchor = proof?.batch.anchor ?? null;
  const anchorService = getAnchorService();

  if (!anchor) {
    checks.push(skip("ANCHOR_EXISTS", "Blockchain anchor exists", "Batch not yet anchored."));
  } else if (!anchor.transactionHash) {
    checks.push(
      skip(
        "ANCHOR_EXISTS",
        "Blockchain anchor exists",
        `Sealed locally on ${anchor.network} with no chain write. This is not third-party verifiable.`,
      ),
    );
  } else {
    const onChain = await anchorService.verifyAnchor(
      anchor.merkleRoot as Hash,
      anchor.transactionHash,
    );
    checks.push(
      onChain.valid
        ? pass(
            "ANCHOR_EXISTS",
            "Blockchain anchor exists",
            `${anchor.network} transaction ${anchor.transactionHash.slice(0, 16)}… commits to this root at slot ${onChain.blockNumber ?? "?"}.`,
          )
        : fail(
            "ANCHOR_EXISTS",
            "Blockchain anchor exists",
            onChain.reason ?? "On-chain anchor could not be confirmed.",
          ),
    );
  }

  // 6. Outcome commitment.
  if (!decision.outcome) {
    checks.push(skip("OUTCOME_MATCHES", "Outcome matches record", "No outcome revealed yet."));
  } else {
    const recomputedOutcome = commitOutcome({
      decisionId: decision.id,
      commitmentHash: decision.commitmentHash,
      entryPrice: decision.outcome.entryPrice.toFixed(12),
      exitPrice: decision.outcome.exitPrice.toFixed(12),
      quantity: decision.outcome.quantity.toFixed(12),
      fees: decision.outcome.fees.toFixed(12),
      slippage: decision.outcome.slippage.toFixed(12),
      realizedPnl: decision.outcome.realizedPnl.toFixed(12),
      settledAt: decision.outcome.settledAt,
    });

    const outcomeOk = hashEquals(recomputedOutcome, decision.outcome.outcomeHash);
    checks.push(
      outcomeOk
        ? pass(
            "OUTCOME_MATCHES",
            "Outcome matches record",
            `Outcome hash ${decision.outcome.outcomeHash.slice(0, 18)}… binds to this decision's commitment.`,
          )
        : fail(
            "OUTCOME_MATCHES",
            "Outcome matches record",
            "Recomputed outcome hash does not match the stored value.",
          ),
    );
  }

  const failed = checks.filter((c) => c.state === "FAIL");
  const skipped = checks.filter((c) => c.state === "SKIPPED");

  return {
    valid: failed.length === 0,
    partial: failed.length === 0 && skipped.length > 0,
    checks,
    decision: {
      id: decision.id,
      agentId: decision.agentId,
      agentName: decision.agent.name,
      agentSlug: decision.agent.slug,
      asset: decision.asset,
      action: decision.action,
      price: decision.price.toFixed(4),
      quantity: decision.quantity.toFixed(4),
      confidence: decision.confidence.toFixed(2),
      status: decision.status,
      commitmentHash: decision.commitmentHash,
      decidedAt: decision.decidedAt.toISOString(),
      committedAt: decision.committedAt.toISOString(),
      strategyVersion: decision.strategyVersion.version,
      model: decision.strategyVersion.model,
      modelVersion: decision.strategyVersion.modelVersion,
      isDemo: decision.isDemo,
    },
    outcome: decision.outcome
      ? {
          entryPrice: decision.outcome.entryPrice.toFixed(4),
          exitPrice: decision.outcome.exitPrice.toFixed(4),
          realizedPnl: decision.outcome.realizedPnl.toFixed(2),
          roi: decision.outcome.roi.toFixed(6),
          fees: decision.outcome.fees.toFixed(4),
          slippage: decision.outcome.slippage.toFixed(4),
          outcomeHash: decision.outcome.outcomeHash,
          settledAt: decision.outcome.settledAt.toISOString(),
        }
      : null,
    proof: proof
      ? {
          leafHash: proof.leafHash,
          leafIndex: proof.leafIndex,
          path: proof.path as unknown as ProofStep[],
          merkleRoot: proof.batch.merkleRoot,
          batchSequence: proof.batch.sequence,
          leafCount: proof.batch.leafCount,
        }
      : null,
    anchor: anchor
      ? {
          network: anchor.network,
          transactionHash: anchor.transactionHash,
          blockNumber: anchor.blockNumber?.toString() ?? null,
          status: anchor.status,
          explorerUrl: anchor.explorerUrl,
          anchoredAt: anchor.anchoredAt?.toISOString() ?? null,
          isOnChain: anchorService.isOnChain,
        }
      : null,
  };
}

/**
 * Internal bookkeeping keys are stored on the record but were never part of the
 * committed pre-image, so they must be excluded when recomputing.
 */
function stripInternalMetadata(
  metadata: unknown,
): Record<string, never> | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;

  const rest = { ...(metadata as Record<string, unknown>) };
  delete rest.idempotencyKey;
  return Object.keys(rest).length > 0 ? (rest as Record<string, never>) : undefined;
}
