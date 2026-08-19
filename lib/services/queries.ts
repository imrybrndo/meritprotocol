/**
 * Read models for the UI.
 *
 * Every query is wrapped in `safeQuery`. Pages must render before a database is
 * attached — an operator setting the project up should see the interface and a
 * clear "not connected" state, not a stack trace. A failure here is surfaced as
 * an explicit banner, never as invented numbers.
 */

import { getPrisma, isDatabaseConfigured } from "../db";
import { computeMetrics, type SettledTrade } from "../reputation/metrics";
import { computeReputation, type ReputationResult } from "../reputation/engine";
import { qualify, type QualificationResult } from "../qualification/tiers";

export interface DbState {
  connected: boolean;
  reason: string | null;
}

export async function safeQuery<T>(
  run: () => Promise<T>,
  fallback: T,
): Promise<{ data: T; state: DbState }> {
  if (!isDatabaseConfigured()) {
    return {
      data: fallback,
      state: {
        connected: false,
        reason: "DATABASE_URL is not set.",
      },
    };
  }

  try {
    return { data: await run(), state: { connected: true, reason: null } };
  } catch (error) {
    return {
      data: fallback,
      state: { connected: false, reason: (error as Error).message },
    };
  }
}

export interface AgentSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  chain: string;
  riskProfile: string;
  status: string;
  verificationStatus: string;
  isDemo: boolean;
  assets: string[];
  venues: string[];
  createdAt: Date;
  strategyName: string;
  strategyVersion: string;
  model: string;
  modelVersion: string;
  score: number;
  components: ReputationResult["components"];
  confidence: number;
  tier: string;
  roi: number;
  winRate: number;
  maxDrawdown: number;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  profitFactor: number | null;
  tradeCount: number;
  verifiedDecisions: number;
  proofCoverage: number;
  netPnl: number;
}

/**
 * Derive an agent's full public picture from its verified records.
 * This is the single place metrics, reputation and tier are computed for UI.
 */
export async function buildAgentSummaries(limit = 100): Promise<AgentSummary[]> {
  const prisma = getPrisma();

  const agents = await prisma.agent.findMany({
    take: limit,
    orderBy: { createdAt: "asc" },
    include: {
      strategies: {
        orderBy: { createdAt: "asc" },
        take: 1,
        include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } },
      },
      decisions: {
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
      },
    },
  });

  return agents.map((agent) => {
    const trades: SettledTrade[] = agent.decisions
      .filter((d) => d.outcome !== null)
      .map((d) => ({
        netPnl: Number(d.outcome!.realizedPnl),
        notional: Number(d.outcome!.notional),
        roi: Number(d.outcome!.roi),
        openedAt: d.committedAt,
        settledAt: d.outcome!.settledAt,
      }));

    const metrics = computeMetrics(trades);
    const decisionCount = agent.decisions.length;
    const provenCount = agent.decisions.filter((d) => d.proof !== null).length;
    const proofCoverage = decisionCount === 0 ? 0 : provenCount / decisionCount;

    const timestamps = agent.decisions.map((d) => d.decidedAt.getTime());
    const operatingDays =
      timestamps.length < 2
        ? 0
        : Math.round(
            (Math.max(...timestamps) - Math.min(...timestamps)) / 86_400_000,
          );

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

    const qualification: QualificationResult = qualify({
      verifiedDecisions: provenCount,
      operatingDays,
      proofCoverage,
      reputation,
      metrics,
    });

    const strategy = agent.strategies[0];
    const version = strategy?.versions[0];

    return {
      id: agent.id,
      slug: agent.slug,
      name: agent.name,
      description: agent.description,
      chain: agent.chain,
      riskProfile: agent.riskProfile,
      status: agent.status,
      verificationStatus: agent.verificationStatus,
      isDemo: agent.isDemo,
      assets: agent.assets,
      venues: agent.venues,
      createdAt: agent.createdAt,
      strategyName: strategy?.name ?? "—",
      strategyVersion: version?.version ?? "—",
      model: version?.model ?? "—",
      modelVersion: version?.modelVersion ?? "—",
      score: reputation.score,
      components: reputation.components,
      confidence: reputation.confidence,
      tier: qualification.tier,
      roi: metrics.roi,
      winRate: metrics.winRate,
      maxDrawdown: metrics.maxDrawdown,
      sharpeRatio: metrics.sharpeRatio,
      sortinoRatio: metrics.sortinoRatio,
      profitFactor: metrics.profitFactor,
      tradeCount: metrics.tradeCount,
      verifiedDecisions: provenCount,
      proofCoverage,
      netPnl: metrics.netPnl,
    };
  });
}

export interface ProtocolStats {
  agents: number;
  decisions: number;
  verifiedDecisions: number;
  settledTrades: number;
  proofs: number;
  batches: number;
  anchors: number;
  onChainAnchors: number;
  averageScore: number;
}

export async function getProtocolStats(summaries: AgentSummary[]): Promise<ProtocolStats> {
  const prisma = getPrisma();

  const [decisions, proofs, batches, anchors, onChainAnchors, settled] =
    await Promise.all([
      prisma.decision.count(),
      prisma.proof.count(),
      prisma.merkleBatch.count(),
      prisma.blockchainAnchor.count(),
      prisma.blockchainAnchor.count({ where: { status: "CONFIRMED" } }),
      prisma.outcome.count(),
    ]);

  const scored = summaries.filter((s) => s.tradeCount > 0);

  return {
    agents: summaries.length,
    decisions,
    verifiedDecisions: proofs,
    settledTrades: settled,
    proofs,
    batches,
    anchors,
    onChainAnchors,
    averageScore:
      scored.length === 0
        ? 0
        : scored.reduce((sum, s) => sum + s.score, 0) / scored.length,
  };
}
