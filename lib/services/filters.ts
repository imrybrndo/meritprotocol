/**
 * Marketplace and leaderboard filtering.
 *
 * Shared between the API and the server-rendered pages so a filtered URL and a
 * filtered API call can never disagree.
 */

export interface FilterableAgent {
  name: string;
  slug: string;
  tier: string;
  strategyName: string;
  assets: string[];
  chain: string;
  riskProfile: string;
  score: number;
  roi: number;
  maxDrawdown: number;
  winRate: number;
  tradeCount: number;
  sharpeRatio: number | null;
  components: { consistency: number };
  createdAt: Date;
}

export interface AgentQuery {
  search?: string;
  tier?: string;
  strategy?: string;
  asset?: string;
  chain?: string;
  risk?: string;
  minScore?: number;
  minRoi?: number;
  maxDrawdown?: number;
  minWinRate?: number;
  minTrades?: number;
  sort?: string;
}

export const SORT_LABELS: Record<string, string> = {
  score: "MERIT Score",
  roi: "ROI",
  sharpe: "Sharpe ratio",
  drawdown: "Lowest drawdown",
  consistency: "Consistency",
  trades: "Most verified trades",
};

export function applyFilters<T extends FilterableAgent>(
  agents: T[],
  query: AgentQuery,
): T[] {
  const needle = query.search?.toLowerCase().trim();

  const filtered = agents.filter((agent) => {
    if (
      needle &&
      !`${agent.name} ${agent.slug} ${agent.strategyName}`.toLowerCase().includes(needle)
    ) {
      return false;
    }
    if (query.tier && agent.tier !== query.tier) return false;
    if (query.strategy && agent.strategyName !== query.strategy) return false;
    if (query.asset && !agent.assets.includes(query.asset)) return false;
    if (query.chain && agent.chain !== query.chain) return false;
    if (query.risk && agent.riskProfile !== query.risk) return false;
    if (query.minScore !== undefined && agent.score < query.minScore) return false;
    if (query.minRoi !== undefined && agent.roi < query.minRoi) return false;
    if (query.maxDrawdown !== undefined && agent.maxDrawdown > query.maxDrawdown) return false;
    if (query.minWinRate !== undefined && agent.winRate < query.minWinRate) return false;
    if (query.minTrades !== undefined && agent.tradeCount < query.minTrades) return false;
    return true;
  });

  const comparators: Record<string, (a: T, b: T) => number> = {
    score: (a, b) => b.score - a.score,
    roi: (a, b) => b.roi - a.roi,
    sharpe: (a, b) => (b.sharpeRatio ?? -Infinity) - (a.sharpeRatio ?? -Infinity),
    // Lowest drawdown first — the only ascending sort.
    drawdown: (a, b) => a.maxDrawdown - b.maxDrawdown,
    consistency: (a, b) => b.components.consistency - a.components.consistency,
    trades: (a, b) => b.tradeCount - a.tradeCount,
  };

  return [...filtered].sort(comparators[query.sort ?? "score"] ?? comparators.score);
}
