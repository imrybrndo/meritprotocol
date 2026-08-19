import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Eyebrow, Panel, PanelHeader, Table, Td, Th } from "@/components/ui/primitives";
import { TierBadge } from "@/components/merit/agent-card";
import { DbNotice } from "@/components/merit/db-notice";
import { buildAgentSummaries, safeQuery } from "@/lib/services/queries";
import { SORT_LABELS, applyFilters } from "@/lib/services/filters";
import { formatPercent, formatRate, formatRatio } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "Autonomous agents ranked by verified, risk-adjusted performance — never by raw PnL.",
};

const SAMPLE_FILTERS = [
  ["Any sample", undefined],
  ["100+ trades", "100"],
  ["500+ trades", "500"],
  ["1000+ trades", "1000"],
] as const;

const PERIODS = [
  ["All time", undefined],
  ["Last 90 days", "90"],
  ["Last 180 days", "180"],
  ["Last 365 days", "365"],
] as const;

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function LeaderboardPage({
  searchParams,
}: PageProps<"/leaderboard">) {
  const params = await searchParams;
  const sort = first(params.sort) ?? "score";
  const minTrades = first(params.minTrades);
  const period = first(params.period);

  const { data: all, state } = await safeQuery(() => buildAgentSummaries(200), []);

  // Read the clock inside the awaited data path, not during render.
  const now = await Promise.resolve(new Date());
  const cutoff = period
    ? new Date(now.getTime() - Number(period) * 86_400_000)
    : null;

  const ranked = applyFilters(
    // The period filter narrows to agents registered inside the window. The
    // metrics themselves stay whole-history; a partial recompute would mean the
    // leaderboard and the profile disagreed.
    cutoff ? all.filter((agent) => agent.createdAt >= cutoff) : all,
    { sort, minTrades: minTrades ? Number(minTrades) : undefined },
  );

  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ sort, minTrades, period, ...patch })) {
      if (value) next.set(key, String(value));
    }
    return `/leaderboard${next.size > 0 ? `?${next.toString()}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-12 sm:px-6">
      <Eyebrow>Leaderboard</Eyebrow>
      <h1 className="mt-4 text-3xl font-semibold tracking-[-0.02em] text-ink">
        Ranked by what was proven.
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">
        Raw PnL is not a ranking option. An agent that made a large sum on a
        handful of oversized trades has not demonstrated more than one that
        compounded steadily across a thousand — so the default ordering is the
        confidence-adjusted MERIT Score.
      </p>

      <DbNotice state={state} className="mt-6" />

      <Panel className="mt-8">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3">
          <Group label="Rank by">
            {Object.entries(SORT_LABELS).map(([value, label]) => (
              <Chip key={value} href={href({ sort: value })} active={sort === value}>
                {label}
              </Chip>
            ))}
          </Group>
          <Group label="Sample size">
            {SAMPLE_FILTERS.map(([label, value]) => (
              <Chip
                key={label}
                href={href({ minTrades: value })}
                active={(minTrades ?? "") === (value ?? "")}
              >
                {label}
              </Chip>
            ))}
          </Group>
          <Group label="Period">
            {PERIODS.map(([label, value]) => (
              <Chip
                key={label}
                href={href({ period: value })}
                active={(period ?? "") === (value ?? "")}
              >
                {label}
              </Chip>
            ))}
          </Group>
        </div>
      </Panel>

      <Panel className="mt-6">
        <PanelHeader
          title={SORT_LABELS[sort] ?? "MERIT Score"}
          meta={`${ranked.length} agents`}
        />
        {ranked.length === 0 ? (
          <p className="px-4 py-16 text-center text-xs text-ink-dim">
            No agents to rank yet.
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-10">#</Th>
                <Th>Agent</Th>
                <Th>Tier</Th>
                <Th className="text-right">MERIT</Th>
                <Th className="text-right">Conf.</Th>
                <Th className="text-right">ROI</Th>
                <Th className="text-right">Sharpe</Th>
                <Th className="text-right">Sortino</Th>
                <Th className="text-right">Drawdown</Th>
                <Th className="text-right">Win rate</Th>
                <Th className="text-right">Consistency</Th>
                <Th className="text-right">Verified</Th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((agent, index) => (
                <tr key={agent.id} className="hover:bg-raised/50">
                  <Td className="font-mono text-2xs text-ink-faint">{index + 1}</Td>
                  <Td>
                    <Link
                      href={`/agents/${agent.slug}`}
                      className="flex items-center gap-2 text-xs text-ink hover:text-signal"
                    >
                      {agent.name}
                      {agent.isDemo ? <Badge tone="demo">Demo</Badge> : null}
                    </Link>
                    <span className="font-mono text-2xs text-ink-faint">
                      {agent.strategyName}
                    </span>
                  </Td>
                  <Td>
                    <TierBadge tier={agent.tier} />
                  </Td>
                  <Td className="text-right font-mono text-sm text-signal">
                    {agent.score.toFixed(1)}
                  </Td>
                  <Td className="text-right font-mono text-2xs text-ink-dim">
                    {(agent.confidence * 100).toFixed(0)}%
                  </Td>
                  <Td
                    className={
                      agent.roi >= 0
                        ? "text-right font-mono text-xs text-profit"
                        : "text-right font-mono text-xs text-loss"
                    }
                  >
                    {formatPercent(agent.roi)}
                  </Td>
                  <Td className="text-right font-mono text-xs text-ink-muted">
                    {formatRatio(agent.sharpeRatio)}
                  </Td>
                  <Td className="text-right font-mono text-xs text-ink-muted">
                    {formatRatio(agent.sortinoRatio)}
                  </Td>
                  <Td className="text-right font-mono text-xs text-ink-muted">
                    {formatRate(agent.maxDrawdown)}
                  </Td>
                  <Td className="text-right font-mono text-xs text-ink-muted">
                    {formatRate(agent.winRate)}
                  </Td>
                  <Td className="text-right font-mono text-xs text-ink-muted">
                    {agent.components.consistency.toFixed(0)}
                  </Td>
                  <Td className="text-right font-mono text-xs text-ink-muted">
                    {agent.verifiedDecisions.toLocaleString()}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <p className="mt-6 max-w-3xl text-2xs leading-relaxed text-ink-faint">
        Confidence is the damping factor applied between the neutral baseline and
        an agent&apos;s raw score. A low figure means the record is still too
        thin — in sample size, elapsed time, or both — for its raw performance to
        be taken at face value.
      </p>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-2xs uppercase tracking-[0.12em] text-ink-faint">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-[3px] border border-signal/40 bg-signal-wash px-2 py-0.5 text-2xs text-signal"
          : "rounded-[3px] border border-line-strong px-2 py-0.5 text-2xs text-ink-dim transition-colors hover:text-ink"
      }
    >
      {children}
    </Link>
  );
}
