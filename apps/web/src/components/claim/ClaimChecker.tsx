"use client";

import { useMemo, useState } from "react";
import { ChoiceGroup, Chip } from "@/components/ui/ChoiceGroup";
import {
  CLAIM_GRACE_H,
  COVER_END_H,
  COVER_START_H,
  SCENARIOS,
  TIMELINE_HOURS,
  VENUES,
  dayLabel,
  evaluateClaim,
  feedLabel,
  hourOf,
  venueSamples,
  type FeedName,
  type ScenarioId,
  type VenueHealth,
} from "@/lib/claimScenarios";

const FEEDS: FeedName[] = ["feed-a", "feed-b", "feed-c"];
const price = (bps: bigint | number) => (Number(bps) / 10_000).toFixed(4);

// Chart geometry (SVG user units).
const W = 720;
const H = 270;
const PAD = { l: 50, r: 12, t: 14, b: 30 };
const Y_MIN = 8_900;
const Y_MAX = 10_060;
const x = (h: number) => PAD.l + (h / TIMELINE_HOURS) * (W - PAD.l - PAD.r);
const y = (bps: number) => PAD.t + ((Y_MAX - bps) / (Y_MAX - Y_MIN)) * (H - PAD.t - PAD.b);

function path(points: { h: number; bps: number }[]) {
  return points.map((p, i) => `${i ? "L" : "M"}${x(p.h).toFixed(1)},${y(p.bps).toFixed(1)}`).join("");
}

function PriceChart({
  venues,
  median,
  nowH,
  depeg,
}: {
  venues: { h: number; bps: number }[][];
  median: { h: number; bps: number }[];
  nowH: number;
  depeg?: { from: number; to: number };
}) {
  const past = median.filter((p) => p.h <= nowH);
  const future = median.filter((p) => p.h >= nowH);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby="chart-title chart-desc">
      <title id="chart-title">USDM price across three venues, with the cover period and claim window</title>
      <desc id="chart-desc">
        Median price is the solid line. The shaded band is the cover period, the gold band is the claim grace period,
        and the dashed line is the 0.95 trigger.
      </desc>
      {/* Cover period and grace */}
      <rect x={x(COVER_START_H)} y={PAD.t} width={x(COVER_END_H) - x(COVER_START_H)} height={H - PAD.t - PAD.b} fill="var(--accent-glow)" />
      <rect
        x={x(COVER_END_H)}
        y={PAD.t}
        width={x(COVER_END_H + CLAIM_GRACE_H) - x(COVER_END_H)}
        height={H - PAD.t - PAD.b}
        fill="color-mix(in srgb, var(--gold) 9%, transparent)"
      />
      <text x={x(COVER_START_H) + 8} y={H - PAD.b - 10} className="fill-text-dim font-mono" fontSize="13">
        cover period
      </text>
      <text x={x(COVER_END_H) + 8} y={H - PAD.b - 10} className="font-mono" fontSize="13" fill="var(--gold)">
        claim grace
      </text>
      {depeg && (
        <rect
          x={x(depeg.from)}
          y={PAD.t}
          width={Math.max(2, x(depeg.to) - x(depeg.from))}
          height={H - PAD.t - PAD.b}
          fill="color-mix(in srgb, var(--danger) 16%, transparent)"
          stroke="color-mix(in srgb, var(--danger) 55%, transparent)"
          strokeDasharray="3 3"
        />
      )}
      {/* Axes */}
      {[9_000, 9_500, 10_000].map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--hairline)" />
          <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" className="fill-text-dim font-mono" fontSize="13">
            {(v / 10_000).toFixed(2)}
          </text>
        </g>
      ))}
      <line x1={PAD.l} x2={W - PAD.r} y1={y(9_500)} y2={y(9_500)} stroke="var(--danger)" strokeDasharray="5 4" opacity="0.8" />
      {Array.from({ length: TIMELINE_HOURS / 24 + 1 }, (_, d) => (
        <text key={d} x={x(d * 24)} y={H - 8} textAnchor="middle" className="fill-text-dim font-mono" fontSize="13">
          d{d}
        </text>
      ))}
      {/* Venues (faint), then the median */}
      {venues.map((v, i) => (
        <path key={i} d={path(v)} fill="none" stroke="var(--text-dim)" strokeWidth="1" opacity="0.35" />
      ))}
      <path d={path(future)} fill="none" stroke="var(--accent-strong)" strokeWidth="1.5" opacity="0.3" strokeDasharray="2 3" />
      <path d={path(past)} fill="none" stroke="var(--accent-strong)" strokeWidth="2" />
      {/* Now */}
      <line x1={x(nowH)} x2={x(nowH)} y1={PAD.t - 4} y2={H - PAD.b} stroke="var(--text)" strokeWidth="1.25" />
      <circle cx={x(nowH)} cy={PAD.t - 4} r="3" fill="var(--text)" />
    </svg>
  );
}

function Row({ label, ok, children }: { label: string; ok: boolean | null; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 border-t border-[var(--hairline)] py-3.5 first:border-t-0">
      <span
        className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          ok === null ? "bg-white/[0.06] text-text-dim" : ok ? "bg-[color-mix(in_srgb,var(--success)_20%,transparent)] text-success" : "bg-[color-mix(in_srgb,var(--danger)_20%,transparent)] text-danger"
        }`}
        aria-hidden="true"
      >
        {ok === null ? "·" : ok ? "✓" : "×"}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-text">
          {label}
          <span className="sr-only">: {ok === null ? "not applicable" : ok ? "passes" : "fails"}</span>
        </p>
        <div className="mt-0.5 text-[13px] leading-relaxed text-text-muted">{children}</div>
      </div>
    </li>
  );
}

export function ClaimChecker() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>("sharp");
  const [health, setHealth] = useState<VenueHealth>("honest");
  const [online, setOnline] = useState<FeedName[]>([...FEEDS]);
  const [nowH, setNowH] = useState(120);
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;

  const chart = useMemo(() => {
    const vs = venueSamples(scenario, health).map((v) => v.map((p) => ({ h: hourOf(p.t), bps: Number(p.priceBps) })));
    return { venues: vs };
  }, [scenario, health]);
  const result = useMemo(() => evaluateClaim(scenario, health, online, nowH), [scenario, health, online, nowH]);
  const median = useMemo(() => result.series.map((p) => ({ h: hourOf(p.t), bps: Number(p.priceBps) })), [result.series]);

  const deadlineH = hourOf(result.settle.deadline);
  const windowOpen = nowH <= deadlineH;
  const quorumOk = !result.settle.blockers.some((b) => b.code === "no-quorum");
  const depeg = result.depeg ? { from: hourOf(result.depeg.windowStart), to: hourOf(result.depeg.windowEnd) } : undefined;
  const toggleFeed = (f: FeedName) =>
    setOnline((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : FEEDS.filter((x) => x === f || cur.includes(x))));

  let verdict: { tone: "ok" | "no" | "wait"; title: string; body: string };
  if (result.settle.ok) {
    verdict = {
      tone: "ok",
      title: "Settle would pass",
      body: "Attach the feed UTxOs below as reference inputs, burn the policy tokens, and the pool pays the full coverage from the policy's tranche. Nobody has to approve it.",
    };
  } else if (!windowOpen) {
    verdict = {
      tone: "no",
      title: "Claim window closed",
      body: `The validator only accepts a Settle whose validity upper bound is at or before expiry plus ${CLAIM_GRACE_H / 24} days of grace.`,
    };
  } else if (!result.coverStarted) {
    verdict = { tone: "wait", title: "Cover hasn't started", body: "The policy is in its waiting period. Only windows fully inside the cover period count." };
  } else if (!result.depeg) {
    verdict = {
      tone: nowH < COVER_END_H ? "wait" : "no",
      title: nowH < COVER_END_H ? "No trigger yet" : "No payout for this policy",
      body:
        nowH < COVER_END_H
          ? "No full 24-hour window inside the cover period has averaged below 0.95 so far. The policy stays active."
          : "No full 24-hour window inside the cover period averaged below 0.95. The policy can be expired and its deposit refunded.",
    };
  } else {
    verdict = {
      tone: "no",
      title: "Not enough feeds",
      body: `A depeg window exists, but only ${result.settle.feeds.length} of the 2 required feeds publish it. Settle needs a quorum of distinct allowlisted feeds.`,
    };
  }
  const tones = {
    ok: "border-[color-mix(in_srgb,var(--success)_45%,transparent)] bg-[color-mix(in_srgb,var(--success)_8%,transparent)] text-success",
    no: "border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--danger)_7%,transparent)] text-danger",
    wait: "border-[color-mix(in_srgb,var(--gold)_45%,transparent)] bg-[color-mix(in_srgb,var(--gold)_7%,transparent)] text-gold",
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div className="glass-panel relative space-y-8 p-5 sm:p-8">
        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono-label text-[10px] text-text-dim">USDM vs peg · hourly</p>
            <Chip tone="gold">Example data</Chip>
          </div>
          <div className="mt-3 rounded-2xl border border-[var(--hairline)] bg-bg-muted/50 p-2 sm:p-3">
            <PriceChart venues={chart.venues} median={median} nowH={nowH} depeg={depeg} />
          </div>
          <div className="mt-5">
            <label className="flex justify-between text-sm text-text-muted" htmlFor="claim-now">
              <span>Check the claim at</span>
              <span className="font-mono text-text">{dayLabel(nowH)}</span>
            </label>
            <input
              id="claim-now"
              type="range"
              min={0}
              max={TIMELINE_HOURS}
              step={1}
              value={nowH}
              onChange={(e) => setNowH(Number(e.target.value))}
              aria-valuetext={dayLabel(nowH)}
              className="mt-2 w-full accent-[var(--accent)]"
            />
            <p className="mt-1 text-[11px] text-text-dim">
              Cover runs {dayLabel(COVER_START_H)} to {dayLabel(COVER_END_H)}. Feeds can only attest data published before this moment.
            </p>
          </div>
        </div>

        <ChoiceGroup
          name="scenario"
          legend="1 · Market scenario"
          value={scenarioId}
          onChange={setScenarioId}
          className="grid-cols-1 sm:grid-cols-2"
          options={SCENARIOS.map((s) => ({ value: s.id, label: s.label, hint: s.hint }))}
        />

        <ChoiceGroup
          name="venues"
          legend="2 · Price venues"
          value={health}
          onChange={setHealth}
          compact
          options={[
            { value: "honest", label: "All honest", hint: `${VENUES.length} venues agree` },
            { value: "one-frozen", label: "One frozen", hint: "C stuck at 1.0000" },
            { value: "two-frozen", label: "Two frozen", hint: "B and C stuck" },
          ]}
        />

        <fieldset className="min-w-0">
          <legend className="font-mono-label text-[10px] text-text-dim">3 · Oracle feeds online (quorum 2 of 3)</legend>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {FEEDS.map((f) => {
              const on = online.includes(f);
              return (
                <label
                  key={f}
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-xs transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${
                    on
                      ? "border-[color-mix(in_srgb,var(--accent)_55%,var(--border))] bg-[var(--accent-glow)] text-text"
                      : "border-border bg-bg-muted/60 text-text-dim"
                  }`}
                >
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleFeed(f)} />
                  <span className="font-mono">{f}</span>
                  <span className={`h-2 w-2 rounded-full ${on ? "bg-success" : "bg-border-strong"}`} aria-hidden="true" />
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      <div className="space-y-6">
        <section aria-live="polite" className="glass-panel relative p-5 sm:p-7">
          <p className="font-mono-label text-[10px] text-text-dim">Settle check · mirrors cover.ak</p>
          <div className={`mt-3 rounded-2xl border p-4 ${tones[verdict.tone]}`}>
            <p className="font-display text-2xl leading-tight">{verdict.title}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-text-muted">{verdict.body}</p>
          </div>
          <ul className="mt-4">
            <Row label="Claim window" ok={windowOpen}>
              {windowOpen ? "Open" : "Closed"} until {dayLabel(deadlineH)} (expiry + {CLAIM_GRACE_H / 24} days).
            </Row>
            <Row label="Trigger inside cover" ok={result.coverStarted ? !!result.depeg : null}>
              {result.depeg ? (
                <>
                  24h TWAP {price(result.depeg.priceBps)} from {dayLabel(hourOf(result.depeg.windowStart))} to{" "}
                  {dayLabel(hourOf(result.depeg.windowEnd))}. Earliest window that proves it.
                </>
              ) : (
                "No full 24-hour window inside the cover period averages below 0.9500."
              )}
            </Row>
            <Row label="Oracle quorum" ok={result.depeg ? quorumOk : null}>
              {result.depeg
                ? `${result.settle.feeds.length} distinct allowlisted feed${result.settle.feeds.length === 1 ? "" : "s"} attest${result.settle.feeds.length === 1 ? "s" : ""} it; 2 required.`
                : "Nothing to attest yet."}
            </Row>
          </ul>
          {result.settle.ok && result.depeg && (
            <div className="mt-2 rounded-xl border border-[var(--hairline)] bg-bg-muted/60 p-3.5">
              <p className="font-mono-label text-[9.5px] text-text-dim">Reference inputs</p>
              <p className="mt-1 font-mono text-xs text-text">{result.settle.feeds.map(feedLabel).join(" · ")}</p>
              <p className="mt-3 font-mono-label text-[9.5px] text-text-dim">OracleDatum inline CBOR</p>
              <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-text-muted">{result.depegCbor}</p>
            </div>
          )}
        </section>

        <section className="glass-panel relative p-5 sm:p-7">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono-label text-[10px] text-text-dim">Sale circuit-breaker at this moment</p>
            <Chip tone={result.sale.ok ? "accent" : "gold"}>{result.sale.ok ? "Sales open" : "Sales paused"}</Chip>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-text-muted">
            {result.sale.reading ? (
              <>
                Trailing 24h TWAP is <span className="font-mono text-text">{price(result.sale.reading.priceBps)}</span>.{" "}
              </>
            ) : null}
            {result.sale.ok
              ? "Every allowlisted feed shows a fresh healthy peg, so a new Buy would pass."
              : result.sale.missing.length
                ? `A new Buy would be refused: ${result.sale.missing.map(feedLabel).join(", ")} ${result.sale.missing.length === 1 ? "has" : "have"} no fresh healthy reading. Sales need every feed, not a quorum, so nobody can buy cover into a depeg already under way.`
                : "A new Buy would be refused."}
          </p>
          {health === "two-frozen" && (
            <p className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] p-3 text-[12px] leading-relaxed text-text-muted">
              With two of three venues frozen, the median follows the frozen quote and no feed can prove a depeg. A median
              protects against one bad source, not a majority. That&apos;s why each feed should draw on several independent venues.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
