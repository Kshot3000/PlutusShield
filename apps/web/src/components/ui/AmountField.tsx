"use client";

import { useId } from "react";

/**
 * Number entry that keeps what the user typed (empty, partial) instead of
 * snapping to 0, with a currency suffix, quick-pick chips, and an inline
 * error wired to aria-invalid / aria-describedby.
 */
export function AmountField({
  id,
  label,
  raw,
  onRaw,
  suffix,
  chips,
  error,
  hint,
}: {
  id: string;
  label: string;
  raw: string;
  onRaw: (s: string) => void;
  suffix: string;
  chips?: { label: string; value: number }[];
  error?: string | null;
  hint?: string;
}) {
  const msgId = useId();
  return (
    <div>
      <label className="block text-sm text-text-muted" htmlFor={id}>
        {label}
      </label>
      <div
        className={`mt-1.5 flex h-12 items-center rounded-xl border bg-bg-muted pr-3 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30 ${
          error ? "border-[color-mix(in_srgb,var(--danger)_60%,var(--border))]" : "border-border-strong"
        }`}
      >
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={raw}
          onChange={(e) => onRaw(e.target.value.replace(/[^0-9.,]/g, ""))}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? msgId : undefined}
          className="h-full min-w-0 flex-1 bg-transparent px-3 font-mono text-[15px] text-text outline-none"
        />
        <span className="font-mono text-xs text-text-dim">{suffix}</span>
      </div>
      {chips && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => onRaw(String(c.value))}
              className="rounded-full border border-border px-2.5 py-1 font-mono text-[11px] text-text-muted transition-colors hover:border-border-strong hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      {(error || hint) && (
        <p id={msgId} className={`mt-2 text-[11px] ${error ? "text-[var(--danger)]" : "text-text-dim"}`}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

/** "25,000.5" / "25000" → 25000.5; "" or junk → NaN. */
export const parseAmount = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(/,/g, "")));
