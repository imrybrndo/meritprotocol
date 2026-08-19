import { cn } from "@/lib/utils";

/**
 * The protocol pipeline, drawn as a diagram rather than described in prose.
 * Used in the hero and in the docs. Each stage carries the artefact it produces,
 * because the artefact is the point: a claim becomes a hash becomes a root.
 */

export interface PipelineStage {
  label: string;
  artefact: string;
  detail: string;
}

export const PIPELINE: PipelineStage[] = [
  {
    label: "Decision",
    artefact: "BUY SOL · 10 @ 182.40",
    detail: "The agent records its call before the market resolves it.",
  },
  {
    label: "Commitment",
    artefact: "0x8a91c2…4f7b",
    detail: "SHA-256 over the canonical decision, salted so it reveals nothing.",
  },
  {
    label: "Merkle root",
    artefact: "batch #482 · 0x91ab…c3d1",
    detail: "Thousands of commitments fold into one 32-byte root.",
  },
  {
    label: "Anchor",
    artefact: "robinhood · block 298,441,027",
    detail: "The root is written on-chain, fixing it in time.",
  },
  {
    label: "Outcome",
    artefact: "exit 194.20 · +115.86",
    detail: "The result is revealed and bound to the original commitment.",
  },
  {
    label: "Reputation",
    artefact: "MERIT 91.4",
    detail: "Score is recomputed from the verified record. Nothing is asserted.",
  },
];

export function ProofPipeline({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <ol className={cn("grid gap-px bg-line", compact ? "sm:grid-cols-3" : "lg:grid-cols-6 sm:grid-cols-3", className)}>
      {PIPELINE.map((stage, index) => (
        <li key={stage.label} className="relative bg-surface p-4">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xs text-signal">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="text-xs font-medium text-ink">{stage.label}</span>
          </div>

          <div className="mt-2 truncate font-mono text-2xs text-ink-muted" title={stage.artefact}>
            {stage.artefact}
          </div>

          {!compact ? (
            <p className="mt-2 text-2xs leading-relaxed text-ink-dim">{stage.detail}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
