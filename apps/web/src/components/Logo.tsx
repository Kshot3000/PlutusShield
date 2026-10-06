import Link from "next/link";

export function ShieldMark({ size = 30, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="ps-mark-stroke" x1="4" y1="3" x2="28" y2="29" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8fb0ff" />
          <stop offset="0.5" stopColor="#c5d0ff" />
          <stop offset="1" stopColor="#a78bff" />
        </linearGradient>
        <linearGradient id="ps-mark-fill" x1="16" y1="4" x2="16" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5b84ff" stopOpacity="0.32" />
          <stop offset="1" stopColor="#a78bff" stopOpacity="0.08" />
        </linearGradient>
      </defs>
      <path
        d="M16 3.2l10 4.1v7.2c0 6.3-4.2 11.8-10 13.7C10.2 26.3 6 20.8 6 14.5V7.3l10-4.1z"
        fill="url(#ps-mark-fill)"
        stroke="url(#ps-mark-stroke)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M16 3.2v25" stroke="url(#ps-mark-stroke)" strokeOpacity="0.35" strokeWidth="1" />
      <circle cx="16" cy="14.2" r="2.6" fill="#e4c27a" />
      <path d="M16 16.4v4.2" stroke="#e4c27a" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`group inline-flex items-center gap-2.5 ${className}`}
      aria-label="PlutusShield home"
    >
      <span className="relative transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-105">
        <span
          className="absolute inset-0 rounded-full bg-[var(--accent)] opacity-0 blur-lg transition-opacity duration-500 group-hover:opacity-30"
          aria-hidden="true"
        />
        <ShieldMark className="relative" />
      </span>
      <span className="text-[15.5px] font-semibold tracking-[-0.02em] text-text">
        Plutus<span className="font-display text-[18px] font-normal italic tracking-normal text-accent-strong">Shield</span>
      </span>
    </Link>
  );
}
