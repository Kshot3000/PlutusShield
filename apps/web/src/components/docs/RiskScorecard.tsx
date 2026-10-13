"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SCORECARD_CRITERIA, scoreRiskTier, type ScorecardAnswers, type ScorecardProduct } from "@plutusshield/sdk";
import { ChoiceGroup } from "@/components/ui/ChoiceGroup";

const productLabel: Record<ScorecardProduct, string> = {
  exploit: "Smart-contract exploit cover",
  depeg: "Stablecoin depeg cover",
};

/** Interactive underwriting scorecard: answers in, pool tier (or decline) out, via the SDK's scoreRiskTier. */
export function RiskScorecard() {
  const [product, setProduct] = useState<ScorecardProduct>("exploit");
  const [answers, setAnswers] = useState<Record<ScorecardProduct, ScorecardAnswers>>({ exploit: {}, depeg: {} });
  const criteria = SCORECARD_CRITERIA[product];
  const current = answers[product];
  const result = useMemo(() => scoreRiskTier(product, current), [product, current]);
  const answered = criteria.filter((c) => current[c.id]).length;

  const set = (id: string, v: string) => setAnswers((a) => ({ ...a, [product]: { ...a[product], [id]: v } }));

  return (
    <div className="glass-panel relative flex flex-col gap-6 rounded-2xl p-5 sm:p-7">
      <ChoiceGroup<ScorecardProduct>
        name="scorecard-product"
        legend="Product"
        value={product}
        onChange={setProduct}
        className="grid-cols-1 sm:grid-cols-2"
        compact
        options={(["exploit", "depeg"] as ScorecardProduct[]).map((p) => ({ value: p, label: productLabel[p] }))}
      />
      {criteria.map((c, i) => (
        <ChoiceGroup<string>
          key={`${product}-${c.id}`}
          name={`scorecard-${product}-${c.id}`}
          legend={`${i + 1} · ${c.label}`}
          value={current[c.id] ?? ""}
          onChange={(v) => set(c.id, v)}
          className={c.options.length > 3 ? "grid-cols-2 sm:grid-cols-4" : c.options.length === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2"}
          compact
          options={c.options.map((o) => ({
            value: o.value,
            label: o.label,
            hint: o.hardStop ? "Declines cover" : o.cap ? `Caps at tier ${o.cap.tier}` : `${o.points} pt${o.points === 1 ? "" : "s"}`,
          }))}
        />
      ))}

      <div aria-live="polite" className="rounded-xl border border-border bg-bg-muted/60 p-4 sm:p-5">
        {!result.ok && !result.declined ? (
          <p className="text-sm text-text-muted">
            Answer every question to see the tier ({answered} of {criteria.length} answered).
          </p>
        ) : !result.ok ? (
          <>
            <p className="font-mono-label text-[10px] text-[var(--danger)]">Declined</p>
            <p className="mt-2 font-display text-2xl text-text">Not insurable at any tier</p>
            <ul className="mt-3 list-disc pl-5 text-sm text-text-muted">
              {result.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="font-mono-label text-[10px] text-text-dim">Pool tier</p>
            <p className="mt-2 font-display text-4xl tracking-tight text-text">
              Tier {result.tier}{" "}
              <span className="text-lg text-text-muted">
                {result.riskMultiplier.toFixed(1)}× · risk_mult_bps {result.riskMultBps.toLocaleString("en-US")}
              </span>
            </p>
            <p className="mt-1 text-sm text-text-muted">
              {result.points} of {result.maxPoints} points ({Math.round(result.share * 100)}%)
              {result.uncappedTier !== result.tier ? `, which alone would be tier ${result.uncappedTier}` : ""}.
            </p>
            {result.caps.length ? (
              <ul className="mt-3 list-disc pl-5 text-sm text-text-muted">
                {result.caps.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : null}
            <p className="mt-4 text-sm">
              <Link href="/cover/" className="text-accent-strong underline underline-offset-[3px] hover:text-text">
                Price cover at tier {result.tier} on /cover
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
