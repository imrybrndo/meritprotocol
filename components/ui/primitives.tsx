import { cva, type VariantProps } from "class-variance-authority";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------- panel */

/**
 * The base container. Everything in MERIT sits inside a bordered panel — the
 * layout is drawn with hairlines rather than shadows or blur.
 */
export function Panel({
  className,
  children,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "border border-line bg-surface rounded-[--radius-panel]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  meta,
  className,
}: {
  title: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 border-b border-line px-4 py-2.5",
        className,
      )}
    >
      <h2 className="text-2xs font-medium uppercase tracking-[0.14em] text-ink-muted">
        {title}
      </h2>
      {meta ? <div className="text-2xs text-ink-dim">{meta}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------- button */

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[3px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 whitespace-nowrap",
  {
    variants: {
      variant: {
        primary: "bg-signal text-[#0a0b0d] hover:bg-[#ffc44d]",
        outline:
          "border border-line-strong text-ink hover:border-ink-dim hover:bg-raised",
        ghost: "text-ink-muted hover:text-ink hover:bg-raised",
        danger: "border border-loss/40 text-loss hover:bg-loss-wash",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-9 px-4 text-sm",
        lg: "h-11 px-6 text-sm",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}

export function ButtonLink({
  className,
  variant,
  size,
  ...props
}: ComponentProps<typeof Link> & VariantProps<typeof buttonVariants>) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

/* -------------------------------------------------------------------- badge */

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-0.5 text-2xs font-medium uppercase tracking-[0.08em] whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-line-strong bg-raised text-ink-muted",
        signal: "border-signal/35 bg-signal-wash text-signal",
        profit: "border-profit/30 bg-profit-wash text-profit",
        loss: "border-loss/30 bg-loss-wash text-loss",
        info: "border-info/30 bg-info-wash text-info",
        /* Demo data must be unmistakable wherever it appears. */
        demo: "border-dashed border-ink-faint bg-transparent text-ink-dim",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/* --------------------------------------------------------------------- stat */

export function Stat({
  label,
  value,
  hint,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "profit" | "loss" | "signal";
  className?: string;
}) {
  return (
    <div className={cn("px-4 py-3", className)}>
      <div className="text-2xs uppercase tracking-[0.12em] text-ink-dim">{label}</div>
      <div
        className={cn(
          "mt-1 font-mono text-lg leading-tight",
          tone === "profit" && "text-profit",
          tone === "loss" && "text-loss",
          tone === "signal" && "text-signal",
          tone === "default" && "text-ink",
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-2xs text-ink-faint">{hint}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------- tables */

export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "border-b border-line px-4 py-2 text-left text-2xs font-medium uppercase tracking-[0.12em] text-ink-dim",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return (
    <td className={cn("border-b border-line/60 px-4 py-2.5 align-middle", className)} {...props} />
  );
}

/* ------------------------------------------------------------------ metrics */

/** Horizontal 0-100 meter used for reputation components. */
export function Meter({
  value,
  max = 100,
  tone = "signal",
}: {
  value: number;
  max?: number;
  tone?: "signal" | "profit" | "loss" | "neutral";
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className="h-1 w-full overflow-hidden rounded-full bg-overlay"
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div
        className={cn(
          "h-full rounded-full",
          tone === "signal" && "bg-signal",
          tone === "profit" && "bg-profit",
          tone === "loss" && "bg-loss",
          tone === "neutral" && "bg-ink-faint",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Section eyebrow used across the landing page and docs. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-2xs font-medium uppercase tracking-[0.18em] text-ink-dim">
      <span className="h-px w-6 bg-line-strong" />
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <p className="text-sm text-ink">{title}</p>
      <p className="max-w-md text-xs text-ink-dim">{description}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
