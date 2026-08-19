import Link from "next/link";
import { ArrowRight, ArrowUpRight, MonitorDown } from "lucide-react";
import { ButtonLink, Eyebrow, Panel, PanelHeader } from "@/components/ui/primitives";
import { ProofPipeline } from "@/components/merit/proof-pipeline";
import { DesktopDownload } from "@/components/merit/desktop-download";

/**
 * The landing page.
 *
 * Deliberately static: it reads nothing from the database. The page used to
 * lead with a grid of seeded demo agents and their scores, which is exactly the
 * kind of unbacked number this protocol exists to make impossible — a visitor
 * has no way to tell a demo row from a real one at a glance, and putting
 * fabricated performance on the front page of a proof system is self-defeating.
 * Anyone who wants agents can open /agents, where the demo badge is unmissable.
 */
export default function LandingPage() {
  return (
    <>
      {/* ------------------------------------------------------------ hero -- */}
      <section className="relative border-b border-line">
        <div className="grid-field pointer-events-none absolute inset-0" aria-hidden="true" />

        <div className="relative mx-auto max-w-[1400px] px-4 pb-14 pt-16 sm:px-6 sm:pt-24">
          <Eyebrow>Verifiable reputation protocol</Eyebrow>

          <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-6xl">
            Prove the agent.
            <br />
            <span className="text-ink-dim">Not the claim.</span>
          </h1>

          <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-muted">
            Any agent can publish a track record. MERIT makes one checkable: every
            decision is sealed before the market resolves it, batched into a Merkle
            root anchored on-chain, and revealed afterwards against a hash that was
            already fixed. The verification runs on public data, and it runs
            without us.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <ButtonLink href="/verify" variant="primary" size="lg">
              Verify a trade
              <ArrowRight size={15} />
            </ButtonLink>
            <ButtonLink href="/agents" variant="outline" size="lg">
              Explore agents
            </ButtonLink>
            <Link
              href="#console"
              className="inline-flex items-center gap-2 px-1 text-sm text-ink-muted transition-colors hover:text-ink"
            >
              <MonitorDown size={15} />
              Download for macOS
            </Link>
          </div>

          <ul className="mt-12 grid gap-px border border-line bg-line sm:grid-cols-3">
            {[
              ["No custody", "The protocol never holds funds, and holds no key that can move them."],
              ["No delete path", "A committed call resolves. Losses stay in the public Failure Ledger."],
              ["No permission", "Every check re-runs from public data, by anyone, without asking."],
            ].map(([title, body]) => (
              <li key={title} className="bg-surface px-4 py-3.5">
                <div className="text-xs font-medium text-ink">{title}</div>
                <div className="mt-1 text-2xs leading-relaxed text-ink-dim">{body}</div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* --------------------------------------------------- how it works -- */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-[1400px] px-4 py-16 sm:px-6">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="mt-4 max-w-2xl text-2xl font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-3xl">
            Ordering is the whole mechanism.
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-muted">
            Screenshots, backtests and marketing are all produced after the fact, by
            the party they flatter. A commitment written before the outcome exists
            cannot be. That single constraint is what turns a claim into a record.
          </p>

          <div className="mt-10 border border-line">
            {/* Labelled as a worked example: the figures teach the mechanism,
                and on a page about unverifiable numbers they must not be
                mistakable for a real record. */}
            <PanelHeader title="Protocol pipeline" meta="worked example" />
            <ProofPipeline />
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- proof -- */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-[1400px] px-4 py-16 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,26rem)_1fr]">
            <div>
              <Eyebrow>Proof</Eyebrow>
              <h2 className="mt-4 text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-3xl">
                What a verification checks.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-ink-muted">
                Five checks, each independent. A failure names which one and why —
                a proof system that only ever reports success is not reporting
                anything.
              </p>
              <Link
                href="/docs/decision-proof"
                className="mt-6 inline-flex items-center gap-1.5 text-xs text-signal transition-opacity hover:opacity-80"
              >
                The proof layer <ArrowUpRight size={13} />
              </Link>
            </div>

            <ol className="grid gap-px self-start bg-line sm:grid-cols-2">
              {[
                ["Decision exists", "The record is present and was registered at a known time."],
                ["Commitment matches", "Re-hashing the revealed decision reproduces the sealed hash."],
                ["Merkle path holds", "The leaf resolves to the batch root through its sibling path."],
                ["Anchor confirms", "The root is read back from the chain, not from our database."],
                ["Ordering holds", "The commitment predates the outcome it is claimed to predict."],
              ].map(([title, body], index) => (
                <li key={title} className="bg-surface p-5">
                  <div className="font-mono text-2xs text-signal">
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <div className="mt-2 text-sm text-ink">{title}</div>
                  <div className="mt-1 text-xs leading-relaxed text-ink-dim">{body}</div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- console -- */}
      <DesktopDownload />

      {/* ------------------------------------------------------ developers -- */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-[1400px] px-4 py-16 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <Eyebrow>Developers</Eyebrow>
              <h2 className="mt-4 text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-3xl">
                Two calls from your agent.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-ink-muted">
                Record what was decided, and later what happened. The SDK handles
                commitment generation, proof retrieval and verification; MERIT does
                the cryptography.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <ButtonLink href="/docs/api" variant="outline" size="sm">
                  API reference
                </ButtonLink>
                <ButtonLink href="/docs/sdk" variant="ghost" size="sm">
                  SDK guide
                </ButtonLink>
              </div>
            </div>

            <Panel className="overflow-hidden">
              <PanelHeader title="@merit-protocol/sdk" meta="typescript" />
              <pre className="overflow-x-auto p-4 font-mono text-2xs leading-relaxed text-ink-muted">
                <code>{`const decision = await agent.recordDecision({
  asset: "ETH", action: "BUY", price: 1910.00, quantity: 2
});
// → sealed before the outcome exists

await agent.recordOutcome({
  decisionId: decision.id, exitPrice: 1988.40
});

await agent.verify(decision.id); // → VERIFIED`}</code>
              </pre>
            </Panel>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- final cta -- */}
      <section>
        <div className="mx-auto max-w-[1400px] px-4 py-20 text-center sm:px-6">
          <h2 className="text-3xl font-semibold tracking-[-0.03em] text-ink sm:text-4xl">
            Don&apos;t trust the track record.
            <br />
            <span className="text-signal">Verify it.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-lg text-sm leading-relaxed text-ink-muted">
            Open a decision and re-run the proof yourself. If a check fails, the
            page says so — that is the point of building it this way.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/verify" variant="primary" size="lg">
              Verify a trade
            </ButtonLink>
            <ButtonLink href="/docs" variant="outline" size="lg">
              Read the docs
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
