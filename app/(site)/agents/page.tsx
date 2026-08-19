import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Eyebrow, Panel } from "@/components/ui/primitives";
import { AgentCard } from "@/components/merit/agent-card";
import { DbNotice } from "@/components/merit/db-notice";
import { buildAgentSummaries, safeQuery } from "@/lib/services/queries";
import { SORT_LABELS, applyFilters } from "@/lib/services/filters";
import { TIERS } from "@/lib/qualification/tiers";

export const metadata: Metadata = {
  title: "Agents",
  description:
    "Discover autonomous trading agents ranked by verified performance, not by claims.",
};

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default async function AgentsPage({ searchParams }: PageProps<"/agents">) {
  const params = await searchParams;
  const { data: all, state } = await safeQuery(() => buildAgentSummaries(200), []);

  const query = {
    search: first(params.search),
    tier: first(params.tier),
    strategy: first(params.strategy),
    asset: first(params.asset),
    chain: first(params.chain),
    risk: first(params.risk),
    minTrades: params.minTrades ? Number(first(params.minTrades)) : undefined,
    maxDrawdown: params.maxDrawdown ? Number(first(params.maxDrawdown)) : undefined,
    sort: first(params.sort) ?? "score",
  };

  const agents = applyFilters(all, query);

  // Facets come from the data rather than a hard-coded list.
  const assets = [...new Set(all.flatMap((agent) => agent.assets))].sort();
  const strategies = [...new Set(all.map((agent) => agent.strategyName))].sort();

  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...query, ...patch })) {
      if (value !== undefined && value !== "" && value !== null) next.set(key, String(value));
    }
    return `/agents${next.size > 0 ? `?${next.toString()}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-12 sm:px-6">
      <Eyebrow>Agent marketplace</Eyebrow>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-[-0.02em] text-ink">Agents</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted">
            Every number below is derived from records that were committed before
            their outcomes were known. Verify before you allocate.
          </p>
        </div>
        <div className="text-2xs text-ink-dim">
          {agents.length} of {all.length} agents
        </div>
      </div>

      <DbNotice state={state} className="mt-6" />

      {/* filters */}
      <Panel className="mt-8">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <FilterGroup label="Sort">
            {Object.entries(SORT_LABELS).map(([value, label]) => (
              <FilterChip key={value} href={href({ sort: value })} active={query.sort === value}>
                {label}
              </FilterChip>
            ))}
          </FilterGroup>

          <FilterGroup label="Tier">
            <FilterChip href={href({ tier: undefined })} active={!query.tier}>
              All
            </FilterChip>
            {TIERS.map((tier) => (
              <FilterChip key={tier} href={href({ tier })} active={query.tier === tier}>
                {tier}
              </FilterChip>
            ))}
          </FilterGroup>

          {assets.length > 0 ? (
            <FilterGroup label="Asset">
              <FilterChip href={href({ asset: undefined })} active={!query.asset}>
                All
              </FilterChip>
              {assets.map((asset) => (
                <FilterChip key={asset} href={href({ asset })} active={query.asset === asset}>
                  {asset}
                </FilterChip>
              ))}
            </FilterGroup>
          ) : null}

          {strategies.length > 0 ? (
            <FilterGroup label="Strategy">
              <FilterChip href={href({ strategy: undefined })} active={!query.strategy}>
                All
              </FilterChip>
              {strategies.map((strategy) => (
                <FilterChip
                  key={strategy}
                  href={href({ strategy })}
                  active={query.strategy === strategy}
                >
                  {strategy}
                </FilterChip>
              ))}
            </FilterGroup>
          ) : null}

          <FilterGroup label="Risk">
            <FilterChip href={href({ risk: undefined })} active={!query.risk}>
              All
            </FilterChip>
            {["CONSERVATIVE", "MODERATE", "AGGRESSIVE"].map((risk) => (
              <FilterChip key={risk} href={href({ risk })} active={query.risk === risk}>
                {risk.slice(0, 4)}
              </FilterChip>
            ))}
          </FilterGroup>

          <FilterGroup label="Sample">
            {[
              ["Any", undefined],
              ["100+", "100"],
              ["500+", "500"],
              ["1000+", "1000"],
            ].map(([label, value]) => (
              <FilterChip
                key={label as string}
                href={href({ minTrades: value as string | undefined })}
                active={String(query.minTrades ?? "") === (value ?? "")}
              >
                {label as string}
              </FilterChip>
            ))}
          </FilterGroup>
        </div>
      </Panel>

      {agents.length === 0 ? (
        <Panel className="mt-8">
          <div className="px-6 py-16 text-center">
            <p className="text-sm text-ink">No agents match these filters.</p>
            <p className="mt-2 text-xs text-ink-dim">
              {all.length === 0
                ? state.connected
                  ? "The registry is empty. Run npm run db:seed to load the demo agents."
                  : "No database connection, so the registry cannot be read."
                : "Try widening the filters."}
            </p>
            {all.length > 0 ? (
              <Link href="/agents" className="mt-4 inline-block text-xs text-signal">
                Clear filters
              </Link>
            ) : null}
          </div>
        </Panel>
      ) : (
        <div className="mt-8 grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}

      <p className="mt-8 text-2xs leading-relaxed text-ink-faint">
        Agents marked <Badge tone="demo">Demo</Badge> are seeded records. Their
        proofs are cryptographically real; their trading is simulated and must
        not be read as live performance.
      </p>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-2xs uppercase tracking-[0.12em] text-ink-faint">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function FilterChip({
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
