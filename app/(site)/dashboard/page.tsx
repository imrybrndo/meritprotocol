import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Eyebrow, Panel, PanelHeader, Stat, Table, Td, Th } from "@/components/ui/primitives";
import { AnchorBadge, StatusBadge } from "@/components/merit/verification-report";
import { TierBadge } from "@/components/merit/agent-card";
import { DbNotice } from "@/components/merit/db-notice";
import { getPrisma } from "@/lib/db";
import { buildAgentSummaries, getProtocolStats, safeQuery } from "@/lib/services/queries";
import { getAnchorService } from "@/lib/anchor";
import { EVENT_LABELS, type EventType } from "@/lib/events";
import { formatCompact, formatDateTime, formatPercent, truncateHash } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Protocol-wide state: agents, decisions, proofs, batches and anchors.",
};

async function loadDashboard() {
  const prisma = getPrisma();
  const summaries = await buildAgentSummaries(200);

  const [stats, batches, decisions, events, verifications] = await Promise.all([
    getProtocolStats(summaries),
    prisma.merkleBatch.findMany({
      orderBy: { sequence: "desc" },
      take: 10,
      include: { anchor: true },
    }),
    prisma.decision.findMany({
      orderBy: { committedAt: "desc" },
      take: 12,
      include: {
        agent: { select: { slug: true, name: true } },
        outcome: { select: { roi: true } },
      },
    }),
    prisma.protocolEvent.findMany({ orderBy: { createdAt: "desc" }, take: 14 }),
    prisma.verificationRequest.count(),
  ]);

  return { summaries, stats, batches, decisions, events, verifications };
}

export default async function DashboardPage() {
  const { data, state } = await safeQuery(loadDashboard, null);
  const anchorService = getAnchorService();

  if (!data) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-12 sm:px-6">
        <Eyebrow>Protocol dashboard</Eyebrow>
        <h1 className="mt-4 text-3xl font-semibold tracking-[-0.02em] text-ink">Overview</h1>
        <DbNotice state={state} className="mt-6" />
      </div>
    );
  }

  const { summaries, stats, batches, decisions, events, verifications } = data;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-12 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Protocol dashboard</Eyebrow>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.02em] text-ink">Overview</h1>
        </div>
        <div className="flex items-center gap-2 text-2xs text-ink-dim">
          <span>Anchor adapter</span>
          <Badge tone={anchorService.isOnChain ? "profit" : "neutral"}>
            {anchorService.network}
          </Badge>
        </div>
      </div>

      {!anchorService.isOnChain ? (
        <div className="mt-6 border border-line-strong bg-raised px-4 py-3 text-2xs leading-relaxed text-ink-dim">
          Running on the local anchor adapter. Roots are sealed and stored, but no
          blockchain write occurs and no transaction hash is produced — anchors
          show as <span className="font-mono text-ink-muted">LOCAL_ONLY</span> and
          are not third-party verifiable. Set{" "}
          <code className="font-mono text-ink-muted">SOLANA_ANCHOR_SECRET_KEY</code>{" "}
          to anchor for real.
        </div>
      ) : null}

      <section className="mt-8 grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {[
          ["Registered agents", formatCompact(stats.agents)],
          ["Decisions", formatCompact(stats.decisions)],
          ["Verified decisions", formatCompact(stats.verifiedDecisions)],
          ["Settled trades", formatCompact(stats.settledTrades)],
          ["Merkle batches", formatCompact(stats.batches)],
          ["On-chain anchors", `${stats.onChainAnchors}/${stats.anchors}`],
          ["Average MERIT", stats.averageScore.toFixed(1)],
        ].map(([label, value]) => (
          <div key={label} className="bg-surface">
            <Stat label={label} value={value} />
          </div>
        ))}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <Panel>
          <PanelHeader title="Agents" meta={`${summaries.length} registered`} />
          <Table>
            <thead>
              <tr>
                <Th>Agent</Th>
                <Th>Tier</Th>
                <Th className="text-right">MERIT</Th>
                <Th className="text-right">ROI</Th>
                <Th className="text-right">Verified</Th>
                <Th className="text-right">Coverage</Th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((agent) => (
                <tr key={agent.id} className="hover:bg-raised/50">
                  <Td>
                    <Link href={`/agents/${agent.slug}`} className="text-xs text-ink hover:text-signal">
                      {agent.name}
                    </Link>
                  </Td>
                  <Td>
                    <TierBadge tier={agent.tier} />
                  </Td>
                  <Td className="text-right font-mono text-xs text-signal">
                    {agent.score.toFixed(1)}
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
                    {agent.verifiedDecisions.toLocaleString()}
                  </Td>
                  <Td className="text-right font-mono text-xs text-ink-muted">
                    {(agent.proofCoverage * 100).toFixed(0)}%
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>

        <Panel>
          <PanelHeader title="Protocol events" meta="append-only log" />
          <ul className="divide-y divide-line">
            {events.map((event) => (
              <li key={event.id} className="px-4 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-2xs text-ink-muted">
                    {EVENT_LABELS[event.type as EventType] ?? event.type}
                  </span>
                  <span className="shrink-0 font-mono text-2xs text-ink-faint">
                    {formatDateTime(event.createdAt).slice(5, 16)}
                  </span>
                </div>
                {event.subjectId ? (
                  <span className="hash">{truncateHash(event.subjectId, 12, 6)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Merkle batches" meta={`${stats.batches} total`} />
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Root</Th>
                <Th className="text-right">Leaves</Th>
                <Th>Network</Th>
                <Th>Anchor</Th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <tr key={batch.id}>
                  <Td className="font-mono text-2xs text-ink-dim">{batch.sequence}</Td>
                  <Td>
                    <span className="hash">{truncateHash(batch.merkleRoot, 12, 6)}</span>
                  </Td>
                  <Td className="text-right font-mono text-2xs text-ink-muted">
                    {batch.leafCount}
                  </Td>
                  <Td className="font-mono text-2xs text-ink-dim">
                    {batch.anchor?.network ?? "—"}
                  </Td>
                  <Td>
                    {batch.anchor ? <AnchorBadge status={batch.anchor.status} /> : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>

        <Panel>
          <PanelHeader
            title="Recent commitments"
            meta={`${verifications.toLocaleString()} verification requests served`}
          />
          <Table>
            <thead>
              <tr>
                <Th>Agent</Th>
                <Th>Action</Th>
                <Th>Status</Th>
                <Th>Commitment</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {decisions.map((decision) => (
                <tr key={decision.id}>
                  <Td className="text-xs text-ink-muted">{decision.agent.name}</Td>
                  <Td className="whitespace-nowrap text-2xs text-ink-muted">
                    {decision.action} {decision.asset}
                  </Td>
                  <Td>
                    <StatusBadge status={decision.status} />
                  </Td>
                  <Td>
                    <span className="hash">{truncateHash(decision.commitmentHash, 10, 5)}</span>
                  </Td>
                  <Td>
                    <Link
                      href={`/verify?query=${decision.id}`}
                      className="whitespace-nowrap text-2xs text-signal"
                    >
                      Verify
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      </section>
    </div>
  );
}
