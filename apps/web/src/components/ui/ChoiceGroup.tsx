"use client";

import type { ReactNode } from "react";

export interface ChoiceOption<T extends string> {
  value: T;
  label: ReactNode;
  hint?: ReactNode;
  /** Small chip on the right (e.g. "On-chain first", "Model only"). */
  tag?: ReactNode;
  /** Leading glyph (e.g. a currency mark). */
  icon?: ReactNode;
}

/**
 * A card-style radio group built on native radio inputs, so arrow keys, Tab,
 * and screen readers behave exactly like a standard radio group. The legend
 * doubles as the visible step label.
 */
export function ChoiceGroup<T extends string>({
  name,
  legend,
  value,
  onChange,
  options,
  className = "grid-cols-1 sm:grid-cols-3",
  compact = false,
}: {
  name: string;
  legend: ReactNode;
  value: T;
  onChange: (v: T) => void;
  options: ChoiceOption<T>[];
  className?: string;
  compact?: boolean;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="font-mono-label text-[10px] text-text-dim">{legend}</legend>
      <div className={`mt-3 grid gap-2 ${className}`}>
        {options.map((o) => {
          const checked = o.value === value;
          return (
            <label
              key={o.value}
              className={`group relative flex cursor-pointer items-start gap-3 rounded-xl border text-left transition-[border-color,background-color,box-shadow] duration-300 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-bg ${
                compact ? "px-3 py-2.5" : "p-4"
              } ${
                checked
                  ? "border-[color-mix(in_srgb,var(--accent)_55%,var(--border))] bg-[var(--accent-glow)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_18%,transparent)_inset]"
                  : "border-border bg-bg-muted/60 hover:border-border-strong hover:bg-white/[0.02]"
              }`}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={checked}
                onChange={() => onChange(o.value)}
                className="sr-only"
              />
              {o.icon && <span className="mt-0.5 hidden shrink-0 sm:block" aria-hidden="true">{o.icon}</span>}
              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-2">
                  <span className={`font-semibold text-text ${compact ? "text-xs" : "text-sm"}`}>{o.label}</span>
                  {o.tag}
                </span>
                {o.hint && (
                  <span className={`mt-0.5 block text-text-dim ${compact ? "text-[11px]" : "text-xs"}`}>{o.hint}</span>
                )}
              </span>
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                  checked ? "border-accent" : "border-border-strong"
                }`}
                aria-hidden="true"
              >
                <span className={`h-2 w-2 rounded-full bg-accent transition-transform duration-300 ${checked ? "scale-100" : "scale-0"}`} />
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Tiny pill used as a ChoiceGroup tag. */
export function Chip({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "accent" | "gold" }) {
  const tones = {
    default: "border-[var(--hairline)] text-text-dim",
    accent: "border-[color-mix(in_srgb,var(--accent)_40%,transparent)] text-accent-strong",
    gold: "border-[color-mix(in_srgb,var(--gold)_40%,transparent)] text-gold",
  };
  return (
    <span className={`shrink-0 whitespace-nowrap rounded-full border px-1.5 py-0.5 font-mono-label text-[8.5px] ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Currency glyphs for ADA / USDC choices. */
export function CurrencyMark({ currency }: { currency: "ADA" | "USDC" }) {
  return currency === "ADA" ? (
    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--cardano)_40%,transparent)] bg-[var(--cardano-soft)] font-mono text-[13px] text-cardano">
      ₳
    </span>
  ) : (
    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[color-mix(in_srgb,#3e8bff_40%,transparent)] bg-[rgba(62,139,255,0.12)] font-mono text-[13px] text-[#8fb8ff]">
      $
    </span>
  );
}
