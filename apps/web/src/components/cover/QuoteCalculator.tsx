"use client";

import { useMemo, useRef, useState } from "react";
import {
  CURRENCIES,
  MAX_SINGLE_POLICY_SHARE,
  MAX_UTILIZATION,
  MIN_PREMIUM,
  USDCX_MAINNET,
  assetId,
  quote,
  PRODUCTS,
  type Currency,
  type ProductId,
  type RiskTier,
} from "@plutusshield/sdk";
import { ADA, assetTerms, chainPremium, depegTrigger, premiumTerms, productTerms, textHex } from "@plutusshield/sdk/cardano";
import { ChoiceGroup, Chip, CurrencyMark } from "@/components/ui/ChoiceGroup";
import { AmountField, parseAmount } from "@/components/ui/AmountField";
import { PreviewFlow } from "@/components/PreviewFlow";
import { SALE_GUARD } from "@/lib/status";
import { useInView } from "@/lib/useInView";

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
  ADA: "Paid out in ADA",
  USDC: "Paid out in USDCx",
};

const tierCopy: Record<RiskTier, string> = {
  A: "Audited, battle-tested, high TVL",
  B: "Audited, moderate history",
  C: "New or partially audited",
};

const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

export function QuoteCalculator() {
  const [product, setProduct] = useState<ProductId>("depeg");
  const [rawAmount, setRawAmount] = useState("25000");
  const [days, setDays] = useState(90);
  const [riskTier, setRiskTier] = useState<RiskTier>("B");
  const [currency, setCurrency] = useState<Currency>("ADA");
  const resultRef = useRef<HTMLDivElement>(null);
  const resultInView = useInView(resultRef);

  const cur = CURRENCIES[currency];
  const tranche = PREVIEW_TRANCHES[currency];
  const p = PRODUCTS[product];
  const onChainProduct = product === "depeg";
  const coverAmount = parseAmount(rawAmount);
  const boundedDays = Math.min(Math.max(days, p.minDays), p.maxDays);

  const maxSingle = tranche.capital * MAX_SINGLE_POLICY_SHARE;
  const capacityLeft = Math.max(0, tranche.capital * MAX_UTILIZATION - tranche.activeCover);
  const maxCover = Math.min(maxSingle, capacityLeft);

  const amountError = !Number.isFinite(coverAmount)
    ? "Enter a cover amount."
    : coverAmount <= 0
      ? "Cover amount must be more than zero."
      : coverAmount > maxCover
        ? `Max for one policy in this ${cur.symbol} tranche is ${fmt(maxCover, 0)} ${cur.symbol} (${
            maxSingle <= capacityLeft ? "10% of its capital" : "capacity left under the 90% utilization cap"
          }).`
        : null;

  const result = useMemo(
    () => quote({ product, coverAmount, days: boundedDays, riskTier, pool: tranche, minPremium: MIN_PREMIUM }),
    [product, coverAmount, boundedDays, riskTier, tranche],
  );

  // What a Buy tx would put on-chain: base units in the chosen asset, never
  // below the validator's integer floor for that tranche. Depeg only: it is
  // the one product with a deployed-ready validator.
  const onChain = useMemo(() => {
    if (!onChainProduct || !result.ok || !Number.isFinite(coverAmount) || coverAmount <= 0) return null;
    const asset = currency === "ADA" ? ADA : USDCX_MAINNET;
    const u = cur.unit;
    const pt = premiumTerms(productTerms(product, riskTier, depegTrigger(textHex("USDM"))), assetTerms(asset, u));
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
  }, [onChainProduct, result, coverAmount, currency, cur.unit, product, riskTier, boundedDays, tranche]);

  const amountChips = [
    { label: "5k", value: 5_000 },
    { label: "25k", value: 25_000 },
    { label: "50k", value: 50_000 },
    { label: "Max", value: Math.floor(maxCover) },
  ];
  const termChips = [14, 30, 90, 180, 365].filter((d) => d >= p.minDays && d <= p.maxDays);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 pb-20 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:pb-0">
      <div className="glass-panel relative space-y-8 p-5 sm:p-8">
        <ChoiceGroup<ProductId>
          name="product"
          legend="1 · Choose cover"
          value={product}
          onChange={setProduct}
          className="grid-cols-1"
          options={Object.values(PRODUCTS).map((prod) => ({
            value: prod.id,
            label: prod.name,
            hint: prod.chain,
            tag: prod.id === "depeg" ? <Chip tone="accent">On-chain first</Chip> : <Chip>Model only</Chip>,
          }))}
        />

        <div>
          <ChoiceGroup<Currency>
            name="currency"
            legend="2 · Pay and get paid in"
            value={currency}
            onChange={setCurrency}
            className="grid-cols-2"
            options={(Object.keys(CURRENCIES) as Currency[]).map((c) => ({
              value: c,
              label: CURRENCIES[c].symbol,
              hint: currencyCopy[c],
              icon: <CurrencyMark currency={c} />,
            }))}
          />
          <dl className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--hairline)] text-[11px]">
            {[
              ["Tranche capital", `${fmt(tranche.capital, 0)}`],
              ["Utilization", pct(tranche.activeCover / tranche.capital)],
              ["Max per policy", `${fmt(maxCover, 0)}`],
            ].map(([k, v]) => (
              <div key={k} className="bg-bg-muted px-3 py-2.5">
                <dt className="text-text-dim">{k}</dt>
                <dd className="mt-0.5 font-mono text-text">
                  {v} {k !== "Utilization" && <span className="text-text-dim">{cur.symbol}</span>}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[11px] leading-relaxed text-text-dim">
            Premium, coverage, and payout all use one currency. Each currency is a separate tranche with its own
            capital, so a USDC claim can never touch ADA capital (and the reverse). Example tranche, not live.
          </p>
        </div>

        <fieldset className="min-w-0">
          <legend className="font-mono-label text-[10px] text-text-dim">3 · Size and term</legend>
          <div className="mt-3">
            <AmountField
              id="cover-amount"
              label={`Cover amount (${cur.symbol})`}
              raw={rawAmount}
              onRaw={setRawAmount}
              suffix={cur.symbol}
              chips={amountChips}
              error={amountError}
            />
          </div>
          <label className="mt-6 flex justify-between text-sm text-text-muted" htmlFor="term">
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
            aria-valuetext={`${boundedDays} days`}
            className="mt-2 w-full accent-[var(--accent)]"
          />
          <div className="mt-1 flex justify-between font-mono text-[10px] text-text-dim" aria-hidden="true">
            <span>{p.minDays}d</span>
            <span>{p.maxDays}d</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {termChips.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={d === boundedDays}
                onClick={() => setDays(d)}
                className={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  d === boundedDays ? "border-accent text-text" : "border-border text-text-muted hover:border-border-strong hover:text-text"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </fieldset>

        <ChoiceGroup<RiskTier>
          name="tier"
          legend={product === "depeg" ? "4 · Stablecoin risk tier" : "4 · Protocol risk tier"}
          value={riskTier}
          onChange={setRiskTier}
          compact
          options={(["A", "B", "C"] as RiskTier[]).map((t) => ({ value: t, label: `Tier ${t}`, hint: tierCopy[t] }))}
        />
      </div>

      <div ref={resultRef} id="quote-result" className="glass-panel relative flex flex-col p-5 sm:p-8 lg:self-start">
        <h2 className="sr-only">Your quote</h2>
        <div aria-live="polite">
          <p className="font-mono-label text-[10px] text-text-dim">Indicative premium</p>
          {result.ok && !amountError ? (
            <>
              <p className="mt-2 font-display text-5xl tracking-tight text-text">
                {fmt(result.premium)} <span className="text-xl text-text-muted">{cur.symbol}</span>
              </p>
              <p className="mt-1 text-sm text-text-muted">
                {pct(result.annualRate)} annualized · {boundedDays}-day term
              </p>
              <div className="mt-5 flex items-center justify-between rounded-xl border border-[color-mix(in_srgb,var(--success)_25%,var(--border))] bg-[color-mix(in_srgb,var(--success)_6%,transparent)] px-4 py-3">
                <span className="text-xs text-text-muted">{onChainProduct ? "Payout if the depeg triggers" : "Cover limit"}</span>
                <span className="font-mono text-sm text-text">
                  {fmt(coverAmount)} {cur.symbol}
                </span>
              </div>
              <dl className="mt-5 space-y-2.5 border-t border-border pt-5 text-sm">
                {[
                  ["Base rate", pct(result.breakdown.baseAnnualRate)],
                  ["Risk multiplier", `× ${result.breakdown.riskMultiplier.toFixed(2)}`],
                  ["Utilization multiplier", `× ${result.breakdown.utilizationMultiplier.toFixed(3)}`],
                  [`${cur.symbol} tranche utilization`, `${pct(result.breakdown.utilizationBefore)} → ${pct(result.breakdown.utilizationAfter)}`],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4">
                    <dt className="text-text-dim">{k}</dt>
                    <dd className="text-right font-mono text-text">{v}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <p className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--danger)_40%,var(--border))] p-4 text-sm text-[var(--danger)]">
              {amountError ?? (!result.ok ? result.reason : "")}
            </p>
          )}
        </div>

        {onChainProduct ? (
          <>
            <PolicyTimeline days={boundedDays} />
            {onChain && !amountError && (
              <details className="group mt-4 rounded-xl border border-border bg-bg-muted text-[11px] leading-relaxed text-text-dim">
                <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-text-muted hover:text-text [&::-webkit-details-marker]:hidden">
                  What goes on-chain
                  <span className="transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                </summary>
                <div className="space-y-1 border-t border-border px-3 py-2.5">
                  <p>
                    <span className="text-text-muted">Premium:</span>{" "}
                    <span className="font-mono text-text">{onChain.base.toLocaleString("en-US")}</span>{" "}
                    {currency === "ADA" ? "lovelace" : "base units (6 decimals)"}, never below the validator&apos;s floor
                  </p>
                  <p className="break-all">
                    <span className="text-text-muted">Asset:</span> <span className="font-mono">{assetId(onChain.asset)}</span>
                    {currency === "USDC" && " (mainnet USDCx)"}
                  </p>
                  {currency === "USDC" && (
                    <p className="break-all">
                      Preview testnet uses a mock tUSDCx
                      {PREVIEW_USDC_POLICY ? (
                        <>
                          : <span className="font-mono">{PREVIEW_USDC_POLICY}.745553444378</span>
                        </>
                      ) : (
                        " minted by the deploy scripts"
                      )}
                      .
                    </p>
                  )}
                  <p>
                    <span className="text-text-muted">Deposit:</span> ~{SALE_GUARD.refundDepositAda} ADA locked with the policy, returned to
                    your wallet at expiry.
                  </p>
                </div>
              </details>
            )}
          </>
        ) : (
          <p className="mt-5 rounded-xl border border-[color-mix(in_srgb,var(--gold)_30%,var(--border))] bg-[var(--gold-soft)] p-3 text-[11px] leading-relaxed text-text-muted">
            <span className="text-gold">Model-only quote.</span>{" "}
            {product === "exploit"
              ? "Exploit cover is assessed: claims resolve on Midnight Preprod and pay from the Preview exploit pool on 2 of 3 assessor-committee signatures (bought from operator tooling for now; a browser Buy is next)."
              : "SLA cover needs an uptime oracle that doesn't exist yet."}{" "}
            Browser buys are live for stablecoin depeg cover.
          </p>
        )}

        <div className="mt-5 space-y-2 border-t border-border pt-5 text-xs text-text-dim">
          <p>
            <span className="text-text-muted">Trigger:</span> {p.trigger}
          </p>
          <p>
            <span className="text-text-muted">Privacy:</span> {p.privacy}
          </p>
        </div>

        <PreviewFlow
          cta="How buying works"
          heading={`Buying ${cur.symbol} cover on Cardano Preview`}
          next={{ href: "/docs/how-cover-works", label: "How cover works" }}
          steps={[
            {
              title: "Connect a Cardano wallet",
              body: (
                <>
                  Any CIP-30 wallet (Lace, Eternl, Typhon) on the Preview testnet. Test ADA comes from the Cardano faucet
                  {currency === "USDC" ? "; Preview USDC is a mock tUSDCx, handed out for testing" : ""}.
                </>
              ),
            },
            {
              title: "Price against the live tranche",
              body: `The quote reads the real ${cur.symbol} tranche's capital and utilization, and pays exactly the validator's integer floor.`,
            },
            {
              title: "Automatic peg check",
              body: "The dApp attaches a fresh reading from every oracle feed. If any feed shows the stablecoin depegging, the validator refuses the sale, so nobody buys into a known loss.",
            },
            {
              title: "Review and sign",
              body: `You pay the premium in ${cur.symbol}. Cover starts after a ${SALE_GUARD.waitingHours}h waiting period (${SALE_GUARD.previewWaitingMinutes} min on Preview), and the ~${SALE_GUARD.refundDepositAda} ADA policy deposit comes back to you at expiry.`,
            },
            {
              title: "Hold your policy token",
              body: `It's your bearer claim right. If a quorum of oracles confirms the depeg, burning it pays ${onChainProduct && Number.isFinite(coverAmount) && !amountError ? `${fmt(coverAmount, 0)} ${cur.symbol}` : "the full coverage"} from the pool.`,
            },
          ]}
        />
        <p className="mt-4 text-center text-[11px] text-text-dim">
          Example {cur.symbol} tranche and model parameters. To buy for real on Preview, use the live panel above.
        </p>
      </div>

      {/* Mobile: keep the price visible while editing inputs. */}
      <a
        href="#quote-result"
        aria-hidden={resultInView}
        tabIndex={resultInView ? -1 : 0}
        className={`glass fixed inset-x-3 bottom-3 z-40 flex items-center justify-between rounded-full py-2.5 pl-5 pr-2 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)] transition-[transform,opacity] duration-500 lg:hidden ${
          resultInView ? "pointer-events-none translate-y-4 opacity-0" : "translate-y-0 opacity-100"
        }`}
      >
        <span className="min-w-0">
          <span className="block font-mono-label text-[9px] text-text-dim">Premium</span>
          <span className="font-mono text-sm text-text">
            {result.ok && !amountError ? `${fmt(result.premium)} ${cur.symbol}` : "—"}
          </span>
        </span>
        <span className="rounded-full bg-white/[0.08] px-3.5 py-2 text-xs text-text">View quote ↓</span>
      </a>
    </div>
  );
}

/** Buy → waiting period → cover term → claim grace, to scale-ish. */
function PolicyTimeline({ days }: { days: number }) {
  const segs = [
    { label: `${SALE_GUARD.waitingHours}h wait`, grow: 1.4, cls: "bg-[repeating-linear-gradient(135deg,var(--border-strong)_0_4px,transparent_4px_8px)]" },
    { label: `${days} days covered`, grow: 6, cls: "bg-[linear-gradient(90deg,var(--cardano),var(--accent))]" },
    { label: `${SALE_GUARD.claimGraceDays}d claim grace`, grow: 1.6, cls: "bg-[color-mix(in_srgb,var(--midnight)_55%,transparent)]" },
  ];
  return (
    <div className="mt-6 border-t border-border pt-5">
      <p className="font-mono-label text-[10px] text-text-dim">Policy timeline</p>
      <div className="mt-3 flex h-2 gap-1" aria-hidden="true">
        {segs.map((s) => (
          <span key={s.label} className={`rounded-full ${s.cls}`} style={{ flexGrow: s.grow }} />
        ))}
      </div>
      <ol className="mt-2 grid grid-cols-[1.4fr_6fr_1.6fr] gap-1 text-[10.5px] leading-tight text-text-dim">
        {segs.map((s) => (
          <li key={s.label}>{s.label}</li>
        ))}
      </ol>
      <p className="mt-3 text-[11px] leading-relaxed text-text-dim">
        Sales pause automatically if any oracle feed reports a depeg. Only time below the peg after cover begins
        counts toward the trigger window.
      </p>
    </div>
  );
}
