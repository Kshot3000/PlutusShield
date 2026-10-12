"use client";

/**
 * Live view of the Preview depeg oracle: the newest reading on every
 * allowlisted feed (read from the oracle address, decoded with the same SDK
 * mirror the Buy uses), the sale circuit-breaker it implies, and the history
 * of every reading the relay has published, baked in at build time from the
 * deployment record.
 */
import { useMemo } from "react";
import { latestPerFeed } from "@plutusshield/sdk/oracle";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { explorerTx } from "@/lib/preview";
import { BUY_WINDOW_MS, saleCheck, type FeedState } from "@/lib/tx/cover";
import { COVER, useCoverChain } from "@/lib/useCoverChain";
import { useNow } from "@/lib/useNow";
import history from "@/data/preview-oracle-history.json";

const P = COVER.params;
const THRESHOLD_BPS = Number(P.product.trigger.thresholdBps);
const MAX_AGE_MS = Number(P.saleGuard.maxPriceAgeMs);
const QUORUM = Number(P.oracle.quorum);

export interface Publish { at: string; bps: number; tx: string; live: boolean }
export const PUBLISHES = history.publishes as Publish[];

const usd = (bps: number | bigint) => `$${(Number(bps) / 10_000).toFixed(4)}`;
const short = (h: string, n = 8) => `${h.slice(0, n)}…${h.slice(-4)}`;
function span(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}
const clock = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

const dot = (s: FeedState["state"]) =>
  s === "ok" ? "bg-success" : s === "depeg" ? "bg-[var(--danger)]" : "bg-gold";
const stateLabel = { ok: "Healthy peg", stale: "Too old to sell against", depeg: "Below trigger", missing: "No reading" } as const;

export function OracleLive() {
  const chain = useCoverChain();
  const now = useNow(15_000);
  const sale = useMemo(() => (chain.feeds && now !== null ? saleCheck(P, chain.feeds, now + BUY_WINDOW_MS) : null), [chain.feeds, now]);
  const refs = useMemo(() => {
    // Newest UTxO per feed (hex token name), for the explorer link next to each reading.
    const m = new Map<string, string>();
    for (const u of chain.feeds ? latestPerFeed(chain.feeds, P.oracle) : []) m.set(u.tokens[0].name.toLowerCase(), u.ref);
    return m;
  }, [chain.feeds]);

  const tone = !sale ? "idle" : sale.ok ? "open" : "paused";
  const headline = !sale
    ? chain.feedError
      ? "Couldn't read the oracle feeds right now"
      : "Reading the oracle feeds on Cardano Preview…"
    : sale.ok
      ? "Cover sales are open"
      : sale.feeds.some((f) => f.state === "depeg")
        ? "Sales paused: a feed reports a depeg"
        : "Sales paused: readings are too old";

  return (
    <div className="space-y-6">
      <section
        className={`card-surface p-6 sm:p-8 ${tone === "open" ? "ring-1 ring-[color-mix(in_srgb,var(--success)_25%,transparent)]" : tone === "paused" ? "ring-1 ring-[color-mix(in_srgb,var(--gold)_35%,transparent)]" : ""}`}
        aria-labelledby="oracle-now"
        role="status"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="cardano">Cardano Preview</Badge>
          <Badge variant="gold">Testnet only</Badge>
          <Badge>{chain.source === "live" && chain.feeds ? "Live read" : "Loading"}</Badge>
        </div>
        <h2 id="oracle-now" className="mt-5 font-display text-[1.9rem] leading-[1.06] text-text sm:text-[2.4rem] text-balance">
          {headline}
        </h2>
        <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-text-muted text-pretty">
          {sale && now !== null && sale.ok && sale.freshUntil
            ? `Every one of the ${sale.feeds.length} allowlisted feeds has a healthy reading. A Buy signed now stays valid until ${clock(sale.freshUntil - BUY_WINDOW_MS)} (${span(sale.freshUntil - BUY_WINDOW_MS - now)} from now) unless the relay republishes first, which it does well before then.`
            : sale && !sale.ok
              ? `The validator only sells cover when every feed has a healthy reading under ${span(MAX_AGE_MS)} old. Sales reopen on their own after the next healthy publish; a depeg is never auto-published as healthy.`
              : chain.feedError
                ? `${chain.feedError}. The history below is still the real publish record.`
                : "Decoding each feed's inline datum with the same code the Buy uses."}
        </p>

        <ul className="mt-6 grid gap-3 sm:grid-cols-3">
          {(sale?.feeds ?? history.feeds.map((feed) => ({ feed, state: "missing" as const }))).map((f) => {
            const ref = refs.get(Array.from(new TextEncoder().encode(f.feed), (b) => b.toString(16).padStart(2, "0")).join(""));
            const reading = "reading" in f ? f.reading : null;
            return (
              <li key={f.feed} className="rounded-2xl border border-[var(--hairline)] bg-black/25 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-[12px] text-text-muted">{f.feed}</p>
                  <span className="flex items-center gap-1.5 text-[11px] text-text-dim">
                    <span className={`h-1.5 w-1.5 rounded-full ${sale ? dot(f.state) : "bg-text-dim"}`} aria-hidden />
                    {sale ? stateLabel[f.state] : "…"}
                  </span>
                </div>
                <p className="mt-3 font-display text-[1.7rem] leading-none text-text">{reading ? usd(reading.priceBps) : "—"}</p>
                <p className="mt-2 text-[12px] leading-relaxed text-text-dim">
                  {reading && now !== null
                    ? `24h TWAP, window ended ${span(now - Number(reading.windowEnd))} ago`
                    : "USDM 24h TWAP"}
                </p>
                {ref ? (
                  <a
                    href={explorerTx(ref.split("#")[0])}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block font-mono text-[11px] text-accent hover:underline"
                  >
                    {short(ref.split("#")[0])} ↗
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>

        <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-[var(--hairline)] pt-5 text-[12.5px] sm:grid-cols-4">
          <Stat k="Claim trigger" v={`< ${usd(THRESHOLD_BPS)} for ${span(Number(P.product.trigger.windowMs))}`} />
          <Stat k="Claim quorum" v={`${QUORUM} of ${history.feeds.length} feeds`} />
          <Stat k="Sale needs" v={`all ${history.feeds.length} feeds, < ${span(MAX_AGE_MS)} old`} />
          <Stat k="Relay cadence" v="checks every 20 min" />
        </dl>
        <div className="mt-5">
          <Button variant="secondary" size="sm" onClick={() => void chain.refresh()} disabled={chain.loading}>
            {chain.loading ? "Reading…" : "↻ Read the feeds again"}
          </Button>
        </div>
      </section>

      <PublishHistory />
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="font-mono-label text-[9.5px] text-text-dim">{k}</dt>
      <dd className="mt-1 text-text">{v}</dd>
    </div>
  );
}

/** Every published reading as a line against the $0.95 trigger, plus the latest receipts. */
export function PublishHistory() {
  const live = PUBLISHES.filter((p) => p.live);
  const pts = PUBLISHES.map((p) => ({ t: Date.parse(p.at), bps: p.bps, live: p.live }));
  const t0 = pts[0]?.t ?? 0;
  const t1 = pts.at(-1)?.t ?? 1;
  const lo = Math.min(THRESHOLD_BPS - 20, ...pts.map((p) => p.bps));
  const hi = Math.max(10_030, ...pts.map((p) => p.bps));
  const W = 720;
  const H = 220;
  const pad = { l: 52, r: 12, t: 14, b: 26 };
  const x = (t: number) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const y = (b: number) => pad.t + ((hi - b) / (hi - lo)) * (H - pad.t - pad.b);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.bps).toFixed(1)}`).join(" ");
  const bpsList = live.map((p) => p.bps);
  const min = Math.min(...bpsList);
  const max = Math.max(...bpsList);
  const recent = [...PUBLISHES].reverse().slice(0, 8);
  const ticks = [THRESHOLD_BPS, 9_800, 10_000].filter((b) => b >= lo && b <= hi);

  return (
    <section className="card-surface p-6 sm:p-8" aria-labelledby="oracle-history">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="oracle-history" className="font-display text-[1.6rem] leading-tight text-text">
          Every reading published
        </h2>
        <p className="font-mono-label text-[10px] text-text-dim">
          {PUBLISHES.length} publishes · {new Date(t0).toLocaleDateString(undefined, { month: "short", day: "numeric" })} →{" "}
          {new Date(t1).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </p>
      </div>
      <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-text-muted">
        Each point is one Preview transaction that wrote the same 24h TWAP to all three feeds. Live market readings ranged from{" "}
        <span className="text-text">{usd(min)}</span> to <span className="text-text">{usd(max)}</span>, never near the{" "}
        {usd(THRESHOLD_BPS)} trigger line. The first two were fixed $1.0000 test readings from before the live relay.
      </p>

      <figure className="mt-5 overflow-hidden rounded-2xl border border-[var(--hairline)] bg-black/25 p-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`USDM 24h TWAP published to the Preview feeds, ${PUBLISHES.length} readings, all above the ${usd(THRESHOLD_BPS)} trigger`}>
          {ticks.map((b) => (
            <g key={b}>
              <line x1={pad.l} x2={W - pad.r} y1={y(b)} y2={y(b)} stroke={b === THRESHOLD_BPS ? "var(--danger)" : "var(--hairline)"} strokeDasharray={b === THRESHOLD_BPS ? "5 5" : undefined} strokeWidth={1} />
              <text x={pad.l - 8} y={y(b) + 4} textAnchor="end" fontSize="11" fill="var(--text-dim, #8a8f98)" fontFamily="ui-monospace, monospace">
                {usd(b).slice(0, 5)}
              </text>
            </g>
          ))}
          <text x={W - pad.r} y={y(THRESHOLD_BPS) - 6} textAnchor="end" fontSize="11" fill="var(--danger)">
            claim trigger
          </text>
          <path d={path} fill="none" stroke="var(--accent, #7c9cff)" strokeWidth={1.8} strokeLinejoin="round" />
          {pts.map((p) => (
            <circle key={p.t} cx={x(p.t)} cy={y(p.bps)} r={2.4} fill={p.live ? "var(--accent, #7c9cff)" : "var(--gold)"} />
          ))}
        </svg>
        <figcaption className="px-2 pb-1 pt-1.5 text-[11px] text-text-dim">
          Gold points are the two fixed test readings; blue points are live market TWAPs. Source: the publisher&apos;s deployment record,{" "}
          <span className="font-mono">contracts/cardano/deploy/deployments/preview.json</span>.
        </figcaption>
      </figure>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[30rem] text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-[var(--hairline)] text-text-dim">
              <th className="py-2 pr-4 font-mono-label text-[9.5px] font-normal">Published</th>
              <th className="py-2 pr-4 font-mono-label text-[9.5px] font-normal">USDM 24h TWAP</th>
              <th className="py-2 font-mono-label text-[9.5px] font-normal">Preview tx</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((p) => (
              <tr key={p.tx} className="border-b border-[var(--hairline)] last:border-0">
                <td className="py-2 pr-4 text-text-muted">{clock(Date.parse(p.at))}</td>
                <td className="py-2 pr-4 font-mono text-text">
                  {usd(p.bps)} {p.live ? null : <span className="text-text-dim">(test)</span>}
                </td>
                <td className="py-2">
                  <a href={explorerTx(p.tx)} target="_blank" rel="noreferrer" className="font-mono text-[11.5px] text-accent hover:underline">
                    {short(p.tx)} ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
