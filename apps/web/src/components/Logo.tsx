import Link from "next/link";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`group inline-flex items-center gap-2.5 ${className}`}
      aria-label="PlutusShield home"
    >
      <span
        className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--accent)_40%,var(--border))] bg-[var(--accent-glow)] text-accent transition-shadow group-hover:shadow-[0_0_20px_-4px_rgba(61,207,176,0.5)]"
        aria-hidden="true"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 3l7 3.2v5.1c0 4.4-2.9 8.4-7 9.7-4.1-1.3-7-5.3-7-9.7V6.2L12 3z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M9.2 12.1l1.9 1.9 3.7-3.8"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-text">
        Plutus<span className="text-accent">Shield</span>
      </span>
    </Link>
  );
}
