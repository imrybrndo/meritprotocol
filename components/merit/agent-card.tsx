import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge, Meter } from "@/components/ui/primitives";
import type { AgentSummary } from "@/lib/services/queries";
import { cn, formatPercent, formatRate, formatRatio } from "@/lib/utils";

const TIER_TONE: Record<string, "neutral" | "signal" | "info"> = {
  UNVERIFIED: "neutral",
  VERIFIED: "info",
  BRONZE: "neutral",
  SILVER: "neutral",
  GOLD: "signal",
  ELITE: "signal",
};

export function TierBadge({ tier }: { tier: string }) {
  return <Badge tone={TIER_TONE[tier] ?? "neutral"}>{tier}</Badge>;
}

/**
 * Marketplace card.
 *
 * The primary action is "View proof", not "Invest" — discovery is meant to lead
 * to the evidence, not to a capital decision.
 */
export function AgentCard({ agent }: { agent: AgentSummary }) {
  return (
    <Link
      href={`/agents/${agent.slug}`}
      className="group flex flex-col bg-surface p-5 transition-colors hover:bg-raised"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-ink">{agent.name}</h3>
          <p className="mt-0.5 font-mono text-2xs text-ink-dim">{agent.slug}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <TierBadge tier={agent.tier} />
          {agent.isDemo ? <Badge tone="demo">Demo</Badge> : null}
        </div>
      </div>

      <p className="mt-3 line-clamp-2 text-2xs leading-relaxed text-ink-dim">
        {agent.strategyName} · v{agent.strategyVersion}
      </p>

      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-2xl leading-none text-signal">
            {agent.score.toFixed(1)}
          </span>
          <span className="text-2xs text-ink-faint">
            MERIT · conf {(agent.confidence * 100).toFixed(0)}%
          </span>
        </div>
        <Meter value={agent.score} />
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-y-3 text-2xs">
        <Metric label="ROI" value={formatPercent(agent.roi)} tone={agent.roi >= 0 ? "profit" : "loss"} />
        <Metric label="Drawdown" value={formatRate(agent.maxDrawdown)} />
        <Metric label="Win rate" value={formatRate(agent.winRate)} />
        <Metric label="Sharpe" value={formatRatio(agent.sharpeRatio)} />
        <Metric label="Verified" value={agent.verifiedDecisions.toLocaleString()} />
        <Metric label="Risk" value={agent.riskProfile.slice(0, 4)} />
      </dl>

      <div className="mt-5 flex items-center gap-1.5 border-t border-line pt-3 text-2xs text-ink-dim transition-colors group-hover:text-signal">
        View proof <ArrowUpRight size={11} />
      </div>
    </Link>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "profit" | "loss";
}) {
  return (
    <div>
      <dt className="text-ink-faint">{label}</dt>
      <dd
        className={cn(
          "font-mono",
          tone === "profit" && "text-profit",
          tone === "loss" && "text-loss",
          !tone && "text-ink-muted",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
