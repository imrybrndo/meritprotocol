/**
 * Performance metrics computed from verified outcomes only.
 *
 * Every function here is pure and takes explicit inputs, so the same numbers
 * can be recomputed by anyone holding the public record. Nothing in this module
 * reads the database.
 */

/** A settled trade, reduced to the fields the metrics need. */
export interface SettledTrade {
  /** Net profit and loss in quote currency, after fees and slippage. */
  netPnl: number;
  /** Capital committed to the position at entry. */
  notional: number;
  /** Return on the committed capital, as a fraction (0.05 = +5%). */
  roi: number;
  openedAt: Date;
  settledAt: Date;
}

export interface PerformanceMetrics {
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  /** Aggregate ROI weighted by notional, as a fraction. */
  roi: number;
  averageRoi: number;
  profitFactor: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  maxDrawdown: number;
  /** Standard deviation of per-trade ROI. */
  volatility: number;
  averageHoldingPeriodMs: number;
  /** Fraction of calendar days in the sample with at least one settled trade. */
  activeDayRatio: number;
}

export const EMPTY_METRICS: PerformanceMetrics = {
  tradeCount: 0,
  winCount: 0,
  lossCount: 0,
  winRate: 0,
  grossProfit: 0,
  grossLoss: 0,
  netPnl: 0,
  roi: 0,
  averageRoi: 0,
  profitFactor: null,
  sharpeRatio: null,
  sortinoRatio: null,
  maxDrawdown: 0,
  volatility: 0,
  averageHoldingPeriodMs: 0,
  activeDayRatio: 0,
};

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Sample standard deviation (n-1). Returns 0 for fewer than two samples. */
export function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Downside deviation against a target return — the denominator of Sortino. */
export function downsideDeviation(values: number[], target = 0): number {
  if (values.length < 2) return 0;
  const squares = values.map((value) => (value < target ? (value - target) ** 2 : 0));
  return Math.sqrt(squares.reduce((sum, value) => sum + value, 0) / (values.length - 1));
}

/**
 * Maximum peak-to-trough decline of the cumulative equity curve, as a fraction
 * of the running peak. Returns a positive number (0.114 = an 11.4% drawdown).
 */
export function maxDrawdown(trades: SettledTrade[], startingEquity = 10_000): number {
  if (trades.length === 0) return 0;

  let equity = startingEquity;
  let peak = startingEquity;
  let worst = 0;

  for (const trade of trades) {
    equity += trade.netPnl;
    if (equity > peak) peak = equity;
    if (peak > 0) {
      const decline = (peak - equity) / peak;
      if (decline > worst) worst = decline;
    }
  }

  return worst;
}

/**
 * Annualised Sharpe ratio from per-trade returns.
 *
 * `periodsPerYear` scales per-trade dispersion to an annual figure. It is an
 * approximation: trades are not evenly spaced, so this is derived from the
 * observed trade frequency rather than assumed.
 */
export function sharpeRatio(
  returns: number[],
  periodsPerYear: number,
  riskFreeRate = 0,
): number | null {
  if (returns.length < 2) return null;
  const deviation = standardDeviation(returns);
  if (deviation === 0) return null;

  const excess = mean(returns) - riskFreeRate / periodsPerYear;
  return (excess / deviation) * Math.sqrt(periodsPerYear);
}

export function sortinoRatio(
  returns: number[],
  periodsPerYear: number,
  riskFreeRate = 0,
): number | null {
  if (returns.length < 2) return null;
  const downside = downsideDeviation(returns);
  if (downside === 0) return null;

  const excess = mean(returns) - riskFreeRate / periodsPerYear;
  return (excess / downside) * Math.sqrt(periodsPerYear);
}

/** Gross profit divided by gross loss. Null when there are no losing trades. */
export function profitFactor(trades: SettledTrade[]): number | null {
  const profit = trades.filter((t) => t.netPnl > 0).reduce((s, t) => s + t.netPnl, 0);
  const loss = Math.abs(trades.filter((t) => t.netPnl < 0).reduce((s, t) => s + t.netPnl, 0));
  if (loss === 0) return null;
  return profit / loss;
}

/** Observed trades per year, used to annualise the risk ratios. */
export function tradesPerYear(trades: SettledTrade[]): number {
  if (trades.length < 2) return 252;

  const sorted = [...trades].sort((a, b) => a.settledAt.getTime() - b.settledAt.getTime());
  const spanMs = sorted[sorted.length - 1].settledAt.getTime() - sorted[0].settledAt.getTime();
  if (spanMs <= 0) return 252;

  const years = spanMs / (365.25 * 24 * 60 * 60 * 1000);
  return Math.max(1, trades.length / Math.max(years, 1 / 365.25));
}

function activeDayRatio(trades: SettledTrade[]): number {
  if (trades.length === 0) return 0;

  const dayKey = (date: Date) => Math.floor(date.getTime() / 86_400_000);
  const days = new Set(trades.map((t) => dayKey(t.settledAt)));
  const sorted = [...trades].sort((a, b) => a.settledAt.getTime() - b.settledAt.getTime());
  const span =
    dayKey(sorted[sorted.length - 1].settledAt) - dayKey(sorted[0].settledAt) + 1;

  return span <= 0 ? 0 : days.size / span;
}

/** Compute the full metric set for a list of settled trades. */
export function computeMetrics(trades: SettledTrade[]): PerformanceMetrics {
  if (trades.length === 0) return { ...EMPTY_METRICS };

  const ordered = [...trades].sort((a, b) => a.settledAt.getTime() - b.settledAt.getTime());
  const returns = ordered.map((t) => t.roi);

  const wins = ordered.filter((t) => t.netPnl > 0);
  const losses = ordered.filter((t) => t.netPnl < 0);

  const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
  const netPnl = ordered.reduce((s, t) => s + t.netPnl, 0);
  const totalNotional = ordered.reduce((s, t) => s + t.notional, 0);
  const periodsPerYear = tradesPerYear(ordered);

  return {
    tradeCount: ordered.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: wins.length / ordered.length,
    grossProfit,
    grossLoss,
    netPnl,
    roi: totalNotional > 0 ? netPnl / totalNotional : 0,
    averageRoi: mean(returns),
    profitFactor: profitFactor(ordered),
    sharpeRatio: sharpeRatio(returns, periodsPerYear),
    sortinoRatio: sortinoRatio(returns, periodsPerYear),
    maxDrawdown: maxDrawdown(ordered),
    volatility: standardDeviation(returns),
    averageHoldingPeriodMs: mean(
      ordered.map((t) => Math.max(0, t.settledAt.getTime() - t.openedAt.getTime())),
    ),
    activeDayRatio: activeDayRatio(ordered),
  };
}
