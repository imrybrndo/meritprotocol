"use client";

import { useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { VerificationReport } from "@/components/merit/verification-report";
import type { VerificationResult } from "@/lib/services/verification";

/**
 * Verification input.
 *
 * Hits the same public, unauthenticated endpoint a third party would use — the
 * page has no privileged path of its own.
 */
export function VerifyForm({ initialQuery }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;

    startTransition(async () => {
      setError(null);
      try {
        const response = await fetch("/api/v1/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: query.trim(), type: "auto" }),
        });
        const body = await response.json();

        if (!response.ok) {
          setResult(null);
          setError(body?.error?.message ?? "Verification request failed.");
          return;
        }
        setResult(body.data as VerificationResult);
      } catch (cause) {
        setResult(null);
        setError((cause as Error).message);
      }
    });
  };

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Decision ID, commitment hash, or anchor transaction hash"
            className="h-11 w-full rounded-[3px] border border-line-strong bg-surface pl-9 pr-3 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-signal focus:outline-none"
            spellCheck={false}
          />
        </div>
        <Button type="submit" variant="primary" size="lg" disabled={pending || !query.trim()}>
          {pending ? <Loader2 size={14} className="animate-spin" /> : null}
          Verify
        </Button>
      </form>

      {error ? (
        <div className="border border-loss/40 bg-loss-wash px-4 py-3 text-xs text-loss">
          {error}
        </div>
      ) : null}

      {result ? <VerificationReport result={result} /> : null}
    </div>
  );
}
