"use client";

import { useMemo, useState } from "react";
import {
  CURRENCIES,
  MIN_PREMIUM,
  USDCX_MAINNET,
  assetId,
  quote,
  PRODUCTS,
  type Currency,
  type ProductId,
  type RiskTier,
} from "@plutusshield/sdk";
import {
  ADA,
  assetTerms,
  chainPremium,
  depegTrigger,
  premiumTerms,
  productTerms,
  textHex,
} from "@plutusshield/sdk/cardano";

// Example pool tranches for the quote preview. Not live capital: each
// currency is its own tranche with its own capital and utilization, exactly
// as the Cardano validator books them. Nothing here is deployed.
const PREVIEW_TRANCHES: Record<Currency, { capital: number; activeCover: number }> = {
  ADA: { capital: 2_500_000, activeCover: 1_150_000 },
  USDC: { capital: 750_000, activeCover: 210_000 },
};

// Preview has no Circle USDCx; the deploy scripts mint a mock tUSDCx and the
// build can expose its policy id. Shown for reference only.
const PREVIEW_USDC_POLICY = process.env.NEXT_PUBLIC_PREVIEW_USDC_POLICY_ID ?? "";

const currencyCopy: Record<Currency, string> = {
  ADA: "Native ada, lovelace on-chain",
  USDC: "USDCx (Circle xReserve), 6 decimals",
};

const tierCopy: Record<RiskTier, string> = {
  A: "Audited, battle-tested, high TVL",
  B: "Audited, moderate history",
  C: "New or partially audited",
};

const fmt = (n: number, d = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

export function QuoteCalculator() {
  const [product, setProduct] = useState<ProductId>("depeg");
  const [coverAmount, setCoverAmount] = useState(25_000);
  const [days, setDays] = useState(90);
  const [riskTier, setRiskTier] = useState<RiskTier>("B");
  const [currency, setCurrency] = useState<Currency>("ADA");
  const cur = CURRENCIES[currency];
  const tranche = PREVIEW_TRANCHES[currency];

  const p = PRODUCTS[product];
  const boundedDays = Math.min(Math.max(days, p.minDays), p.maxDays);
  const result = useMemo(
    () => quote({ product, coverAmount, days: boundedDays, riskTier, pool: tranche, minPremium: MIN_PREMIUM }),
    [product, coverAmount, boundedDays, riskTier, tranche],
  );

  // What a Buy tx would put on-chain: base units in the chosen asset, never
  // below the validator's integer floor for that tranche.
  const onChain = useMemo(() => {
    if (!result.ok || !Number.isFinite(coverAmount) || coverAmount <= 0) return null;
    const asset = currency === "ADA" ? ADA : USDCX_MAINNET;
    const pt = premiumTerms(productTerms(product, riskTier, depegTrigger(textHex("USDM"))), assetTerms(asset, cur.unit));
    const u = cur.unit;
    const base = chainPremium(
      result.premium,
      pt,
      BigInt(Math.round(coverAmount)) * u,
      BigInt(boundedDays),
      BigInt(tranche.capital) * u,
      BigInt(tranche.activeCover) * u,
      u,
    );
    return { base, asset };
  }, [result, coverAmount, currency, cur.unit, product, riskTier, boundedDays, tranche]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div className="glass-panel relative p-6 sm:p-8">
        <p className="font-mono-label text-[10px] text-text-dim">1 · Choose cover</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Cover product">
          {Object.values(PRODUCTS).map((prod) => {
            const active = prod.id === product;
            return (
              <button
                key={prod.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setProduct(prod.id)}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  active
                    ? "border-[color-mix(in_srgb,var(--accent)_55%,var(--border))] bg-[var(--accent-glow)]"
                    : "border-border bg-bg-muted hover:border-border-strong"
                }`}
              >
                <p className="text-sm font-semibold text-text">{prod.name}</p>
                <p className="mt-1 text-xs text-text-dim">{prod.chain}</p>
              </button>
            );
          })}
        </div>

        <p className="mt-8 font-mono-label text-[10px] text-text-dim">2 · Pay and get paid in</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Premium currency">
          {(Object.keys(CURRENCIES) as Currency[]).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === currency}
              onClick={() => setCurrency(c)}
              className={`rounded-lg border px-3 py-2.5 text-left text-xs transition-colors ${
                c === currency
                  ? "border-[color-mix(in_srgb,var(--accent)_55%,var(--border))] bg-[var(--accent-glow)] text-text"
                  : "border-border text-text-muted hover:border-border-strong"
              }`}
            >
              <span className="font-semibold">{CURRENCIES[c].symbol}</span>
              <span className="mt-0.5 block text-text-dim">{currencyCopy[c]}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-text-dim">
          Premium, coverage and payout share one currency. Each currency is a separate pool tranche
          with its own capital and utilization.
        </p>

        <p className="mt-8 font-mono-label text-[10px] text-text-dim">3 · Size and term</p>
        <label className="mt-3 block text-sm text-text-muted" htmlFor="cover-amount">
          Cover amount ({cur.symbol})
        </label>
        <input
          id="cover-amount"
          type="number"
          min={100}
          step={100}
          value={coverAmount}
          onChange={(e) => setCoverAmount(Number(e.target.value))}
          className="mt-1.5 h-11 w-full rounded-lg border border-border-strong bg-bg-muted px-3 font-mono text-text outline-none focus:border-accent"
        />
        <label className="mt-5 flex justify-between text-sm text-text-muted" htmlFor="term">
          <span>Term</span>
          <span className="font-mono text-text">{boundedDays} days</span>
        </label>
        <input
          id="term"
          type="range"
          min={p.minDays}
          max={p.maxDays}
          value={boundedDays}
          onChange={(e) => setDays(Number(e.target.value))}
          className="mt-2 w-full accent-[var(--accent)]"
        />

        <p className="mt-8 font-mono-label text-[10px] text-text-dim">4 · Protocol risk tier</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {(["A", "B", "C"] as RiskTier[]).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={t === riskTier}
              onClick={() => setRiskTier(t)}
              className={`rounded-lg border px-3 py-2.5 text-left text-xs transition-colors ${
                t === riskTier
                  ? "border-[color-mix(in_srgb,var(--accent)_55%,var(--border))] text-text"
                  : "border-border text-text-muted hover:border-border-strong"
              }`}
            >
              <span className="font-semibold">Tier {t}</span>
              <span className="mt-0.5 block text-text-dim">{tierCopy[t]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="glass-panel relative flex flex-col p-6 sm:p-8" aria-live="polite">
        <p className="font-mono-label text-[10px] text-text-dim">Indicative premium</p>
        {result.ok ? (
          <>
            <p className="mt-2 font-display text-5xl tracking-tight text-text">
              {fmt(result.premium)} <span className="text-xl text-text-muted">{cur.symbol}</span>
            </p>
            <p className="mt-1 text-sm text-text-muted">
              {pct(result.annualRate)} annualized · {boundedDays}-day term
            </p>
            <dl className="mt-6 space-y-2.5 border-t border-border pt-5 text-sm">
              {[
                ["Base rate", pct(result.breakdown.baseAnnualRate)],
                ["Risk multiplier", `× ${result.breakdown.riskMultiplier.toFixed(2)}`],
                ["Utilization multiplier", `× ${result.breakdown.utilizationMultiplier.toFixed(3)}`],
                [
                  `${cur.symbol} tranche utilization`,
                  `${pct(result.breakdown.utilizationBefore)} → ${pct(result.breakdown.utilizationAfter)}`,
                ],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-text-dim">{k}</dt>
                  <dd className="font-mono text-text">{v}</dd>
                </div>
              ))}
            </dl>
            {onChain && (
              <div className="mt-5 rounded-lg border border-border bg-bg-muted p-3 text-[11px] leading-relaxed text-text-dim">
                <p>
                  <span className="text-text-muted">On-chain premium:</span>{" "}
                  <span className="font-mono text-text">{onChain.base.toString()}</span>{" "}
                  {currency === "ADA" ? "lovelace" : "base units"}
                </p>
                <p className="mt-1 break-all">
                  <span className="text-text-muted">Asset:</span> <span className="font-mono">{assetId(onChain.asset)}</span>
                  {currency === "USDC" && " (mainnet USDCx)"}
                </p>
                {currency === "USDC" && (
                  <p className="mt-1 break-all">
                    Preview testnet uses a mock tUSDCx
                    {PREVIEW_USDC_POLICY ? (
                      <>
                        : <span className="font-mono">{PREVIEW_USDC_POLICY}.745553444378</span>
                      </>
                    ) : (
                      " minted by the deploy scripts (not published yet)"
                    )}
                    .
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--danger)_40%,var(--border))] p-4 text-sm text-[var(--danger)]">
            {result.reason}
          </p>
        )}
        <div className="mt-6 space-y-2 border-t border-border pt-5 text-xs text-text-dim">
          <p><span className="text-text-muted">Trigger:</span> {p.trigger}</p>
          <p><span className="text-text-muted">Privacy:</span> {p.privacy}</p>
        </div>
        <button
          type="button"
          disabled
          className="mt-8 h-11 w-full rounded-full bg-[linear-gradient(180deg,#ffffff_0%,#dde3f6_100%)] text-sm font-medium text-[var(--text-inverse)] opacity-40"
        >
          Purchase opens on testnet
        </button>
        <p className="mt-3 text-center text-[11px] text-text-dim">
          Preview pricing against an example {cur.symbol} tranche. Model parameters, not live market data.
          Not deployed: no transaction is built or signed.
        </p>
      </div>
    </div>
  );
}
