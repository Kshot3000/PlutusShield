"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  MAX_SINGLE_POLICY_SHARE,
  MAX_UTILIZATION,
  MIN_PREMIUM,
  PRODUCTS,
  planCover,
  type Exposure,
  type ExposureStatus,
  type ProductId,
} from "@plutusshield/sdk";
import { Badge } from "@/components/ui/Badge";
import { ChoiceGroup, CurrencyMark } from "@/components/ui/ChoiceGroup";
import { PLANNER_POOLS, PLANNER_SNAPSHOT_AT, type PlannerCurrency } from "@/lib/coverPlanner";

interface Row {
  id: string;
  label: string;
  product: ProductId;
  amount: string;
  protectPct: number;
}

const PRESETS: { id: string; label: string; rows: Omit<Row, "id">[] }[] = [
  {
    id: "stable",
    label: "Stablecoin saver",
    rows: [{ label: "USDM in wallet", product: "depeg", amount: "400", protectPct: 100 }],
  },
  {
    id: "lp",
    label: "LP + lender",
    rows: [
      { label: "USDM in a DEX pool", product: "depeg", amount: "250", protectPct: 100 },
      { label: "DEX LP position", product: "exploit", amount: "300", protectPct: 80 },
      { label: "Lending deposit", product: "exploit", amount: "200", protectPct: 50 },
    ],
  },
  {
    id: "whale",
    label: "Larger book",
    rows: [
      { label: "Treasury USDM", product: "depeg", amount: "5000", protectPct: 100 },
      { label: "Vault strategy", product: "exploit", amount: "3000", protectPct: 100 },
      { label: "DEX uptime", product: "sla", amount: "500", protectPct: 100 },
    ],
  },
];

const TERMS = [30, 90, 180, 365];
const PROTECT = [25, 50, 80, 100];

let seq = 0;
const withIds = (rows: Omit<Row, "id">[]): Row[] => rows.map((r) => ({ ...r, id: `x${++seq}` }));

const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

const statusView: Record<ExposureStatus, { label: string; variant: "gold" | "accent" | "default" | "cardano" }> = {
  covered: { label: "Covered", variant: "gold" },
  partial: { label: "Partly covered", variant: "accent" },
  "not-buyable": { label: "Not for sale", variant: "default" },
  "no-capacity": { label: "No capacity", variant: "default" },
  invalid: { label: "Check inputs", variant: "default" },
};

const fieldCls =
  "h-10 w-full rounded-lg border border-border-strong bg-bg-muted px-3 text-[13.5px] text-text outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30";

export function CoverPlanner() {
  const [currency, setCurrency] = useState<PlannerCurrency>("ADA");
  const [days, setDays] = useState(90);
  const [rows, setRows] = useState<Row[]>(() => withIds(PRESETS[1].rows));
  const pools = PLANNER_POOLS[currency];
  const unit = currency === "ADA" ? "tADA" : "tUSDCx";

  const plan = useMemo(() => {
    const exposures: Exposure[] = rows.map((r) => ({
      id: r.id,
      label: r.label || "Unnamed exposure",
      product: r.product,
      amount: Number(r.amount.replace(/,/g, "")) || 0,
      protectShare: r.protectPct / 100,
    }));
    return planCover({ exposures, days, riskTier: "B", pools: { depeg: pools.depeg, exploit: pools.exploit, sla: null } });
  }, [rows, days, pools]);

  const update = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const t = plan.totals;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <section className="card-surface p-5 sm:p-7" aria-labelledby="plan-inputs">
        <h2 id="plan-inputs" className="font-display text-xl text-text">Your exposures</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-text-muted">
          List what you hold at risk. Amounts are in the currency you would pay the premium in and be paid out in.
        </p>

        <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Example portfolios">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setRows(withIds(p.rows))}
              className="rounded-full border border-border px-3 py-1 font-mono text-[11px] text-text-muted transition-colors hover:border-border-strong hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <ChoiceGroup
            name="plan-currency"
            legend="Pool currency"
            value={currency}
            onChange={setCurrency}
            className="grid-cols-2"
            compact
            options={(["ADA", "USDC"] as const).map((c) => ({
              value: c,
              label: c === "ADA" ? "tADA" : "tUSDCx",
              icon: <CurrencyMark currency={c} />,
            }))}
          />
          <fieldset>
            <legend className="font-mono-label text-[10px] text-text-dim">Term</legend>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {TERMS.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={days === d}
                  onClick={() => setDays(d)}
                  className={`h-9 rounded-lg border px-3 font-mono text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    days === d ? "border-accent bg-[var(--accent-glow)] text-text" : "border-border text-text-muted hover:text-text"
                  }`}
                >
                  {d} days
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <ul className="mt-6 space-y-3">
          {rows.map((r, i) => (
            <li key={r.id} className="rounded-xl border border-border bg-white/[0.02] p-3">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                <label className="block">
                  <span className="sr-only">Exposure {i + 1} name</span>
                  <input className={fieldCls} value={r.label} onChange={(e) => update(r.id, { label: e.target.value })} placeholder="What is at risk" />
                </label>
                <label className="block">
                  <span className="sr-only">Exposure {i + 1} cover type</span>
                  <select className={fieldCls} value={r.product} onChange={(e) => update(r.id, { product: e.target.value as ProductId })}>
                    <option value="depeg">Depeg cover (USDM)</option>
                    <option value="exploit">Exploit cover</option>
                    <option value="sla">SLA cover (not for sale)</option>
                  </select>
                </label>
              </div>
              <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
                <label className="flex h-10 items-center rounded-lg border border-border-strong bg-bg-muted pr-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30">
                  <span className="sr-only">Exposure {i + 1} amount</span>
                  <input
                    inputMode="decimal"
                    autoComplete="off"
                    value={r.amount}
                    onChange={(e) => update(r.id, { amount: e.target.value.replace(/[^0-9.,]/g, "") })}
                    className="h-full min-w-0 flex-1 bg-transparent px-3 font-mono text-[13.5px] text-text outline-none"
                  />
                  <span className="font-mono text-[11px] text-text-dim">{unit}</span>
                </label>
                <label className="block">
                  <span className="sr-only">Share of exposure {i + 1} to protect</span>
                  <select
                    className={`${fieldCls} w-auto`}
                    value={r.protectPct}
                    onChange={(e) => update(r.id, { protectPct: Number(e.target.value) })}
                  >
                    {PROTECT.map((p) => (
                      <option key={p} value={p}>
                        Protect {p}%
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                  className="h-10 rounded-lg border border-border px-3 text-[12px] text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-label={`Remove ${r.label || `exposure ${i + 1}`}`}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
        {rows.length < 8 && (
          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, ...withIds([{ label: "", product: "exploit", amount: "100", protectPct: 100 }])])}
            className="mt-3 rounded-lg border border-dashed border-border px-4 py-2 text-[13px] text-text-muted hover:border-border-strong hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Add exposure
          </button>
        )}
      </section>

      <section className="card-surface p-5 sm:p-7" aria-labelledby="plan-result" aria-live="polite">
        <div className="flex flex-wrap gap-2">
          <Badge variant="gold">Live Preview tranches</Badge>
          <Badge>Tier B</Badge>
          <Badge>Model, not an offer</Badge>
        </div>
        <h2 id="plan-result" className="mt-4 font-display text-xl text-text">Your cover plan</h2>
        {!plan.ok ? (
          <p className="mt-3 text-sm text-text-muted">{plan.reason}</p>
        ) : (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-3">
              {[
                ["Protected", `${fmt(t.covered)} ${unit}`],
                ["Premium", `${fmt(t.premium)} ${unit}`],
                ["Coverage", pct(t.coverageRatio, 0)],
                ["Effective rate", t.covered > 0 ? `${pct(t.effectiveAnnualRate, 2)} / yr` : "—"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-border bg-white/[0.02] px-4 py-3">
                  <dt className="font-mono-label text-[9.5px] text-text-dim">{k}</dt>
                  <dd className="mt-1 font-mono text-[15px] text-text">{v}</dd>
                </div>
              ))}
            </dl>
            {t.uncovered > 0 && (
              <p className="mt-3 text-[13px] leading-relaxed text-text-muted">
                {fmt(t.uncovered)} {unit} of what you asked to protect stays uncovered. The plan never hides it.
              </p>
            )}

            {plan.policies.some((p) => p.premium <= MIN_PREMIUM) && (
              <p className="mt-2 text-[12.5px] leading-relaxed text-text-dim">
                Every policy pays at least the {MIN_PREMIUM} {unit} premium floor. Today&apos;s Preview pools are small, so a split
                into several floor-priced policies costs more than the annual rate alone suggests.
              </p>
            )}

            <ol className="mt-5 space-y-3">
              {plan.exposures.map((e) => {
                const s = statusView[e.status];
                const product = PRODUCTS[e.exposure.product];
                return (
                  <li key={e.exposure.id} className="rounded-xl border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-text">{e.exposure.label}</p>
                        <p className="text-[12px] text-text-dim">{product.name}</p>
                      </div>
                      <Badge variant={s.variant}>{s.label}</Badge>
                    </div>
                    <p className="mt-2 font-mono text-[12px] text-text-muted">
                      {fmt(e.covered)} of {fmt(e.target)} {unit} · premium {fmt(e.premium)} {unit}
                    </p>
                    {e.note && <p className="mt-1 text-[12px] leading-snug text-text-dim">{e.note}</p>}
                    {e.policies.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {e.policies.map((p, j) => (
                          <li key={j} className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-text-muted">
                            <span className="font-mono">
                              Policy {j + 1}: {fmt(p.coverAmount)} {unit} cover, {fmt(p.premium)} premium, {pct(p.annualRate, 2)}/yr
                            </span>
                            {product.buy && (
                              <Link href={product.buy.href} className="text-text underline underline-offset-4 hover:text-cardano">
                                Buy
                              </Link>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}
        <p className="mt-5 text-[11.5px] leading-relaxed text-text-dim">
          Priced by the same quote engine as /cover against the live {unit} tranches
          {PLANNER_SNAPSHOT_AT ? ` (pool snapshot ${new Date(PLANNER_SNAPSHOT_AT).toISOString().slice(0, 16).replace("T", " ")} UTC)` : ""}
          . One policy can take at most {MAX_SINGLE_POLICY_SHARE * 100}% of a tranche&apos;s capital and nothing is planned past{" "}
          {MAX_UTILIZATION * 100}% utilization, so larger exposures split into several policies and each one prices higher than the
          last. Your wallet buys each policy separately on /cover, where the validator&apos;s exact premium applies. Testnet only, not
          audited.
        </p>
      </section>
    </div>
  );
}
