"use client";

/**
 * The live half of /status: one read of each system a buyer or underwriter
 * depends on, through the same hooks the product pages use (useCoverChain +
 * saleCheck like /oracle, the pool readers behind /pool and the exploit Buy,
 * and the Midnight Preprod v2 indexer stream behind /app). Every number is a
 * live read or the build-time snapshot, and says which.
 */
import { useMemo, type ReactNode } from "react";
import type { LivePoolState, LiveTranche } from "@plutusshield/sdk/chain";
import { formatUnits } from "@plutusshield/sdk/cip30";
import { mirrorSummary } from "@plutusshield/sdk/relay";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { MidnightHash } from "@/components/midnight/MidnightHash";
import { PUBLISHES } from "@/components/oracle/OracleLive";
import { CHAIN_API } from "@/lib/chainRead";
import { EXPLOIT_PREVIEW } from "@/lib/exploitPreview";
import { MIDNIGHT_V2 } from "@/lib/midnightPreprodV2";
import { PREVIEW, PREVIEW_ASSETS, explorerAddress, explorerTx } from "@/lib/preview";
import { BUY_WINDOW_MS, saleCheck } from "@/lib/tx/cover";
import { COVER, useCoverChain } from "@/lib/useCoverChain";
import { EXPLOIT, EXPLOIT_COMMITTEE, useExploitCoverChain } from "@/lib/useExploitCoverChain";
import { RELAY_SNAPSHOT } from "@/lib/useMidnightActivity";
import { RELAY_SNAPSHOT_V2, useMidnightV2Activity } from "@/lib/useMidnightV2Activity";
import { useNow } from "@/lib/useNow";

const P = COVER.params;
const THRESHOLD_BPS = Number(P.product.trigger.thresholdBps);
const MAX_AGE_MS = Number(P.saleGuard.maxPriceAgeMs);
const API = CHAIN_API === "blockfrost" ? "Blockfrost" : "Koios";

type Tone = "ok" | "warn" | "down" | "idle";
const toneDot: Record<Tone, string> = {
  ok: "bg-success",
  warn: "bg-gold",
  down: "bg-[var(--danger)]",
  idle: "bg-text-dim animate-pulse-dot",
};
const toneText: Record<Tone, string> = {
  ok: "text-success",
  warn: "text-gold",
  down: "text-[var(--danger)]",
  idle: "text-text-dim",
};

const usd = (bps: number | bigint) => `$${(Number(bps) / 10_000).toFixed(4)}`;
const pct = (bps: bigint) => `${(Number(bps) / 100).toFixed(2)}%`;
const short = (h: string, n = 8) => `${h.slice(0, n)}…${h.slice(-4)}`;
function span(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}
const ago = (ms: number, now: number | null) => (now === null ? "" : now - ms < 60_000 ? "just now" : `${span(now - ms)} ago`);
const unit = (a: { policyId: string; assetName: string }) => a.policyId + a.assetName;
const tickerOf = (t: LiveTranche) => PREVIEW_ASSETS.find((a) => unit(a.asset) === unit(t.asset)) ?? PREVIEW_ASSETS[t.index];

/** "Live read via Blockfrost · 2 min ago" or "Snapshot · Oct 13" for a source chip. */
function sourceChip(source: "live" | "snapshot", at: number, now: number | null, via = API) {
  if (source === "live") return `Live via ${via}${now === null ? "" : ` · ${ago(at, now)}`}`;
  return now === null ? "Snapshot" : `Snapshot · ${ago(at, now)}`;
}

export function StatusBoard() {
  const chain = useCoverChain();
  const exploit = useExploitCoverChain();
  const v2 = useMidnightV2Activity();
  const now = useNow(15_000);

  const sale = useMemo(() => (chain.feeds && now !== null ? saleCheck(P, chain.feeds, now + BUY_WINDOW_MS) : null), [chain.feeds, now]);
  const readings = sale?.feeds.flatMap((f) => ("reading" in f ? [f.reading] : [])) ?? [];
  const lowest = readings.length ? readings.reduce((a, b) => (b.priceBps < a.priceBps ? b : a)) : null;
  const newestWindow = readings.length ? Math.max(...readings.map((r) => Number(r.windowEnd))) : null;
  const openFor = sale?.ok && sale.freshUntil && now !== null ? sale.freshUntil - BUY_WINDOW_MS - now : null;

  const salesTone: Tone = !sale ? (chain.feedError ? "down" : "idle") : sale.ok ? "ok" : sale.feeds.some((f) => f.state === "depeg") ? "down" : "warn";
  const salesLabel = !sale ? (chain.feedError ? "Unreachable" : "Checking") : sale.ok ? "Sales open" : sale.feeds.some((f) => f.state === "depeg") ? "Paused · depeg" : "Paused · stale";

  const poolTone: Tone = chain.pool ? (chain.source === "live" ? "ok" : chain.error ? "warn" : "idle") : "down";
  const exploitTone: Tone = exploit.pool ? (exploit.source === "live" ? "ok" : exploit.error ? "warn" : "idle") : "down";
  const midTone: Tone = v2.source === "live" ? "ok" : v2.error ? "warn" : "idle";

  const plan = RELAY_SNAPSHOT_V2.policies.length ? RELAY_SNAPSHOT_V2.policies : RELAY_SNAPSHOT.policies;
  const relay = plan.length
    ? mirrorSummary(plan.map((p) => ({ state: v2.isMirrored(p.policyId) ? ("mirrored" as const) : p.state === "mirrored" ? ("ready" as const) : p.state })))
    : null;
  const lastAction = [...v2.actions].filter((a) => a.status === "SUCCESS").sort((a, b) => b.height - a.height)[0];
  const paidClaims = MIDNIGHT_V2.claims.filter((c) => c.decided === "PAID").length;
  const lastPublish = PUBLISHES.at(-1);

  const systems: { name: string; chain: "cardano" | "midnight"; tone: Tone; label: string; href: string }[] = [
    { name: "Depeg cover sales", chain: "cardano", tone: salesTone, label: salesLabel, href: "#sales" },
    { name: "Depeg underwriting pool", chain: "cardano", tone: poolTone, label: poolTone === "ok" ? "Read live" : poolTone === "warn" ? "Snapshot" : poolTone === "down" ? "No data" : "Reading", href: "#depeg-pool" },
    { name: "Exploit-cover pool v2", chain: "cardano", tone: exploitTone, label: exploitTone === "ok" ? "Read live" : exploitTone === "warn" ? "Snapshot" : exploitTone === "down" ? "No data" : "Reading", href: "#exploit-pool" },
    { name: "Midnight policy registry v2", chain: "midnight", tone: midTone, label: midTone === "ok" ? "Indexer live" : midTone === "warn" ? "Snapshot" : "Connecting", href: "#midnight" },
  ];
  const settled = systems.every((s) => s.tone !== "idle");
  const allOk = systems.every((s) => s.tone === "ok");
  const headline = !settled
    ? "Checking each system on Preview and Preprod…"
    : allOk
      ? "Every system is up on Cardano Preview and Midnight Preprod"
      : salesTone !== "ok" && systems.slice(1).every((s) => s.tone === "ok")
        ? "Cover sales are paused; everything else is running"
        : "Some live reads are down, so parts of this page show the last snapshot";

  return (
    <div className="space-y-6">
      <section
        className={`card-surface p-6 sm:p-8 ${settled && allOk ? "ring-1 ring-[color-mix(in_srgb,var(--success)_25%,transparent)]" : settled ? "ring-1 ring-[color-mix(in_srgb,var(--gold)_35%,transparent)]" : ""}`}
        aria-labelledby="status-now"
        role="status"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="cardano">Cardano Preview</Badge>
          <Badge variant="midnight">Midnight Preprod</Badge>
          <Badge variant="gold">Testnet only</Badge>
          <Badge>Not audited</Badge>
        </div>
        <h2 id="status-now" className="mt-5 font-display text-[1.9rem] leading-[1.06] text-text sm:text-[2.4rem] text-balance">
          {headline}
        </h2>
        <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-text-muted text-pretty">
          Your browser reads each system itself: the oracle feeds and both Cardano pools from the Preview ledger, the Midnight
          registry from the Preprod indexer. Nothing here is a status flag someone sets by hand. Where a live read fails, the
          card falls back to the snapshot taken when the site was built and says so.
        </p>
        <ul className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {systems.map((s) => (
            <li key={s.name}>
              <a
                href={s.href}
                className="block h-full rounded-2xl border border-[var(--hairline)] bg-black/25 p-4 transition-colors hover:border-[var(--border-accent)]"
              >
                <p className={`font-mono-label text-[9.5px] ${s.chain === "cardano" ? "text-cardano" : "text-midnight"}`}>
                  {s.chain === "cardano" ? "Cardano Preview" : "Midnight Preprod"}
                </p>
                <p className="mt-1.5 text-[14px] text-text">{s.name}</p>
                <p className={`mt-3 flex items-center gap-1.5 text-[12.5px] ${toneText[s.tone]}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${toneDot[s.tone]}`} aria-hidden />
                  {s.label}
                </p>
              </a>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void Promise.all([chain.refresh(), exploit.refresh()])}
            disabled={chain.loading || exploit.loading}
          >
            {chain.loading || exploit.loading ? "Reading…" : "↻ Read Cardano again"}
          </Button>
          <p className="text-[11.5px] text-text-dim">The Midnight registry streams on its own; no refresh needed.</p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          id="sales"
          chain="cardano"
          eyebrow="Oracle + sale circuit-breaker"
          title="Depeg cover sales"
          tone={salesTone}
          chip={chain.feeds ? sourceChip("live", chain.at.getTime(), now) : chain.feedError ? "Live read failed" : "Reading"}
          footer={
            <>
              <Button href="/oracle" variant="secondary" size="sm">
                Live oracle →
              </Button>
              <Button href="/cover" variant="ghost" size="sm">
                Buy cover
              </Button>
            </>
          }
        >
          <p className="text-[13.5px] leading-relaxed text-text-muted">
            {sale && sale.ok && openFor !== null
              ? `All ${sale.feeds.length} allowlisted USDM feeds hold a healthy reading. A Buy signed now is accepted for ${span(openFor)} more on the current readings; the relay republishes well before then.`
              : sale && !sale.ok
                ? `The validator only sells when every feed has a healthy reading under ${span(MAX_AGE_MS)} old. Blocked: ${sale.blocked.join(", ")}. Sales reopen by themselves after the next healthy publish.`
                : chain.feedError
                  ? `Couldn't read the oracle feeds: ${chain.feedError}. The publish record below is still real.`
                  : "Decoding each feed's inline datum with the same code the Buy runs."}
          </p>
          <dl className="mt-5 grid grid-cols-2 gap-4 text-[12.5px] sm:grid-cols-3">
            <Stat k="Lowest feed TWAP" v={lowest ? usd(lowest.priceBps) : "—"} sub={lowest ? `${Number(lowest.priceBps).toLocaleString("en-US")} bps` : undefined} />
            <Stat k="Claim trigger" v={`< ${usd(THRESHOLD_BPS)}`} sub={`${THRESHOLD_BPS.toLocaleString("en-US")} bps`} />
            <Stat
              k="Freshness window"
              v={span(MAX_AGE_MS)}
              sub={newestWindow !== null && now !== null ? `newest window ended ${ago(newestWindow, now)}` : undefined}
            />
          </dl>
          {lastPublish ? (
            <p className="mt-4 text-[12px] text-text-dim">
              Last publish in the site record: {usd(lastPublish.bps)} ·{" "}
              <a href={explorerTx(lastPublish.tx)} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline">
                {short(lastPublish.tx)} ↗
              </a>
              {now !== null ? ` · ${ago(Date.parse(lastPublish.at), now)}` : ""}
            </p>
          ) : null}
        </Card>

        <Card
          id="depeg-pool"
          chain="cardano"
          eyebrow="cover.ak · ADA + USDC tranches"
          title="Depeg underwriting pool"
          tone={poolTone}
          chip={sourceChip(chain.source, chain.at.getTime(), now)}
          footer={
            <>
              <Button href="/pool" variant="secondary" size="sm">
                Open the pool →
              </Button>
              <Button href={explorerAddress(PREVIEW.poolAddress)} external variant="ghost" size="sm">
                Pool address ↗
              </Button>
            </>
          }
        >
          <PoolTranches pool={chain.pool} now={now} cap={PREVIEW.maxUtilizationBps} />
          <p className="mt-4 text-[12px] leading-relaxed text-text-dim">
            Active cover can never pass {pct(PREVIEW.maxUtilizationBps)} of a tranche&apos;s capital; the validator refuses any Buy or
            withdrawal that would.
            {chain.source === "snapshot" && chain.error ? ` Live read failed (${chain.error}), so this is the build snapshot.` : ""}
          </p>
        </Card>

        <Card
          id="exploit-pool"
          chain="cardano"
          eyebrow={`exploit_cover.ak v2 · ${EXPLOIT_PREVIEW.quorumLabel} committee`}
          title="Exploit-cover pool"
          tone={exploitTone}
          chip={sourceChip(exploit.source, exploit.at.getTime(), now)}
          footer={
            <>
              <Button href="/cover#buy-exploit" variant="secondary" size="sm">
                Buy exploit cover →
              </Button>
              <Button href="/assessors" variant="ghost" size="sm">
                Assessors
              </Button>
            </>
          }
        >
          <PoolTranches pool={exploit.pool} now={now} cap={EXPLOIT.maxUtilizationBps} />
          <p className="mt-4 text-[12px] leading-relaxed text-text-dim">
            No oracle here: a payout needs {EXPLOIT_COMMITTEE.threshold} of {EXPLOIT_COMMITTEE.seats} assessor-committee signatures,
            each given only after the claim is decided PAID on Midnight. The seats are team-run today; independent assessors can
            enroll on /assessors. Claims paid from this pool so far: {EXPLOIT_PREVIEW.policies.filter((p) => p.settleTx).length} (deployment record).
            {exploit.source === "snapshot" && exploit.error ? ` Live read failed (${exploit.error}), so this is the build snapshot.` : ""}
          </p>
        </Card>

        <Card
          id="midnight"
          chain="midnight"
          eyebrow={`policy-cover v2 · ${MIDNIGHT_V2.compiler}`}
          title="Midnight policy registry"
          tone={midTone}
          chip={v2.source === "live" ? `Live via Preprod indexer${now === null ? "" : ` · ${ago(v2.asOf, now)}`}` : now === null ? "Snapshot" : `Snapshot · ${ago(v2.asOf, now)}`}
          footer={
            <>
              <Button href="/app" variant="secondary" size="sm">
                Registry activity →
              </Button>
              <Button href="/claim/evidence" variant="ghost" size="sm">
                Evidence vault
              </Button>
            </>
          }
        >
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Mirrored", v2.calls.registerPolicy ?? 0],
              ["Cover proofs", v2.calls.proveCover ?? 0],
              ["Claims filed", v2.calls.fileClaim ?? 0],
              ["Committee votes", v2.calls.voteClaim ?? 0],
            ].map(([k, v]) => (
              <div key={k} className="rounded-2xl border border-[var(--hairline)] bg-black/25 px-3.5 py-3">
                <dt className="font-mono-label text-[9px] text-text-dim">{k}</dt>
                <dd className="mt-0.5 font-display text-2xl tabular-nums text-text">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[13px] leading-relaxed text-text-muted">
            {relay ? `${relay.mirrored} of ${relay.mirrorable} mirrorable Cardano Preview policies are in the registry. ` : ""}
            Claims are decided by a {MIDNIGHT_V2.quorumLabel} assessor committee; {paidClaims} committee decision{paidClaims === 1 ? "" : "s"} marked PAID so far
            (deployment record). Amounts and holders never appear on the ledger.
          </p>
          <div className="mt-4 space-y-1.5 text-[11.5px] text-text-dim">
            {MIDNIGHT_V2.contractAddress ? (
              <p className="flex flex-wrap items-baseline gap-x-2">
                Contract <MidnightHash h={MIDNIGHT_V2.contractAddress} kind="contract" className="font-mono text-[11px] text-text-muted" />
              </p>
            ) : null}
            {lastAction ? (
              <p className="flex flex-wrap items-baseline gap-x-2">
                Latest call <span className="text-text-muted">{lastAction.entryPoint}</span>
                <MidnightHash h={lastAction.txHash} className="font-mono text-[11px] text-text-muted" />
                {now !== null ? <span>· {ago(lastAction.timestamp, now)}</span> : null}
              </p>
            ) : null}
            {v2.source === "snapshot" && v2.error ? <p>Indexer unreachable ({v2.error}); retrying with backoff.</p> : null}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Card({
  id,
  chain,
  eyebrow,
  title,
  tone,
  chip,
  footer,
  children,
}: {
  id: string;
  chain: "cardano" | "midnight";
  eyebrow: string;
  title: string;
  tone: Tone;
  chip: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="card-surface flex scroll-mt-24 flex-col p-6 sm:p-7" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`font-mono-label text-[9.5px] ${chain === "cardano" ? "text-cardano" : "text-midnight"}`}>{eyebrow}</p>
        <Badge>
          <span className={`h-1.5 w-1.5 rounded-full ${toneDot[tone]}`} aria-hidden />
          {chip}
        </Badge>
      </div>
      <h2 id={`${id}-title`} className="mt-3 font-display text-[1.6rem] leading-tight text-text">
        {title}
      </h2>
      <div className="mt-3 flex-1">{children}</div>
      <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--hairline)] pt-5">{footer}</div>
    </section>
  );
}

function Stat({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div>
      <dt className="font-mono-label text-[9.5px] text-text-dim">{k}</dt>
      <dd className="mt-1 font-display text-[1.35rem] leading-none text-text">{v}</dd>
      {sub ? <dd className="mt-1.5 text-[11px] text-text-dim">{sub}</dd> : null}
    </div>
  );
}

function PoolTranches({ pool, now, cap }: { pool: LivePoolState | null; now: number | null; cap: bigint }) {
  if (!pool) return <p className="text-[13px] text-[var(--danger)]">No pool data: neither the live read nor the snapshot decoded.</p>;
  const t = now === null ? null : BigInt(now);
  const active = t === null ? null : pool.policies.filter((p) => p.policy.start <= t && t < p.policy.expiry).length;
  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2">
        {pool.tranches.map((tr) => {
          const a = tickerOf(tr);
          const f = (x: bigint) => formatUnits(x, a.decimals, 2);
          const w = Math.min(100, Number(tr.utilizationBps) / 100);
          return (
            <li key={tr.index} className="rounded-2xl border border-[var(--hairline)] bg-black/25 p-4">
              <p className="font-mono-label text-[9.5px] text-text-dim">{a.ticker} tranche</p>
              <p className="mt-1.5 font-display text-[1.45rem] leading-none text-text">
                {f(tr.capital)} <span className="text-[13px] text-text-muted">{a.ticker}</span>
              </p>
              <p className="mt-2 text-[11.5px] text-text-dim">
                {f(tr.activeCover)} active cover · {pct(tr.utilizationBps)} used
              </p>
              <div
                className="relative mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"
                role="img"
                aria-label={`Utilization ${pct(tr.utilizationBps)} of a ${pct(cap)} cap`}
              >
                <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]" style={{ width: `${Math.max(w, 0.8)}%` }} />
                <div className="absolute inset-y-0 w-px bg-[var(--danger)]/70" style={{ left: `${Number(cap) / 100}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[12px] text-text-muted">
        {pool.policies.length} {pool.policies.length === 1 ? "policy" : "policies"} at the script{active !== null ? `, ${active} in force right now` : ""}.
      </p>
    </>
  );
}
