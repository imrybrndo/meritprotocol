/**
 * MERIT mark: a Merkle tree reduced to its essential shape — four leaves
 * folding into two nodes into one root. It is the product diagram, not
 * decoration.
 *
 * The nodes carry the same gold as the desktop app icon, which is a render of
 * this exact shape. Drawn rather than served as an image on purpose: at the
 * 17-19px it appears at in the header and footer, a 3D render turns to mush,
 * while the vector stays legible and needs no second file to keep in step.
 *
 * `gradientId` exists because two marks on one page would otherwise define the
 * same id twice; callers that render more than one pass distinct values.
 */
export function MeritMark({
  size = 20,
  gradientId = "merit-mark-gold",
}: {
  size?: number;
  gradientId?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <defs>
        <linearGradient id={gradientId} x1="4" y1="3" x2="16" y2="18" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFD34D" />
          <stop offset="0.55" stopColor="#F0B429" />
          <stop offset="1" stopColor="#C98A12" />
        </linearGradient>
      </defs>
      {/* edges */}
      <path
        d="M3 16.5 6.5 11M10 16.5 6.5 11M6.5 11 10 5.5M13.5 11 10 5.5M13.5 11 10 16.5M13.5 11 17 16.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeOpacity="0.45"
        strokeLinecap="round"
      />
      {/* leaves */}
      <circle cx="3" cy="16.5" r="1.5" fill={`url(#${gradientId})`} fillOpacity="0.75" />
      <circle cx="10" cy="16.5" r="1.5" fill={`url(#${gradientId})`} fillOpacity="0.75" />
      <circle cx="17" cy="16.5" r="1.5" fill={`url(#${gradientId})`} fillOpacity="0.75" />
      {/* internal nodes */}
      <circle cx="6.5" cy="11" r="1.6" fill={`url(#${gradientId})`} fillOpacity="0.9" />
      <circle cx="13.5" cy="11" r="1.6" fill={`url(#${gradientId})`} fillOpacity="0.9" />
      {/* root */}
      <circle cx="10" cy="5.5" r="2.1" fill={`url(#${gradientId})`} />
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
