import { Badge, Panel, PanelHeader, Table, Td, Th } from "@/components/ui/primitives";
import { truncateHash } from "@/lib/utils";
import type { ProvenanceView } from "@/lib/services/provenance";

/**
 * Source provenance, shown as a claim of its own.
 *
 * Deliberately not folded into the MERIT Score panel, and deliberately not
 * rendered as a bare green tick. This panel answers "where does this agent's
 * code live, and is it still there" — a different question from "did this agent
 * trade well", answered by a different kind of evidence.
 *
 * The note at the foot is the most important part of the component. A passing
 * scan means the repository is public and contains the pinned commit; it does
 * not mean the agent ran that code, and an interface that lets a reader assume
 * otherwise is selling a certainty the protocol does not have.
 */

export interface ProvenanceEntry {
  versionId: string;
  version: string;
  declared: boolean;
  scan: ProvenanceView | null;
}

const STATE_TONE = {
  VERIFIED: "info",
  MISMATCH: "loss",
  MISSING: "loss",
  UNREACHABLE: "neutral",
} as const;

const STATE_LABEL = {
  VERIFIED: "Verified",
  MISMATCH: "Commit gone",
  MISSING: "Not readable",
  UNREACHABLE: "Not checked",
} as const;

function formatDate(value: Date | null): string {
  if (!value) return "—";
  return value.toISOString().slice(0, 10);
}

export function ProvenancePanel({ entries }: { entries: ProvenanceEntry[] }) {
  const declared = entries.filter((entry) => entry.declared);

  return (
    <Panel>
      <PanelHeader title="Source provenance" meta="not a score input" />

      {declared.length === 0 ? (
        <div className="px-4 py-4">
          <p className="text-2xs leading-relaxed text-ink-dim">
            No strategy version on this agent declares a source repository.
            That is permitted — disclosure is voluntary — but it means nothing
            here can be checked against published code. The absence is shown
            rather than hidden, because an agent choosing not to disclose is
            itself something a reader should be able to see.
          </p>
        </div>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Version</Th>
                <Th>Repository</Th>
                <Th>Pinned commit</Th>
                <Th>State</Th>
                <Th>Last scanned</Th>
              </tr>
            </thead>
            <tbody>
              {declared.map((entry) => (
                <tr key={entry.versionId}>
                  <Td className="font-mono text-xs text-ink">v{entry.version}</Td>
                  <Td className="text-xs text-ink-muted">
                    {entry.scan ? (
                      <a
                        href={`https://${entry.scan.repository}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="hover:text-signal"
                      >
                        {entry.scan.repository}
                      </a>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td>
                    {entry.scan ? (
                      <a
                        href={entry.scan.commitUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="hash hover:text-signal"
                      >
                        {truncateHash(entry.scan.commitSha, 10, 6)}
                      </a>
                    ) : (
                      <span className="text-2xs text-ink-faint">not yet scanned</span>
                    )}
                  </Td>
                  <Td>
                    {entry.scan ? (
                      <Badge tone={STATE_TONE[entry.scan.state]}>
                        {STATE_LABEL[entry.scan.state]}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">Pending</Badge>
                    )}
                  </Td>
                  <Td className="font-mono text-2xs text-ink-dim">
                    {entry.scan ? formatDate(entry.scan.scannedAt) : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>

          {/* Per-check detail for the most recent scan that has one. */}
          {declared[0]?.scan ? (
            <div className="border-t border-line px-4 py-3">
              <div className="text-2xs uppercase tracking-[0.12em] text-ink-faint">
                Checks · v{declared[0].version}
              </div>
              <ul className="mt-2 space-y-1.5">
                {declared[0].scan.checks.map((check) => (
                  <li key={check.id} className="flex gap-2 text-2xs leading-relaxed">
                    <span
                      className={
                        check.state === "PASS"
                          ? "shrink-0 font-mono text-profit"
                          : check.state === "FAIL"
                            ? "shrink-0 font-mono text-loss"
                            : "shrink-0 font-mono text-ink-faint"
                      }
                    >
                      {check.state === "PASS" ? "PASS" : check.state === "FAIL" ? "FAIL" : "SKIP"}
                    </span>
                    <span className="text-ink-dim">
                      <span className="text-ink-muted">{check.label}</span> — {check.detail}
                    </span>
                  </li>
                ))}
              </ul>

              {declared[0].scan.license || declared[0].scan.primaryLanguage ? (
                <p className="mt-3 font-mono text-2xs text-ink-faint">
                  {[
                    declared[0].scan.primaryLanguage,
                    declared[0].scan.license,
                    declared[0].scan.repoCreatedAt
                      ? `created ${formatDate(declared[0].scan.repoCreatedAt)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      <div className="border-t border-line px-4 py-3">
        <p className="text-2xs leading-relaxed text-ink-dim">
          A passing scan establishes that the named repository is publicly
          readable and still contains the pinned commit. Because a commit SHA
          hashes the whole tree, that content cannot change without the SHA
          changing — so anyone can clone it and read exactly what was registered.
        </p>
        <p className="mt-2 text-2xs leading-relaxed text-ink-faint">
          It does <span className="text-ink-muted">not</span> establish that the
          agent executed that code. Disclosure is not attestation. Nothing on
          this panel is an input to the MERIT Score.
        </p>
      </div>
    </Panel>
  );
}
