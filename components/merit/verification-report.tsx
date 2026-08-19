import { Check, Minus, X } from "lucide-react";
import Link from "next/link";
import { Badge, Panel, PanelHeader } from "@/components/ui/primitives";
import type { VerificationResult } from "@/lib/services/verification";
import { cn, formatDateTime, truncateHash } from "@/lib/utils";

/**
 * The verification read-out.
 *
 * Every check is shown with its reasoning, including the ones that were skipped
 * — a verdict the reader cannot audit is just another claim.
 */
export function VerificationReport({ result }: { result: VerificationResult }) {
  const verdict = !result.decision
    ? "NOT_FOUND"
    : result.valid
      ? result.partial
        ? "PARTIAL"
        : "VERIFIED"
      : "INVALID";

  return (
    <div className="space-y-px">
      <VerdictBanner verdict={verdict} result={result} />

      <Panel className="rounded-none">
        <PanelHeader title="Checks" meta={`${result.checks.length} performed`} />
        <ul className="divide-y divide-line">
          {result.checks.map((check) => (
            <li key={check.id} className="flex gap-3 px-4 py-3">
              <StateIcon state={check.state} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-xs text-ink">{check.label}</span>
                  <span
                    className={cn(
                      "font-mono text-2xs uppercase",
                      check.state === "PASS" && "text-profit",
                      check.state === "FAIL" && "text-loss",
                      check.state === "SKIPPED" && "text-ink-faint",
                    )}
                  >
                    {check.state}
                  </span>
                </div>
                <p className="mt-1 text-2xs leading-relaxed text-ink-dim">{check.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      {result.decision ? (
        <div className="grid gap-px sm:grid-cols-2">
          <Panel className="rounded-none">
            <PanelHeader
              title="Decision"
              meta={result.decision.isDemo ? <Badge tone="demo">Demo</Badge> : null}
            />
            <dl className="divide-y divide-line/60">
              <Row label="Agent">
                <Link
                  href={`/agents/${result.decision.agentSlug}`}
                  className="text-signal hover:opacity-80"
                >
                  {result.decision.agentName}
                </Link>
              </Row>
              <Row label="Decision ID">
                <span className="font-mono text-2xs">{result.decision.id}</span>
              </Row>
              <Row label="Action">
                {result.decision.action} {result.decision.quantity} {result.decision.asset}
              </Row>
              <Row label="Price">{result.decision.price}</Row>
              <Row label="Confidence">{result.decision.confidence}</Row>
              <Row label="Strategy version">
                {result.decision.strategyVersion} · {result.decision.model}{" "}
                {result.decision.modelVersion}
              </Row>
              <Row label="Decided">{formatDateTime(result.decision.decidedAt)}</Row>
              <Row label="Committed">{formatDateTime(result.decision.committedAt)}</Row>
              <Row label="Commitment">
                <span className="hash">{result.decision.commitmentHash}</span>
              </Row>
              <Row label="Status">
                <StatusBadge status={result.decision.status} />
              </Row>
            </dl>
          </Panel>

          <Panel className="rounded-none">
            <PanelHeader title="Proof chain" />
            <dl className="divide-y divide-line/60">
              {result.proof ? (
                <>
                  <Row label="Leaf">
                    <span className="hash">{result.proof.leafHash}</span>
                  </Row>
                  <Row label="Leaf index">
                    {result.proof.leafIndex} of {result.proof.leafCount}
                  </Row>
                  <Row label="Path length">{result.proof.path.length} siblings</Row>
                  <Row label="Merkle root">
                    <span className="hash">{result.proof.merkleRoot}</span>
                  </Row>
                  <Row label="Batch">#{result.proof.batchSequence}</Row>
                </>
              ) : (
                <Row label="Proof">
                  <span className="text-ink-dim">Not yet batched</span>
                </Row>
              )}

              {result.anchor ? (
                <>
                  <Row label="Network">{result.anchor.network}</Row>
                  <Row label="Transaction">
                    {result.anchor.transactionHash ? (
                      result.anchor.explorerUrl ? (
                        <a
                          href={result.anchor.explorerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="hash text-signal hover:opacity-80"
                        >
                          {truncateHash(result.anchor.transactionHash, 14, 8)}
                        </a>
                      ) : (
                        <span className="hash">{result.anchor.transactionHash}</span>
                      )
                    ) : (
                      <span className="text-ink-dim">
                        None — sealed locally, no chain write
                      </span>
                    )}
                  </Row>
                  <Row label="Block">{result.anchor.blockNumber ?? "—"}</Row>
                  <Row label="Anchor status">
                    <AnchorBadge status={result.anchor.status} />
                  </Row>
                </>
              ) : (
                <Row label="Anchor">
                  <span className="text-ink-dim">Not yet anchored</span>
                </Row>
              )}
            </dl>
          </Panel>
        </div>
      ) : null}

      {result.outcome ? (
        <Panel className="rounded-none">
          <PanelHeader title="Outcome" meta="revealed after the commitment was sealed" />
          <div className="grid grid-cols-2 divide-x divide-line sm:grid-cols-4">
            <Cell label="Entry" value={result.outcome.entryPrice} />
            <Cell label="Exit" value={result.outcome.exitPrice} />
            <Cell
              label="Realised PnL"
              value={result.outcome.realizedPnl}
              tone={Number(result.outcome.realizedPnl) >= 0 ? "profit" : "loss"}
            />
            <Cell
              label="ROI"
              value={`${(Number(result.outcome.roi) * 100).toFixed(2)}%`}
              tone={Number(result.outcome.roi) >= 0 ? "profit" : "loss"}
            />
          </div>
          <div className="border-t border-line px-4 py-2">
            <span className="text-2xs text-ink-faint">Outcome hash </span>
            <span className="hash">{result.outcome.outcomeHash}</span>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function VerdictBanner({
  verdict,
  result,
}: {
  verdict: string;
  result: VerificationResult;
}) {
  const config = {
    VERIFIED: {
      tone: "border-profit/40 bg-profit-wash text-profit",
      title: "VERIFIED",
      body: "Every applicable check passed. The record is internally consistent, unaltered, and ordered as claimed.",
    },
    PARTIAL: {
      tone: "border-info/40 bg-info-wash text-info",
      title: "VERIFIED — INCOMPLETE",
      body: "Nothing failed, but some checks do not apply yet. See which steps were skipped below.",
    },
    INVALID: {
      tone: "border-loss/40 bg-loss-wash text-loss",
      title: "INVALID",
      body: "At least one check failed. This record does not verify against its proof chain.",
    },
    NOT_FOUND: {
      tone: "border-line-strong bg-raised text-ink-muted",
      title: "NOT FOUND",
      body: "Nothing in the registry matches this identifier.",
    },
  }[verdict]!;

  return (
    <div className={cn("border px-5 py-4", config.tone)}>
      <div className="font-mono text-lg tracking-[0.06em]">{config.title}</div>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed opacity-90">{config.body}</p>
      {verdict === "VERIFIED" || verdict === "PARTIAL" ? (
        <p className="mt-2 max-w-2xl text-2xs leading-relaxed text-ink-dim">
          This does not establish that the underlying market data was truthful,
          that unregistered activity did not occur, or anything about future
          performance.
        </p>
      ) : null}
      {result.decision?.isDemo ? (
        <p className="mt-2 text-2xs text-ink-dim">
          This is a seeded demo record. The cryptography is real; the trading is simulated.
        </p>
      ) : null}
    </div>
  );
}

function StateIcon({ state }: { state: string }) {
  if (state === "PASS") {
    return (
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-profit/40 text-profit">
        <Check size={10} strokeWidth={3} />
      </span>
    );
  }
  if (state === "FAIL") {
    return (
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-loss/40 text-loss">
        <X size={10} strokeWidth={3} />
      </span>
    );
  }
  return (
    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line-strong text-ink-faint">
      <Minus size={10} strokeWidth={3} />
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2">
      <dt className="w-32 shrink-0 text-2xs uppercase tracking-[0.1em] text-ink-faint">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-xs text-ink-muted">{children}</dd>
    </div>
  );
}

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "profit" | "loss";
}) {
  return (
    <div className="px-4 py-3">
      <div className="text-2xs uppercase tracking-[0.1em] text-ink-faint">{label}</div>
      <div
        className={cn(
          "mt-1 font-mono text-sm",
          tone === "profit" && "text-profit",
          tone === "loss" && "text-loss",
          !tone && "text-ink",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "SUCCESS"
      ? "profit"
      : status === "LOSS"
        ? "loss"
        : status === "OPEN"
          ? "info"
          : "neutral";
  return <Badge tone={tone as never}>{status.replace("_", " ")}</Badge>;
}

export function AnchorBadge({ status }: { status: string }) {
  const tone =
    status === "CONFIRMED" ? "profit" : status === "FAILED" ? "loss" : "neutral";
  const label = status === "LOCAL_ONLY" ? "Local only" : status;
  return <Badge tone={tone as never}>{label}</Badge>;
}
