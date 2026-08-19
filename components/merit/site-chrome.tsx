"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MeritMark } from "./logo";

/**
 * X publishes no mark in lucide, and the glyph is a letterform rather than an
 * icon — so it is drawn here at the same 24-unit grid as everything else in the
 * set, and inherits colour the same way.
 */
function XMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

const SOCIALS = [{ href: "https://x.com/meritproto", label: "MERIT on X", icon: <XMark /> }] as const;

const NAV = [
  { href: "/agents", label: "Agents" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/verify", label: "Verify" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/docs", label: "Docs" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-base/85 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-signal transition-opacity hover:opacity-80"
        >
          <MeritMark size={19} gradientId="mark-header" />
          <span className="text-sm font-semibold tracking-[0.06em] text-ink">MERIT</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-[3px] px-2.5 py-1.5 text-xs transition-colors",
                isActive(item.href)
                  ? "text-ink"
                  : "text-ink-dim hover:text-ink-muted",
              )}
            >
              {item.label}
              {isActive(item.href) ? (
                <span className="mt-1 block h-px bg-signal" />
              ) : null}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/verify"
            className="hidden rounded-[3px] border border-line-strong px-3 py-1.5 text-xs text-ink transition-colors hover:border-ink-dim sm:block"
          >
            Verify a trade
          </Link>
          <button
            type="button"
            className="rounded-[3px] border border-line-strong p-1.5 text-ink-muted md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </div>

      {open ? (
        <nav className="border-t border-line bg-surface px-4 py-2 md:hidden">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                "block px-2 py-2 text-sm",
                isActive(item.href) ? "text-signal" : "text-ink-muted",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-2 text-signal">
              <MeritMark size={17} gradientId="mark-footer" />
              <span className="text-xs font-semibold tracking-[0.06em] text-ink">
                MERIT
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ink-dim">
              The verifiable reputation layer for autonomous agents.
            </p>

            <div className="mt-4 flex items-center gap-2">
              {SOCIALS.map((social) => (
                <a
                  key={social.href}
                  href={social.href}
                  target="_blank"
                  // noreferrer alongside noopener: the tab opened here should
                  // carry neither a handle back to this window nor where it
                  // came from.
                  rel="noopener noreferrer"
                  aria-label={social.label}
                  title={social.label}
                  className="flex h-8 w-8 items-center justify-center rounded-[3px] border border-line-strong text-ink-dim transition-colors hover:border-ink-dim hover:text-ink"
                >
                  {social.icon}
                </a>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-10 gap-y-1 text-xs sm:grid-cols-3">
            {[
              ["Protocol", [["Agents", "/agents"], ["Leaderboard", "/leaderboard"], ["Verify", "/verify"]]],
              ["Build", [["Docs", "/docs"], ["API", "/docs/api"], ["SDK", "/docs/sdk"]]],
              ["Understand", [["MERIT Score", "/docs/merit-score"], ["Proof layer", "/docs/decision-proof"], ["Limits of proof", "/docs/security"]]],
            ].map(([heading, links]) => (
              <div key={heading as string}>
                <div className="mb-1.5 text-2xs uppercase tracking-[0.14em] text-ink-faint">
                  {heading as string}
                </div>
                {(links as string[][]).map(([label, href]) => (
                  <Link
                    key={href}
                    href={href}
                    className="block py-0.5 text-ink-dim transition-colors hover:text-ink"
                  >
                    {label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* The scope disclaimer is permanent chrome, not a page-level footnote. */}
        <p className="mt-8 border-t border-line pt-4 text-2xs leading-relaxed text-ink-faint">
          Cryptographic provenance proves the integrity and chronology of records
          registered with MERIT. It does not prove that external market data was
          truthful, that unregistered activity did not occur, or that any strategy
          will remain profitable. Verified history is not a forecast.
        </p>
      </div>
    </footer>
  );
}
