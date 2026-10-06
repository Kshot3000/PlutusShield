"use client";

import { useMemo, useState } from "react";
import { UTILIZATION_KINK, MAX_UTILIZATION, type RiskTier } from "@plutusshield/sdk";
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

const UNIT = 1_000_000n; // lovelace per ADA
// Example pool for the preview (same as the /cover quote preview). Not live capital.
// Shares < capital models premium already accrued to LPs (share price above 1).
const EXAMPLE_POOL: PoolLedger = {
  capital: 2_500_000n * UNIT,
  totalShares: 2_400_000n * UNIT,
  activeCover: 1_150_000n * UNIT,
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
}: {
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
        className="mt-2 w-full accent-[var(--accent)]"
      />
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
  const [amount, setAmount] = useState(50_000);
  const [tier, setTier] = useState<RiskTier>("B");
  const [utilization, setUtilization] = useState(0.6);
  const [claimRate, setClaimRate] = useState(0);
  const [horizon, setHorizon] = useState(365);

  const terms = useMemo(() => productTerms("depeg", tier, depegTrigger(textHex("USDM"))), [tier]);

  const sim = useMemo(() => {
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
  }, [amount, tier, utilization, claimRate, horizon, terms]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div className="card-surface p-6 sm:p-8">
        <p className="font-mono-label text-[10px] text-text-dim">1 · Deposit</p>
        <label className="mt-3 block text-sm text-text-muted" htmlFor="lp-amount">
          Capital to underwrite (ADA)
        </label>
        <input
          id="lp-amount"
          type="number"
          min={1}
          step={1_000}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="mt-1.5 h-11 w-full rounded-lg border border-border-strong bg-bg-muted px-3 font-mono text-text outline-none focus:border-accent"
        />

        <p className="mt-8 font-mono-label text-[10px] text-text-dim">2 · Pool risk tier</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {(["A", "B", "C"] as RiskTier[]).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={t === tier}
              onClick={() => setTier(t)}
              className={`rounded-lg border px-3 py-2.5 text-left text-xs transition-colors ${
                t === tier
                  ? "border-[color-mix(in_srgb,var(--accent)_55%,var(--border))] text-text"
                  : "border-border text-text-muted hover:border-border-strong"
              }`}
            >
              <span className="font-semibold">Tier {t}</span>
              <span className="mt-0.5 block text-text-dim">{tierCopy[t]}</span>
            </button>
          ))}
        </div>

        <p className="mt-8 font-mono-label text-[10px] text-text-dim">3 · Scenario</p>
        <Slider
          id="util"
          label="Average utilization"
          value={utilization}
          display={pct(utilization, 0)}
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

      <div className="card-surface flex flex-col p-6 sm:p-8" aria-live="polite">
        {sim.ok ? (
          <>
            <p className="font-mono-label text-[10px] text-text-dim">Projected net return</p>
            <p
              className={`mt-2 font-display text-5xl tracking-tight ${
                sim.projection.net >= 0 ? "text-text" : "text-[var(--danger)]"
              }`}
            >
              {signed(sim.projection.net)} <span className="text-xl text-text-muted">ADA</span>
            </p>
            <p className="mt-1 text-sm text-text-muted">
              {pct(sim.projection.netApr)} net APR · {pct(sim.projection.premiumApr)} from premiums
            </p>

            <dl className="mt-6 space-y-2.5 border-t border-border pt-5 text-sm">
              {[
                ["LP shares minted", fmt(toAda(sim.shares), 6)],
                ["Share price", `${sim.sharePrice.toFixed(6)} ADA`],
                ["Pool ownership", pct(sim.projection.ownership, 3)],
                ["Premium income", `${fmt(sim.projection.premiumIncome)} ADA`],
                ["Claims share", `−${fmt(sim.projection.claimLoss)} ADA`],
                ["Break-even claim rate", pct(sim.projection.breakEvenClaimRate)],
                ["Withdrawable right away", `${fmt(sim.withdrawable)} ADA`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-text-dim">{k}</dt>
                  <dd className="font-mono text-text">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-6 border-t border-border pt-5">
              <p className="mb-3 font-mono-label text-[10px] text-text-dim">Example pool utilization</p>
              <UtilizationBar before={sim.uBefore} after={sim.uAfter} />
              <p className="mt-3 text-xs leading-relaxed text-text-dim">
                The validator keeps at least {fmt(sim.locked, 0)} ADA locked so active cover never
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
        <button
          type="button"
          disabled
          className="mt-8 h-11 w-full rounded-full bg-accent text-sm font-medium text-[var(--text-inverse)] opacity-50"
        >
          Deposits open on testnet
        </button>
        <p className="mt-3 text-center text-[11px] text-text-dim">
          Share math and capital lock mirror the Aiken validator exactly. Income is a model
          scenario on an example pool, not a forecast.
        </p>
      </div>
    </div>
  );
}
