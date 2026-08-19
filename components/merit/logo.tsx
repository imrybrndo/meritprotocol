/**
 * MERIT mark: a Merkle tree reduced to its essential shape — four leaves
 * folding into two nodes into one root. It is the product diagram, not
 * decoration.
 */
export function MeritMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      {/* edges */}
      <path
        d="M3 16.5 6.5 11M10 16.5 6.5 11M6.5 11 10 5.5M13.5 11 10 5.5M13.5 11 10 16.5M13.5 11 17 16.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeOpacity="0.45"
        strokeLinecap="round"
      />
      {/* leaves */}
      <circle cx="3" cy="16.5" r="1.5" fill="currentColor" fillOpacity="0.55" />
      <circle cx="10" cy="16.5" r="1.5" fill="currentColor" fillOpacity="0.55" />
      <circle cx="17" cy="16.5" r="1.5" fill="currentColor" fillOpacity="0.55" />
      {/* internal nodes */}
      <circle cx="6.5" cy="11" r="1.6" fill="currentColor" fillOpacity="0.8" />
      <circle cx="13.5" cy="11" r="1.6" fill="currentColor" fillOpacity="0.8" />
      {/* root */}
      <circle cx="10" cy="5.5" r="2.1" fill="currentColor" />
    </svg>
  );
}

export function MeritWordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="font-semibold tracking-[0.02em]">MERIT</span>
    </span>
  );
}
