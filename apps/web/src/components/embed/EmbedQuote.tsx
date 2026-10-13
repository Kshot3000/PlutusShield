"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  EMBED_DEFAULTS,
  EMBED_RESIZE_MESSAGE,
  PRODUCTS,
  decodeEmbedConfig,
  embedQuote,
  type EmbedConfig,
} from "@plutusshield/sdk";
import { ShieldMark } from "@/components/Logo";
import { PLANNER_POOLS, PLANNER_SNAPSHOT_AT } from "@/lib/coverPlanner";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const TERMS = [30, 90, 180, 365];

/** Light theme: swap the design tokens on the widget root only. */
const LIGHT: CSSProperties = {
  ["--bg" as string]: "#f6f7fb",
  ["--bg-card" as string]: "#ffffff",
  ["--bg-muted" as string]: "#eef0f6",
  ["--border" as string]: "#e1e4ee",
  ["--border-strong" as string]: "#cdd2e1",
  ["--hairline" as string]: "rgba(5,6,11,0.08)",
  ["--text" as string]: "#0b0e18",
  ["--text-muted" as string]: "#4a5269",
  ["--text-dim" as string]: "#5d6680",
  ["--accent" as string]: "#3f57d6",
  ["--gold" as string]: "#9a6b12",
  ["--cardano" as string]: "#2f55e4",
  ["--midnight" as string]: "#6d4dea",
};

const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const unit = (c: EmbedConfig["currency"]) => (c === "ADA" ? "tADA" : "tUSDCx");

export function EmbedQuote() {
  const [cfg, setCfg] = useState<EmbedConfig>(EMBED_DEFAULTS);
  const [amountText, setAmountText] = useState(String(EMBED_DEFAULTS.amount));
  const [warnings, setWarnings] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  // Read the partner's params once on the client (static export has no SSR search params).
  useEffect(() => {
    const r = decodeEmbedConfig(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from the URL
    setCfg(r.config);
    setAmountText(String(r.config.amount));
    setWarnings(r.warnings);
  }, []);

  // Match the page behind the iframe to the widget theme.
  useEffect(() => {
    document.body.style.background = cfg.theme === "light" ? "#f6f7fb" : "";
  }, [cfg.theme]);

  // Tell the embedding page our height so it can size the iframe.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || window.parent === window) return;
    const send = () => window.parent.postMessage({ type: EMBED_RESIZE_MESSAGE, height: el.scrollHeight }, "*");
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const product = PRODUCTS[cfg.product];
  const pool = PLANNER_POOLS[cfg.currency][cfg.product];
  const { quote, planQuery } = useMemo(() => embedQuote(cfg, pool), [cfg, pool]);
  const terms = useMemo(
    () => [...new Set([...TERMS, cfg.days])].filter((d) => d >= product.minDays && d <= product.maxDays).sort((a, b) => a - b),
    [cfg.days, product],
  );
  const capacity = pool ? Math.max(0, Math.min(pool.capital * 0.1, pool.capital * 0.9 - pool.activeCover)) : 0;
  const snapshot = PLANNER_SNAPSHOT_AT ? new Date(PLANNER_SNAPSHOT_AT).toISOString().slice(0, 10) : null;
  const tone = cfg.product === "depeg" ? "var(--cardano)" : "var(--midnight)";

  const setAmount = (t: string) => {
    setAmountText(t);
    const n = Number(t);
    if (Number.isFinite(n) && n > 0) setCfg((c) => ({ ...c, amount: n }));
  };

  return (
    <div
      ref={rootRef}
      style={cfg.theme === "light" ? LIGHT : undefined}
      className="bg-bg p-2 text-text"
      data-theme={cfg.theme}
    >
      <div className="rounded-2xl border border-border bg-bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <a href={`${base}/`} target="_blank" rel="noopener" className="flex items-center gap-2 text-[13px] font-medium text-text">
            <ShieldMark size={22} />
            PlutusShield
            {cfg.ref ? <span className="font-normal text-text-dim">via {cfg.ref}</span> : null}
          </a>
          <span className="rounded-full border border-border-strong px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wide text-text-muted">
            Testnet
          </span>
        </div>

        <h1 className="mt-4 text-[15px] font-semibold leading-snug text-text">{product.name}</h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-text-muted">
          <span style={{ color: tone }}>●</span> {product.trigger}
        </p>

        <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
          <label className="sr-only" htmlFor="embed-amount">Cover amount</label>
          <input
            id="embed-amount"
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmount(e.target.value)}
            className="h-10 w-full rounded-lg border border-border-strong bg-bg-muted px-3 text-[14px] text-text outline-none focus:border-accent"
          />
          <div role="group" aria-label="Currency" className="flex rounded-lg border border-border-strong bg-bg-muted p-0.5">
            {(["ADA", "USDC"] as const).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={cfg.currency === c}
                onClick={() => setCfg((x) => ({ ...x, currency: c }))}
                className={`rounded-md px-2.5 text-[12.5px] ${cfg.currency === c ? "bg-bg-card text-text shadow-sm" : "text-text-muted"}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div role="group" aria-label="Term" className="mt-2 flex flex-wrap gap-1.5">
          {terms.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={cfg.days === d}
              onClick={() => setCfg((x) => ({ ...x, days: d }))}
              className={`h-8 rounded-lg border px-3 text-[12.5px] ${cfg.days === d ? "border-accent text-text" : "border-border text-text-muted"}`}
            >
              {d} days
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-border bg-bg-muted p-4" aria-live="polite">
          {quote.ok ? (
            <>
              <div className="text-[11.5px] uppercase tracking-wide text-text-dim">Premium</div>
              <div className="mt-1 font-mono text-[26px] leading-none" style={{ color: "var(--gold)" }}>
                {fmt(quote.premium)} <span className="text-[13px] text-text-muted">{unit(cfg.currency)}</span>
              </div>
              <div className="mt-2 text-[12px] text-text-muted">
                {pct(quote.annualRate, 2)} a year · pool utilization {pct(quote.breakdown.utilizationAfter)} after
              </div>
            </>
          ) : (
            <>
              <div className="text-[13px] font-medium text-text">Can&apos;t quote this cover</div>
              <div className="mt-1 text-[12.5px] text-text-muted">{quote.reason}.</div>
              {pool ? (
                <div className="mt-1 text-[12px] text-text-dim">
                  One policy can take up to {fmt(capacity, 0)} {unit(cfg.currency)} right now.
                </div>
              ) : null}
            </>
          )}
        </div>

        <a
          href={`${base}/plan/?${planQuery}`}
          target="_blank"
          rel="noopener"
          className="mt-4 flex h-10 items-center justify-center rounded-lg bg-[var(--text)] text-[13.5px] font-medium text-[var(--bg)] transition-opacity hover:opacity-90"
        >
          Get this cover on PlutusShield ↗
        </a>
        <p className="mt-3 text-[11px] leading-relaxed text-text-dim">
          Priced with the PlutusShield quote engine on the Cardano Preview pools
          {snapshot ? ` (snapshot ${snapshot})` : ""}. Testnet value only, not audited, not an offer of insurance. You buy
          from your own wallet on PlutusShield; this widget never connects one.
        </p>
        {warnings.length ? (
          <details className="mt-2 text-[11px] text-text-dim">
            <summary className="cursor-pointer">Some embed settings were ignored</summary>
            <ul className="mt-1 list-disc pl-4">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}
