import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Shorten a hash for display: 0x8a91c2…4f7b. */
export function truncateHash(value: string | null | undefined, lead = 10, tail = 6): string {
  if (!value) return "—";
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

export function formatPercent(value: number, digits = 1): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

/** Percentages that are magnitudes, not changes — no leading plus sign. */
export function formatRate(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatUsd(value: number, digits = 2): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function formatSignedUsd(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : "−"}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function formatCompact(value: number): string {
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

export function formatRatio(value: number | null, digits = 2): string {
  return value === null ? "—" : value.toFixed(digits);
}

export function formatDateTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export function formatDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}

export function formatDuration(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.round(ms / 60_000)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}
