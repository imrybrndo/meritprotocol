import { ArrowUpRight, Download, KeyRound, ShieldCheck, Terminal } from "lucide-react";
import { Badge, Eyebrow, Panel, PanelHeader } from "@/components/ui/primitives";
import { getDesktopRelease } from "@/lib/desktop";

/* The panels the shipped app actually has — see desktop/README.md. */
const PANELS = [
  ["Dashboard", "Wallet balance, live markets, and every decision you have sealed."],
  ["Chat", "Talk through a call. Every commit is gated on your approval."],
  ["Agents", "The agents registered on the deployment you point at."],
  ["Perps", "Live Hyperliquid markets, and long/short from the same panel."],
  ["Settings", "Account, chat model, and credentials encrypted by the OS keyring."],
] as const;

const PROPERTIES = [
  {
    icon: ShieldCheck,
    title: "Your key, your machine",
    body: "The wallet is generated on your machine and encrypted at rest with your password. It never leaves the main process, and no server ever sees it — MERIT holds nothing that can move your funds.",
  },
  {
    icon: KeyRound,
    title: "Credentials never cross the bridge",
    body: "API keys are encrypted at rest with the OS keyring and held in the main process. The window asks for a call to be made; it never sees a key.",
  },
  {
    icon: Terminal,
    title: "Sealed before it is sent",
    body: "An order is committed to MERIT first and only then placed at the venue. The ordering is enforced in the app, not left to the operator to remember.",
  },
] as const;

/**
 * The desktop download block.
 *
 * When no artefact URL is configured the section refuses to render a download
 * button — an offer to download something that does not exist is exactly the
 * kind of unbacked claim this protocol exists to make impossible.
 */
export function DesktopDownload() {
  const release = getDesktopRelease();

  return (
    <section id="console" className="border-b border-line">
      <div className="mx-auto max-w-[1400px] px-4 py-16 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
          {/* -------------------------------------------------- narrative -- */}
          <div>
            <Eyebrow>Desktop console</Eyebrow>
            <h2 className="mt-4 max-w-xl text-2xl font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-3xl">
              Seal the call before you place it.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink-muted">
              MERIT Console is the operator side of the protocol. You reason
              through a call with the agent, seal it as a commitment, and only
              then place it on Hyperliquid — signed by a wallet that never leaves
              your machine. A terminal executes and logs afterwards; a record
              written once the outcome is known proves nothing. The console seals
              first, and the app enforces that order.
            </p>

            <div className="mt-6 font-mono text-2xs text-ink-dim">
              propose → <span className="text-signal">commit</span> → execute → reveal
            </div>

            <div className="mt-8 grid gap-px bg-line sm:grid-cols-3">
              {PROPERTIES.map(({ icon: Icon, title, body }) => (
                <div key={title} className="bg-surface p-5">
                  <Icon size={14} className="text-signal" aria-hidden="true" />
                  <h3 className="mt-3 text-xs font-medium text-ink">{title}</h3>
                  <p className="mt-1.5 text-2xs leading-relaxed text-ink-dim">{body}</p>
                </div>
              ))}
            </div>

            <Panel className="mt-8 overflow-hidden">
              <PanelHeader title="What ships in the window" meta="five panels" />
              <div className="divide-y divide-line">
                {PANELS.map(([name, detail]) => (
                  <div key={name} className="flex items-baseline gap-4 px-4 py-2.5">
                    <div className="w-16 shrink-0 text-xs text-ink">{name}</div>
                    <div className="min-w-0 text-2xs leading-relaxed text-ink-dim">
                      {detail}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          {/* --------------------------------------------------- download -- */}
          <div className="lg:sticky lg:top-20 lg:self-start">
            <Panel className="overflow-hidden">
              <PanelHeader
                title="MERIT Console"
                meta={`v${release.version} · macOS`}
              />

              {release.available ? (
                <div className="divide-y divide-line">
                  {release.builds.map((build) => (
                    <div key={build.arch} className="px-4 py-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-sm text-ink">{build.label}</div>
                          <div className="mt-0.5 font-mono text-2xs text-ink-dim">
                            {build.arch} · {build.hardware}
                            {build.size ? ` · ${build.size}` : ""}
                          </div>
                        </div>

                        {build.url ? (
                          <a
                            href={build.url}
                            download
                            className="inline-flex shrink-0 items-center gap-2 rounded-[3px] bg-signal px-4 py-2 text-xs font-medium text-[#0a0b0d] transition-colors hover:bg-[#ffc44d]"
                          >
                            <Download size={13} />
                            Download .dmg
                          </a>
                        ) : (
                          <Badge tone="neutral">Not published</Badge>
                        )}
                      </div>

                      {build.sha256 ? (
                        <div className="mt-3 border-t border-line pt-3">
                          <div className="text-2xs uppercase tracking-[0.12em] text-ink-faint">
                            SHA-256
                          </div>
                          <div className="hash mt-1">{build.sha256}</div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-4">
                  <div className="flex items-start gap-3 border border-signal/30 bg-signal-wash px-3 py-2.5">
                    <div className="min-w-0 text-2xs leading-relaxed">
                      <p className="text-signal">No signed build published yet.</p>
                      <p className="mt-1 text-ink-dim">
                        Rather than link a disk image that does not exist, the
                        console is built from source. The packaging target is
                        configured — one command produces the same{" "}
                        <code className="font-mono text-ink-muted">.dmg</code>.
                      </p>
                    </div>
                  </div>

                  <pre className="mt-4 overflow-x-auto border border-line bg-base p-3 font-mono text-2xs leading-relaxed text-ink-muted">
                    <code>{`git clone <repo> && cd desktop
npm install
npm run dist:mac   # → release/MERIT-${release.version}-arm64.dmg`}</code>
                  </pre>
                </div>
              )}

              <div className="border-t border-line px-4 py-3">
                <dl className="grid grid-cols-2 gap-y-2 text-2xs">
                  {[
                    ["Format", release.format],
                    ["Requires", release.minimumOs],
                    ["Architectures", "Apple Silicon · Intel"],
                    ["Licence cost", "Free — no account needed"],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-ink-faint">{label}</dt>
                      <dd className="mt-0.5 text-ink-muted">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="border-t border-line px-4 py-3 text-2xs leading-relaxed text-ink-faint">
                Windows and Linux builds are not published. The app is
                Electron and the code is cross-platform, but an untested binary
                is a claim like any other.
                {release.notesUrl ? (
                  <a
                    href={release.notesUrl}
                    className="mt-2 flex items-center gap-1.5 text-signal transition-opacity hover:opacity-80"
                  >
                    Release notes <ArrowUpRight size={11} />
                  </a>
                ) : null}
              </div>
            </Panel>

            <p className="mt-3 text-2xs leading-relaxed text-ink-faint">
              The console is a client of the protocol, not a privileged part of
              it. Everything it does is available over the public API, and
              nothing it records is trusted more for having come from it.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
