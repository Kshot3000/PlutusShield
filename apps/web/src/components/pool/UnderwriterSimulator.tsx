"use client";

import { useMemo, useRef, useState } from "react";
import { ChoiceGroup, CurrencyMark } from "@/components/ui/ChoiceGroup";
import { AmountField, parseAmount } from "@/components/ui/AmountField";
import { PreviewFlow } from "@/components/PreviewFlow";
import { useInView } from "@/lib/useInView";
import { CURRENCIES, UTILIZATION_KINK, MAX_UTILIZATION, type Currency, type RiskTier } from "@plutusshield/sdk";
import { depegTrigger, productTerms, textHex } from "@plutusshield/sdk/cardano";
import {
  deposit as depositStep,
  lockedCapital,
  maxWithdrawableShares,
  shareValue,
  underwriterProjection,
  utilizationBps,
  type PoolLedger,
} from "@plutusshield/sdk/pool";

const UNIT = 1_000_000n; // base units per ADA and per USDC(x): both 6 decimals
// Example tranches for the preview (same as the /cover quote preview). Not live
// capital. Each currency is its own tranche with its own LP token
// ("lp" + tranche byte), capital lock, and utilization.
// Shares < capital models premium already accrued to LPs (share price above 1).
const EXAMPLE_TRANCHES: Record<Currency, PoolLedger> = {
  ADA: { capital: 2_500_000n * UNIT, totalShares: 2_400_000n * UNIT, activeCover: 1_150_000n * UNIT },
  USDC: { capital: 750_000n * UNIT, totalShares: 735_000n * UNIT, activeCover: 210_000n * UNIT },
};

const toAda = (x: bigint) => Number(x) / Number(UNIT);
const fmt = (n: number, d = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n: number, d = 2) => `${(n * 100).toFixed(d)}%`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${fmt(Math.abs(n))}`;

const tierCopy: Record<RiskTier, string> = {
  A: "Blue-chip stables",
  B: "Established stables",
  C: "Newer or thinner pegs",
};

function Slider({
  id,
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  hint,
}: {
  hint?: string;
  id: string;
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="mt-5">
      <label className="flex justify-between text-sm text-text-muted" htmlFor={id}>
        <span>{label}</span>
        <span className="font-mono text-text">{display}</span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={display}
        className="mt-2 w-full accent-[var(--accent)]"
      />
      {hint && <p className="mt-1 text-[11px] text-text-dim">{hint}</p>}
    </div>
  );
}

function UtilizationBar({ before, after }: { before: number; after: number }) {
  return (
    <div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-bg-muted">
        <div
          className="absolute inset-y-0 left-0 bg-[color-mix(in_srgb,var(--accent)_35%,transparent)]"
          style={{ width: `${before * 100}%` }}
        />
        <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${after * 100}%` }} />
        <div
          className="absolute inset-y-0 w-px bg-text-dim"
          style={{ left: `${UTILIZATION_KINK * 100}%` }}
          aria-hidden="true"
        />
        <div
          className="absolute inset-y-0 w-px bg-[var(--danger)]"
          style={{ left: `${MAX_UTILIZATION * 100}%` }}
          aria-hidden="true"
        />
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-text-dim">
        <span>
          {pct(before, 1)} → <span className="text-text">{pct(after, 1)}</span> after your deposit
        </span>
        <span>kink {pct(UTILIZATION_KINK, 0)} · cap {pct(MAX_UTILIZATION, 0)}</span>
      </div>
    </div>
  );
}

export function UnderwriterSimulator() {
  const [rawAmount, setRawAmount] = useState("50000");
  const parsed = parseAmount(rawAmount);
  const amount = Number.isFinite(parsed) ? parsed : 0;
  const amountError = !Number.isFinite(parsed)
    ? "Enter an amount to deposit."
    : parsed < 1
      ? "Deposit at least 1 unit."
      : null;
  const resultRef = useRef<HTMLDivElement>(null);
  const resultInView = useInView(resultRef);
  const [tier, setTier] = useState<RiskTier>("B");
  const [utilization, setUtilization] = useState(0.6);
  const [claimRate, setClaimRate] = useState(0);
  const [horizon, setHorizon] = useState(365);
  const [currency, setCurrency] = useState<Currency>("ADA");
  const sym = CURRENCIES[currency].symbol;
  const EXAMPLE_POOL = EXAMPLE_TRANCHES[currency];

  const terms = useMemo(() => productTerms("depeg", tier, depegTrigger(textHex("USDM"))), [tier]);

  const sim = useMemo(() => {
    if (amountError) return { ok: false as const, reason: amountError };
    const lovelace = BigInt(Math.max(0, Math.floor(amount))) * UNIT;
    const step = depositStep(EXAMPLE_POOL, lovelace);
    if (!step.ok) return { ok: false as const, reason: step.reason };
    const after = step.pool;
    const sharePrice = Number(after.capital) / Number(after.totalShares);
    const withdrawable = shareValue(after, maxWithdrawableShares(after, terms.maxUtilizationBps, step.shares));
    const projection = underwriterProjection({
      product: "depeg",
      riskTier: tier,
      pool: { capital: toAda(EXAMPLE_POOL.capital), activeCover: toAda(EXAMPLE_POOL.activeCover) },
      deposit: amount,
      utilization,
      claimRate,
      horizonDays: horizon,
    });
    return {
      ok: true as const,
      shares: step.shares,
      sharePrice,
      withdrawable: toAda(withdrawable),
      locked: toAda(lockedCapital(after, terms.maxUtilizationBps)),
      uBefore: Number(utilizationBps(EXAMPLE_POOL)) / 10_000,
      uAfter: Number(utilizationBps(after)) / 10_000,
      projection,
    };
  }, [amount, amountError, tier, utilization, claimRate, horizon, terms, EXAMPLE_POOL]);
  const lpToken = currency === "ADA" ? "lp00" : "lp01";

  return (
    <div className="grid gap-6 pb-20 lg:grid-cols-[1.2fr_1fr] lg:pb-0">
      <div className="glass-panel relative space-y-8 p-5 sm:p-8">
        <div>
          <ChoiceGroup<Currency>
            name="tranche"
            legend="1 · Choose a tranche"
            value={currency}
            onChange={setCurrency}
            className="grid-cols-2"
            options={(Object.keys(CURRENCIES) as Currency[]).map((c) => ({
              value: c,
              label: `${CURRENCIES[c].symbol} tranche`,
              hint: c === "ADA" ? "LP token lp00" : "LP token lp01",
              icon: <CurrencyMark currency={c} />,
            }))}
          />
          <dl className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--hairline)] text-[11px]">
            {[
              ["Tranche capital", `${fmt(toAda(EXAMPLE_POOL.capital), 0)} ${sym}`],
              ["Active cover", `${fmt(toAda(EXAMPLE_POOL.activeCover), 0)} ${sym}`],
              ["Share price", `${(Number(EXAMPLE_POOL.capital) / Number(EXAMPLE_POOL.totalShares)).toFixed(4)}`],
            ].map(([k, v]) => (
              <div key={k} className="bg-bg-muted px-3 py-2.5">
                <dt className="text-text-dim">{k}</dt>
                <dd className="mt-0.5 font-mono text-text">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5">
            <AmountField
              id="lp-amount"
              label={`Capital to underwrite (${sym})`}
              raw={rawAmount}
              onRaw={setRawAmount}
              suffix={sym}
              chips={[
                { label: "10k", value: 10_000 },
                { label: "50k", value: 50_000 },
                { label: "100k", value: 100_000 },
                { label: "250k", value: 250_000 },
              ]}
              error={amountError}
              hint={`Your capital only backs ${sym} policies. Claims in the other tranche can't touch it.`}
            />
          </div>
        </div>

        <ChoiceGroup<RiskTier>
          name="pool-tier"
          legend="2 · Pool risk tier"
          value={tier}
          onChange={setTier}
          compact
          options={(["A", "B", "C"] as RiskTier[]).map((t) => ({ value: t, label: `Tier ${t}`, hint: tierCopy[t] }))}
        />

        <div>
        <p className="font-mono-label text-[10px] text-text-dim">3 · Scenario</p>
        <Slider
          id="util"
          label="Assumed average utilization"
          value={utilization}
          display={pct(utilization, 0)}
          hint="Share of capital backing live cover over the horizon. Premium income scales with it."
          min={0}
          max={MAX_UTILIZATION}
          step={0.01}
          onChange={setUtilization}
        />
        <Slider
          id="claims"
          label="Claims paid (share of active cover)"
          value={claimRate}
          display={pct(claimRate, 1)}
          min={0}
          max={0.1}
          step={0.0025}
          onChange={setClaimRate}
        />
        <Slider
          id="horizon"
          label="Horizon"
          value={horizon}
          display={`${horizon} days`}
          min={30}
          max={365}
          step={1}
          onChange={setHorizon}
        />
        <p className="mt-6 text-xs leading-relaxed text-text-dim">
          Premiums are priced by the same kinked utilization curve as cover quotes, so the pool
          earns more per unit of cover as it fills up. A depeg that triggers the oracle quorum pays
          each affected policy its full coverage from pool capital, shared pro rata by LPs.
        </p>
        </div>
      </div>

      <div ref={resultRef} id="lp-result" className="glass-panel relative flex flex-col p-5 sm:p-8 lg:self-start">
        <div aria-live="polite">
        {sim.ok ? (
          <>
            <p className="font-mono-label text-[10px] text-text-dim">Projected net return</p>
            <p
              className={`mt-2 font-display text-5xl tracking-tight ${
                sim.projection.net >= 0 ? "text-text" : "text-[var(--danger)]"
              }`}
            >
              {signed(sim.projection.net)} <span className="text-xl text-text-muted">{sym}</span>
            </p>
            <p className="mt-1 text-sm text-text-muted">
              {pct(sim.projection.netApr)} net APR · {pct(sim.projection.premiumApr)} from premiums
            </p>

            <dl className="mt-6 space-y-2.5 border-t border-border pt-5 text-sm">
              {[
                ["LP shares minted", fmt(toAda(sim.shares), 6)],
                ["Share price", `${sim.sharePrice.toFixed(6)} ${sym}`],
                ["Pool ownership", pct(sim.projection.ownership, 3)],
                ["Premium income", `${fmt(sim.projection.premiumIncome)} ${sym}`],
                ["Claims share", sim.projection.claimLoss > 0 ? `−${fmt(sim.projection.claimLoss)} ${sym}` : `0.00 ${sym}`],
                ["Break-even claim rate", pct(sim.projection.breakEvenClaimRate)],
                ["Withdrawable right away", `${fmt(sim.withdrawable)} ${sym}`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-text-dim">{k}</dt>
                  <dd className="font-mono text-text">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-6 border-t border-border pt-5">
              <p className="mb-3 font-mono-label text-[10px] text-text-dim">Example {sym} tranche utilization</p>
              <UtilizationBar before={sim.uBefore} after={sim.uAfter} />
              <p className="mt-3 text-xs leading-relaxed text-text-dim">
                The validator keeps at least {fmt(sim.locked, 0)} {sym} locked so active cover never
                exceeds {pct(MAX_UTILIZATION, 0)} of capital. Withdrawals past that line are
                rejected on-chain.
              </p>
            </div>
          </>
        ) : (
          <p className="rounded-lg border border-[color-mix(in_srgb,var(--danger)_40%,var(--border))] p-4 text-sm text-[var(--danger)]">
            {sim.reason}
          </p>
        )}
        </div>
        <PreviewFlow
          cta="See how depositing will work"
          heading={`Underwriting the ${sym} tranche on Cardano Preview`}
          next={{ href: "/docs/underwriting-pool", label: "How the pool works" }}
          steps={[
            {
              title: "Connect a Cardano wallet",
              body: `Any CIP-30 wallet on the Preview testnet, holding test ${currency === "ADA" ? "ADA" : "tUSDCx (Preview's mock USDC)"}.`,
            },
            {
              title: `Deposit ${sym}, receive ${lpToken}`,
              body: `The validator mints LP shares at the current share price: exactly amount × shares ÷ capital, the same math shown here.`,
            },
            {
              title: "Earn premiums",
              body: `Every ${sym} policy pays its premium into this tranche, which raises the share price for all ${lpToken} holders.`,
            },
            {
              title: "Back claims, pro rata",
              body: `If a quorum of oracles confirms a depeg, covered ${sym} policies are paid from this tranche, and every LP shares the loss by ownership.`,
            },
            {
              title: "Withdraw any time",
              body: "Burn shares for your pro-rata capital, down to the capital lock that keeps active cover under 90% of the tranche.",
            },
          ]}
        />
        <p className="mt-4 text-center text-[11px] text-text-dim">
          Share math and the capital lock mirror the Aiken validator exactly. Income is a model scenario on an
          example tranche, not a forecast.
        </p>
      </div>

      {/* Mobile: keep the projection visible while editing inputs. */}
      <a
        href="#lp-result"
        aria-hidden={resultInView}
        tabIndex={resultInView ? -1 : 0}
        className={`glass fixed inset-x-3 bottom-3 z-40 flex items-center justify-between rounded-full py-2.5 pl-5 pr-2 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)] transition-[transform,opacity] duration-500 lg:hidden ${
          resultInView ? "pointer-events-none translate-y-4 opacity-0" : "translate-y-0 opacity-100"
        }`}
      >
        <span className="min-w-0">
          <span className="block font-mono-label text-[9px] text-text-dim">Projected net · {horizon}d</span>
          <span className="font-mono text-sm text-text">{sim.ok ? `${signed(sim.projection.net)} ${sym}` : "—"}</span>
        </span>
        <span className="rounded-full bg-white/[0.08] px-3.5 py-2 text-xs text-text">View result ↓</span>
      </a>
    </div>
  );
}
