import type { ReactNode } from "react";

type BadgeVariant = "default" | "accent" | "gold" | "cardano" | "midnight";

const variants: Record<BadgeVariant, string> = {
  default:
    "border-[var(--hairline)] bg-white/[0.03] text-text-muted",
  accent:
    "border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[var(--accent-glow)] text-accent-strong",
  gold:
    "border-[color-mix(in_srgb,var(--gold)_35%,transparent)] bg-[var(--gold-soft)] text-gold",
  cardano:
    "border-[color-mix(in_srgb,var(--cardano)_35%,transparent)] bg-[var(--cardano-soft)] text-cardano",
  midnight:
    "border-[color-mix(in_srgb,var(--midnight)_35%,transparent)] bg-[var(--midnight-soft)] text-midnight",
};

export function Badge({
  children,
  variant = "default",
  className = "",
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono-label text-[10px] font-medium backdrop-blur-sm ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
