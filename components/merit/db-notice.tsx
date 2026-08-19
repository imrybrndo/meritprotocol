import { AlertTriangle } from "lucide-react";
import type { DbState } from "@/lib/services/queries";
import { cn } from "@/lib/utils";

/**
 * Shown when the database is unreachable.
 *
 * The alternative — rendering zeros — would be indistinguishable from a real
 * empty registry, and this product cannot afford ambiguity about whether a
 * number is real.
 */
export function DbNotice({ state, className }: { state: DbState; className?: string }) {
  if (state.connected) return null;

  return (
    <div
      className={cn(
        "flex items-start gap-3 border border-signal/30 bg-signal-wash px-4 py-3",
        className,
      )}
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-signal" />
      <div className="min-w-0 text-xs">
        <p className="text-signal">No database connection.</p>
        <p className="mt-1 leading-relaxed text-ink-dim">
          Nothing on this page is real data — the registry could not be read.
          Set <code className="font-mono text-ink-muted">DATABASE_URL</code> in{" "}
          <code className="font-mono text-ink-muted">.env</code>, then run{" "}
          <code className="font-mono text-ink-muted">npm run db:push</code> and{" "}
          <code className="font-mono text-ink-muted">npm run db:seed</code>.
        </p>
        {state.reason ? (
          <p className="mt-1 font-mono text-2xs text-ink-faint">{state.reason}</p>
        ) : null}
      </div>
    </div>
  );
}
