export function BrandMark() {
  return (
    <svg width="25" height="25" viewBox="0 0 25 25" fill="none" aria-hidden="true">
      <defs>
        <clipPath id="vantage-disc">
          <circle cx="12.5" cy="12.5" r="12.5" />
        </clipPath>
      </defs>
      <g clipPath="url(#vantage-disc)">
        <rect width="25" height="25" fill="#ededed" />
        <path d="M12.5 1.5 23.5 12.5 12.5 23.5 1.5 12.5Z" fill="#050606" />
        <path d="M12.5 1.5 23.5 12.5 12.5 12.5Z" fill="#737778" />
        <path d="M12.5 12.5 23.5 12.5 12.5 23.5Z" fill="#fafafa" />
        <path d="M12.5 1.5 12.5 12.5 1.5 12.5Z" fill="#0a0b0b" />
      </g>
    </svg>
  );
}

export function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M3.4 10.6 10.6 3.4"
        stroke="#fff"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M5.1 3.4h5.5v5.5"
        stroke="#fff"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg viewBox="0 0 12 14" fill="none" aria-hidden="true">
      <path d="M1.4 1.2 11 7 1.4 12.8Z" fill="#fff" />
    </svg>
  );
}

export function MenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <rect className="bar bar-top" x="4" y="7.65" width="14" height="1.7" rx="0.85" />
      <rect
        className="bar bar-bottom"
        x="4"
        y="12.65"
        width="14"
        height="1.7"
        rx="0.85"
      />
    </svg>
  );
}
