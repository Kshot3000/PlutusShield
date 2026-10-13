import Link from "next/link";
import { HashCell } from "@/components/assessors/HashCell";
import { Badge } from "@/components/ui/Badge";
import {
  UNDERWRITING_BOOK as B,
  formatBookAmount,
  pctBps,
  type BookEntry,
} from "@/lib/underwritingBook";
import { shortHash } from "@/lib/midnightPreprod";
import { explorerAddress, explorerTx } from "@/lib/preview";

const fmtSnap = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "UTC",
      }) + " UTC"
    : null;

function ScorecardBreakdown({ entry }: { entry: BookEntry }) {
  const { scored, breakdown } = entry;
  return (
    <div className="rounded-xl border border-border bg-bg-muted/40 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono-label text-[10px] text-text-dim">Live scorecard · read-only</p>
          <p className="mt-1 font-display text-2xl tracking-tight text-text">
            Tier {entry.riskTier}{" "}
            <span className="text-base text-text-muted">
              {entry.riskMultBps.toLocaleString("en-US")} bps · {scored.points}/{scored.maxPoints} pts (
              {Math.round(scored.share * 100)}%)
            </span>
          </p>
        </div>
        <Link
          href="/docs/risk-tiers"
          className="rounded-full border border-border bg-white/[0.04] px-3.5 py-1.5 text-[12px] text-text transition hover:bg-white/[0.08]"
        >
          Replay on interactive scorecard →
        </Link>
      </div>
      <ul className="mt-4 divide-y divide-border/60">
        {breakdown.map((row) => (
          <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-[12.5px]">
            <span className="min-w-[10rem] flex-1 text-text-muted">{row.label}</span>
            <span className="text-text">{row.answer}</span>
            <span className="font-mono text-[11px] text-text-dim">{row.points} pt</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12.5px] leading-relaxed text-text-muted">{entry.whyTier}</p>
    </div>
  );
}

function CapitalGrid({ entry }: { entry: BookEntry }) {
  if (!entry.tranches.length) {
    return (
      <p className="text-[12.5px] text-text-dim">
        No build-time snapshot for this legacy pool. Open the address on the explorer to read remaining LP capital.
      </p>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {entry.tranches.map((t) => (
        <div key={t.index} className="rounded-xl border border-border bg-white/[0.02] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-text">{t.ticker} tranche</p>
            <Badge variant={t.symbol === "ADA" ? "cardano" : "accent"}>{t.symbol}</Badge>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11.5px]">
            {[
              ["Capital", `${formatBookAmount(t.capital, t.decimals)} ${t.ticker}`],
              ["Active cover", `${formatBookAmount(t.activeCover, t.decimals)} ${t.ticker}`],
              ["Free capacity", `${formatBookAmount(t.freeCapacity, t.decimals)} ${t.ticker}`],
              ["Utilization", pctBps(t.utilizationBps)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-text-dim">{k}</dt>
                <dd className="mt-0.5 font-mono text-text">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3">
            <div className="mb-1.5 flex justify-between text-[10px] text-text-dim">
              <span>{pctBps(t.utilizationBps)}</span>
              <span>cap {pctBps(entry.maxUtilizationBps, 0)}</span>
            </div>
            <div
              className="relative h-1.5 overflow-hidden rounded-full bg-white/[0.06]"
              role="img"
              aria-label={`Utilization ${pctBps(t.utilizationBps)} of a ${pctBps(entry.maxUtilizationBps, 0)} cap`}
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]"
                style={{ width: `${Math.min(100, Math.max(t.utilizationBps / 100, 0.8))}%` }}
              />
              <div
                className="absolute inset-y-0 w-px bg-[var(--danger)]/70"
                style={{ left: `${entry.maxUtilizationBps / 100}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PoolCard({ entry }: { entry: BookEntry }) {
  const snap = fmtSnap(entry.snapshotTakenAt);
  return (
    <article className="glass-panel relative rounded-[1.6rem] p-6 sm:p-8" aria-labelledby={`book-${entry.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="cardano">Cardano Preview</Badge>
            {entry.product === "exploit" ? <Badge variant="midnight">Midnight Preprod</Badge> : null}
            {entry.live ? <Badge variant="gold">Live</Badge> : <Badge>Legacy</Badge>}
            <Badge>
              Tier {entry.riskTier} · {entry.riskMultBps.toLocaleString("en-US")} bps
            </Badge>
          </div>
          <h2 id={`book-${entry.id}`} className="mt-3 font-display text-[1.65rem] leading-tight text-text sm:text-[1.85rem]">
            {entry.title}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">{entry.subtitle}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-2 text-[11.5px] sm:text-right">
          <div>
            <dt className="text-text-dim">Base rate</dt>
            <dd className="font-mono text-text">{(entry.baseRateBps / 100).toFixed(2)}% / yr</dd>
          </div>
          <div>
            <dt className="text-text-dim">Policies (snapshot)</dt>
            <dd className="font-mono text-text">{entry.policyCount}</dd>
          </div>
        </dl>
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-text-muted">{entry.note}</p>

      <div className="mt-6 grid gap-3 text-[12px] sm:grid-cols-2">
        <div>
          <p className="font-mono-label text-[9.5px] text-text-dim">Pool address</p>
          <div className="mt-1">
            <HashCell value={entry.address} href={explorerAddress(entry.address)} tone="cardano" />
          </div>
        </div>
        <div>
          <p className="font-mono-label text-[9.5px] text-text-dim">Script hash</p>
          <div className="mt-1">
            <HashCell value={entry.scriptHash} />
          </div>
        </div>
      </div>

      {entry.keyTxs.length ? (
        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px]" aria-label="Key transactions">
          {entry.keyTxs.map((tx) => (
            <li key={tx.hash + tx.label}>
              <span className="text-text-dim">{tx.label.split("(")[0].trim()} · </span>
              <a
                href={explorerTx(tx.hash)}
                target="_blank"
                rel="noreferrer"
                title={tx.hash}
                className="font-mono text-text underline decoration-dotted underline-offset-4 hover:text-cardano"
              >
                {shortHash(tx.hash)} ↗
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-6">
        <p className="font-mono-label text-[9.5px] text-text-dim">
          Capital{snap ? ` · snapshot ${snap}` : ""}
        </p>
        <div className="mt-3">
          <CapitalGrid entry={entry} />
        </div>
      </div>

      <div className="mt-6">
        <ScorecardBreakdown entry={entry} />
      </div>

      <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <Link href="/pool" className="font-medium text-cardano underline-offset-4 hover:underline">
          Underwrite / pool <span aria-hidden="true">→</span>
        </Link>
        <Link href="/cover" className="font-medium text-cardano underline-offset-4 hover:underline">
          Quote cover <span aria-hidden="true">→</span>
        </Link>
        <Link href="/docs/risk-tiers" className="font-medium text-text underline-offset-4 hover:underline">
          Risk-tier scorecard
        </Link>
        <Link href="/docs/pricing" className="font-medium text-text underline-offset-4 hover:underline">
          Pricing
        </Link>
        {entry.product === "exploit" ? (
          <Link href="/claims" className="font-medium text-midnight underline-offset-4 hover:underline">
            Claims register
          </Link>
        ) : (
          <Link href="/oracle" className="font-medium text-text underline-offset-4 hover:underline">
            Live oracle
          </Link>
        )}
        <Link href="/status" className="font-medium text-text underline-offset-4 hover:underline">
          Status
        </Link>
        {entry.recordHref ? (
          <a
            href={entry.recordHref}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-text-muted underline-offset-4 hover:underline"
          >
            Deploy record ↗
          </a>
        ) : null}
      </div>
    </article>
  );
}

export function UnderwritingBook() {
  const { stats } = B;
  return (
    <div className="space-y-6">
      <section className="card-surface p-6 sm:p-8" aria-labelledby="book-summary">
        <div className="flex flex-wrap gap-2">
          <Badge variant="gold">Open book</Badge>
          <Badge variant="cardano">Cardano Preview</Badge>
          <Badge variant="midnight">Midnight Preprod</Badge>
          <Badge>Not audited</Badge>
        </div>
        <h2 id="book-summary" className="mt-4 font-display text-[1.6rem] leading-tight text-text">
          {stats.livePools} live pools · tier {stats.tier} · risk_mult_bps {stats.riskMultBps.toLocaleString("en-US")}
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-text-muted">
          Every live underwriting pool fixes its risk multiplier once, at InitPool. This book shows the product,
          the concrete scorecard answers that produced tier {stats.tier}, the capital and utilization from the public
          Preview snapshots, and the on-chain addresses — rebuilt from deployment records on every site build, the
          same pattern as the{" "}
          <Link href="/claims" className="text-text underline underline-offset-4 hover:text-cardano">
            claims register
          </Link>
          .
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Live pools", String(stats.livePools)],
            ["Legacy (frozen)", String(stats.legacyPools)],
            ["Risk tier", `Tier ${stats.tier}`],
            ["risk_mult_bps", stats.riskMultBps.toLocaleString("en-US")],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-border bg-white/[0.02] px-4 py-3">
              <dt className="font-mono-label text-[9.5px] text-text-dim">{k}</dt>
              <dd className="mt-1 font-mono text-lg text-text">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {B.entries.map((entry) => (
        <PoolCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
