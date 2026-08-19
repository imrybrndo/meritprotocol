import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import {
  Badge,
  ButtonLink,
  Meter,
  Panel,
  PanelHeader,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { TierBadge } from "@/components/merit/agent-card";
import { AnchorBadge, StatusBadge } from "@/components/merit/verification-report";
import { DbNotice } from "@/components/merit/db-notice";
import { getPrisma } from "@/lib/db";
import { safeQuery } from "@/lib/services/queries";
import { TIER_REQUIREMENTS, qualify } from "@/lib/qualification/tiers";
import { AGENT_PICTURE_SELECT, derivePicture } from "@/lib/services/agent-picture";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatPercent,
  formatRate,
  formatRatio,
  formatSignedUsd,
  truncateHash,
} from "@/lib/utils";

export async function generateMetadata({
  params,
}: PageProps<"/agents/[agentId]">): Promise<Metadata> {
  const { agentId } = await params;
  return { title: agentId };
}

/** Everything the profile needs, in one round trip. */
async function loadProfile(agentId: string) {
  const prisma = getPrisma();

  const agent = await prisma.agent.findFirst({
    where: { OR: [{ id: agentId }, { slug: agentId }] },
    include: {
      strategies: {
        orderBy: { createdAt: "asc" },
        include: { versions: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
  if (!agent) return null;

  const [record, decisions, events, latestBatch] = await Promise.all([
    // The score is derived from the complete record. The table below shows the
    // most recent 400, but deriving from that slice would put a different score
    // on this page than the leaderboard shows for the same agent.
    prisma.decision.findMany({
      where: { agentId: agent.id },
      ...AGENT_PICTURE_SELECT,
    }),
    prisma.decision.findMany({
      where: { agentId: agent.id },
      orderBy: { decidedAt: "desc" },
      take: 400,
      include: {
        strategyVersion: { select: { version: true } },
        outcome: true,
        proof: { include: { batch: { include: { anchor: true } } } },
      },
    }),
    prisma.protocolEvent.findMany({
      where: { agentId: agent.id },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    prisma.merkleBatch.findFirst({
      where: { proofs: { some: { decision: { agentId: agent.id } } } },
      orderBy: { sequence: "desc" },
      include: { anchor: true },
    }),
  ]);

  return { agent, record, decisions, events, latestBatch };
}

export default async function AgentProfilePage({
  params,
}: PageProps<"/agents/[agentId]">) {
  const { agentId } = await params;
  const { data, state } = await safeQuery(() => loadProfile(agentId), null);

  if (!state.connected) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-12 sm:px-6">
        <DbNotice state={state} />
      </div>
    );
  }
  if (!data) notFound();

  const { agent, record, decisions, events, latestBatch } = data;

  const {
    metrics,
    reputation,
    qualification,
    proofCoverage,
    provenCount: proven,
    operatingDays,
    trades,
  } = derivePicture(record);

  const failures = decisions.filter((d) =>
    ["LOSS", "EXPIRED", "CANCELLED", "NO_GO", "TRADE_ABSTENTION"].includes(d.status),
  );

  const strategy = agent.strategies[0];
  const activeVersion = strategy?.versions.find((v) => v.status === "ACTIVE");

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
      {/* ------------------------------------------------------- overview -- */}
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-[-0.02em] text-ink">
              {agent.name}
            </h1>
            <TierBadge tier={qualification.tier} />
            {agent.verificationStatus === "VERIFIED" ? (
              <Badge tone="info">Verified</Badge>
            ) : null}
            {agent.isDemo ? <Badge tone="demo">Demo</Badge> : null}
          </div>
          <p className="mt-1 font-mono text-xs text-ink-dim">{agent.slug}</p>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">
            {agent.description}
          </p>
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-1 text-2xs">
            {[
              ["Strategy", strategy?.name ?? "—"],
              ["Version", activeVersion?.version ?? "—"],
              ["Model", activeVersion?.model ?? "—"],
              ["Model version", activeVersion?.modelVersion ?? "—"],
              ["Chain", agent.chain],
              ["Risk", agent.riskProfile],
              ["Registered", formatDate(agent.createdAt)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-ink-faint">{label}</dt>
                <dd className="font-mono text-ink-muted">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <Panel className="w-full shrink-0 sm:w-72">
          <PanelHeader title="MERIT Score" meta={`conf ${(reputation.confidence * 100).toFixed(0)}%`} />
          <div className="px-4 py-4">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-4xl leading-none text-signal">
                {reputation.score.toFixed(1)}
              </span>
              <span className="text-xs text-ink-faint">/ 100</span>
            </div>
            <Meter value={reputation.score} />
            <p className="mt-3 text-2xs leading-relaxed text-ink-dim">
              Raw score {reputation.rawScore.toFixed(1)}, damped to{" "}
              {reputation.score.toFixed(1)} by a confidence factor of{" "}
              {reputation.confidence.toFixed(2)} from {metrics.tradeCount} settled
              trades over {operatingDays} days.
            </p>
          </div>
        </Panel>
      </div>

      {/* ---------------------------------------------------- performance -- */}
      <section className="mt-10">
        <Panel>
          <PanelHeader title="Performance" meta="verified outcomes only" />
          <div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 lg:grid-cols-7">
            <Stat label="ROI" value={formatPercent(metrics.roi)} tone={metrics.roi >= 0 ? "profit" : "loss"} />
            <Stat label="Win rate" value={formatRate(metrics.winRate)} />
            <Stat label="Profit factor" value={formatRatio(metrics.profitFactor)} />
            <Stat label="Sharpe" value={formatRatio(metrics.sharpeRatio)} />
            <Stat label="Sortino" value={formatRatio(metrics.sortinoRatio)} />
            <Stat label="Max drawdown" value={formatRate(metrics.maxDrawdown)} tone="loss" />
            <Stat label="Trades" value={metrics.tradeCount.toLocaleString()} />
          </div>
          <div className="grid grid-cols-2 divide-x divide-line border-t border-line sm:grid-cols-4">
            <Stat
              label="Net PnL"
              value={formatSignedUsd(metrics.netPnl)}
              tone={metrics.netPnl >= 0 ? "profit" : "loss"}
            />
            <Stat label="Gross profit" value={formatSignedUsd(metrics.grossProfit)} />
            <Stat label="Gross loss" value={formatSignedUsd(-metrics.grossLoss)} />
            <Stat label="Avg hold" value={formatDuration(metrics.averageHoldingPeriodMs)} />
          </div>
        </Panel>
      </section>

      {/* ----------------------------------------- reputation + verification */}
      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Reputation components" meta="why this score" />
          <div className="divide-y divide-line">
            {(
              [
                ["Performance", reputation.components.performance],
                ["Risk", reputation.components.risk],
                ["Drawdown", reputation.components.drawdown],
                ["Consistency", reputation.components.consistency],
                ["Execution", reputation.components.execution],
                ["Integrity", reputation.components.integrity],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex items-center gap-4 px-4 py-2.5">
                <span className="w-28 shrink-0 text-xs text-ink-muted">{label}</span>
                <div className="flex-1">
                  <Meter value={value} tone={label === "Integrity" ? "profit" : "signal"} />
                </div>
                <span className="w-10 shrink-0 text-right font-mono text-xs text-ink">
                  {value.toFixed(0)}
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-line px-4 py-3">
            <Link href="/docs/merit-score" className="text-2xs text-signal">
              How this is computed →
            </Link>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Verification" meta="proof coverage" />
          <div className="grid grid-cols-2 divide-x divide-y divide-line">
            <Stat label="Verified decisions" value={proven.toLocaleString()} />
            <Stat label="Verified outcomes" value={trades.length.toLocaleString()} />
            <Stat
              label="Proof coverage"
              value={formatRate(proofCoverage)}
              tone={proofCoverage >= 0.99 ? "profit" : "default"}
            />
            <Stat label="Total decisions" value={decisions.length.toLocaleString()} />
          </div>
          <div className="space-y-2 border-t border-line px-4 py-3 text-2xs">
            <div className="flex items-baseline gap-3">
              <span className="w-28 shrink-0 text-ink-faint">Latest root</span>
              <span className="hash">
                {latestBatch ? latestBatch.merkleRoot : "—"}
              </span>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="w-28 shrink-0 text-ink-faint">Latest anchor</span>
              <span className="min-w-0 flex-1">
                {latestBatch?.anchor ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <AnchorBadge status={latestBatch.anchor.status} />
                    <span className="text-ink-dim">{latestBatch.anchor.network}</span>
                    {latestBatch.anchor.explorerUrl ? (
                      <a
                        href={latestBatch.anchor.explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="hash text-signal"
                      >
                        {truncateHash(latestBatch.anchor.transactionHash, 12, 6)}
                      </a>
                    ) : (
                      <span className="text-ink-faint">no chain write</span>
                    )}
                  </span>
                ) : (
                  <span className="text-ink-dim">—</span>
                )}
              </span>
            </div>
          </div>
        </Panel>
      </section>

      {/* --------------------------------------------------- qualification -- */}
      <section className="mt-6">
        <Panel>
          <PanelHeader
            title="Qualification"
            meta={qualification.nextTier ? `next: ${qualification.nextTier}` : "highest tier"}
          />
          <div className="flex flex-wrap gap-px bg-line">
            {TIER_REQUIREMENTS.map((requirement) => {
              const reached =
                TIER_REQUIREMENTS.findIndex((r) => r.tier === qualification.tier) >=
                TIER_REQUIREMENTS.findIndex((r) => r.tier === requirement.tier);
              return (
                <div
                  key={requirement.tier}
                  className="flex-1 basis-32 bg-surface px-3 py-2.5"
                >
                  <div
                    className={
                      reached
                        ? "text-2xs font-medium uppercase tracking-[0.1em] text-signal"
                        : "text-2xs font-medium uppercase tracking-[0.1em] text-ink-faint"
                    }
                  >
                    {requirement.tier}
                  </div>
                  <div className="mt-1 text-2xs leading-relaxed text-ink-dim">
                    {requirement.minVerifiedDecisions}+ decisions ·{" "}
                    {requirement.minOperatingDays}d
                  </div>
                </div>
              );
            })}
          </div>
          {qualification.unmet.length > 0 ? (
            <div className="border-t border-line px-4 py-3">
              <p className="text-2xs uppercase tracking-[0.12em] text-ink-faint">
                Outstanding for {qualification.nextTier}
              </p>
              <ul className="mt-2 space-y-1">
                {qualification.unmet.map((item) => (
                  <li key={item.requirement} className="flex gap-3 text-2xs">
                    <span className="w-36 shrink-0 text-ink-muted">{item.requirement}</span>
                    <span className="font-mono text-loss">{item.actual}</span>
                    <span className="text-ink-faint">needs {item.required}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Panel>
      </section>

      {/* ------------------------------------------------ strategy versions -- */}
      <section className="mt-6">
        <Panel>
          <PanelHeader title="Strategy versions" meta="immutable once registered" />
          <Table>
            <thead>
              <tr>
                <Th>Version</Th>
                <Th>Model</Th>
                <Th>Config hash</Th>
                <Th>Status</Th>
                <Th>Registered</Th>
              </tr>
            </thead>
            <tbody>
              {agent.strategies.flatMap((s) =>
                s.versions.map((version) => (
                  <tr key={version.id}>
                    <Td className="font-mono text-xs text-ink">v{version.version}</Td>
                    <Td className="text-xs text-ink-muted">
                      {version.model} {version.modelVersion}
                    </Td>
                    <Td>
                      <span className="hash">{truncateHash(version.configHash, 14, 8)}</span>
                    </Td>
                    <Td>
                      <Badge tone={version.status === "ACTIVE" ? "info" : "neutral"}>
                        {version.status}
                      </Badge>
                    </Td>
                    <Td className="font-mono text-2xs text-ink-dim">
                      {formatDate(version.createdAt)}
                    </Td>
                  </tr>
                )),
              )}
            </tbody>
          </Table>
        </Panel>
      </section>

      {/* ---------------------------------------------------------- history -- */}
      <section className="mt-6">
        <Panel>
          <PanelHeader
            title="Decision history"
            meta={`${decisions.length} most recent · losses included`}
          />
          <Table>
            <thead>
              <tr>
                <Th>Decided</Th>
                <Th>Action</Th>
                <Th className="text-right">Price</Th>
                <Th className="text-right">Exit</Th>
                <Th className="text-right">Net PnL</Th>
                <Th className="text-right">ROI</Th>
                <Th>Status</Th>
                <Th>Batch</Th>
                <Th>Commitment</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {decisions.slice(0, 60).map((decision) => (
                <tr key={decision.id} className="hover:bg-raised/50">
                  <Td className="whitespace-nowrap font-mono text-2xs text-ink-dim">
                    {formatDateTime(decision.decidedAt).slice(0, 16)}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">
                    <span className="text-ink">{decision.action}</span>{" "}
                    <span className="text-ink-dim">{decision.asset}</span>
                  </Td>
                  <Td className="text-right font-mono text-2xs text-ink-muted">
                    {Number(decision.price).toFixed(2)}
                  </Td>
                  <Td className="text-right font-mono text-2xs text-ink-muted">
                    {decision.outcome ? Number(decision.outcome.exitPrice).toFixed(2) : "—"}
                  </Td>
                  <Td
                    className={
                      decision.outcome
                        ? Number(decision.outcome.realizedPnl) >= 0
                          ? "text-right font-mono text-2xs text-profit"
                          : "text-right font-mono text-2xs text-loss"
                        : "text-right font-mono text-2xs text-ink-faint"
                    }
                  >
                    {decision.outcome
                      ? formatSignedUsd(Number(decision.outcome.realizedPnl))
                      : "—"}
                  </Td>
                  <Td
                    className={
                      decision.outcome
                        ? Number(decision.outcome.roi) >= 0
                          ? "text-right font-mono text-2xs text-profit"
                          : "text-right font-mono text-2xs text-loss"
                        : "text-right font-mono text-2xs text-ink-faint"
                    }
                  >
                    {decision.outcome
                      ? formatPercent(Number(decision.outcome.roi), 2)
                      : "—"}
                  </Td>
                  <Td>
                    <StatusBadge status={decision.status} />
                  </Td>
                  <Td className="font-mono text-2xs text-ink-dim">
                    {decision.proof ? `#${decision.proof.batch.sequence}` : "—"}
                  </Td>
                  <Td>
                    <span className="hash">{truncateHash(decision.commitmentHash, 10, 6)}</span>
                  </Td>
                  <Td>
                    <Link
                      href={`/verify?query=${decision.id}`}
                      className="inline-flex items-center gap-1 whitespace-nowrap text-2xs text-signal hover:opacity-80"
                    >
                      Verify <ArrowUpRight size={10} />
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      </section>

      {/* --------------------------------------------------- failure ledger -- */}
      <section className="mt-6">
        <Panel>
          <PanelHeader
            title="Failure ledger"
            meta={`${failures.length} unsuccessful or abandoned decisions`}
          />
          <p className="border-b border-line px-4 py-2.5 text-2xs leading-relaxed text-ink-dim">
            Losses, expirations and abstentions are part of the public record.
            There is no mechanism — for this agent or any other — to remove them.
          </p>
          {failures.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-ink-dim">
              No unsuccessful decisions recorded yet.
            </p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Decided</Th>
                  <Th>Action</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Net PnL</Th>
                  <Th>Commitment</Th>
                </tr>
              </thead>
              <tbody>
                {failures.slice(0, 25).map((decision) => (
                  <tr key={decision.id}>
                    <Td className="whitespace-nowrap font-mono text-2xs text-ink-dim">
                      {formatDateTime(decision.decidedAt).slice(0, 16)}
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-ink-muted">
                      {decision.action} {decision.asset}
                    </Td>
                    <Td>
                      <StatusBadge status={decision.status} />
                    </Td>
                    <Td className="text-right font-mono text-2xs text-loss">
                      {decision.outcome
                        ? formatSignedUsd(Number(decision.outcome.realizedPnl))
                        : "—"}
                    </Td>
                    <Td>
                      <span className="hash">{truncateHash(decision.commitmentHash, 10, 6)}</span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </section>

      {/* ----------------------------------------------------------- events -- */}
      {events.length > 0 ? (
        <section className="mt-6">
          <Panel>
            <PanelHeader title="Protocol events" meta="append-only" />
            <ul className="divide-y divide-line">
              {events.map((event) => (
                <li key={event.id} className="flex flex-wrap gap-x-4 px-4 py-2 text-2xs">
                  <span className="w-40 shrink-0 font-mono text-ink-dim">
                    {formatDateTime(event.createdAt).slice(0, 19)}
                  </span>
                  <span className="text-ink-muted">{event.type.replace(/_/g, " ")}</span>
                  {event.subjectId ? (
                    <span className="hash ml-auto">{truncateHash(event.subjectId, 10, 6)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>
        </section>
      ) : null}

      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/verify" variant="primary" size="md">
          Verify a decision
        </ButtonLink>
        <ButtonLink href="/agents" variant="ghost" size="md">
          Back to agents
        </ButtonLink>
      </div>
    </div>
  );
}
