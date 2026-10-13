"use client";

/**
 * /policy/?id=<policy id | Cardano Buy tx>: one policy's lifecycle across
 * Cardano Preview and Midnight Preprod. Starts from the build-time snapshots
 * (pool UTxOs, Midnight actions, relay records) so it always renders, then
 * upgrades to live reads: Blockfrost for the Buy tx, its 7731 ticket and the
 * reference-token burn; the Midnight indexer for both registries.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { parseTicket } from "@plutusshield/sdk/relay";
import { refTokenName } from "@plutusshield/sdk/cardano";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { MidnightHash } from "@/components/midnight/MidnightHash";
import { BLOCKFROST_ID, BLOCKFROST_URL } from "@/lib/chainRead";
import { PREVIEW, explorerTx } from "@/lib/preview";
import { shortHash } from "@/lib/midnightPreprod";
import { COVER, useCoverChain } from "@/lib/useCoverChain";
import { EXPLOIT, useExploitCoverChain } from "@/lib/useExploitCoverChain";
import { useMidnightActivity } from "@/lib/useMidnightActivity";
import { useMidnightV2Activity } from "@/lib/useMidnightV2Activity";
import { useNow } from "@/lib/useNow";
import {
  V1_CONTRACT,
  V2_CONTRACT,
  buildTimeline,
  findPolicy,
  knownPolicies,
  stagesOf,
  type CardanoLive,
  type KnownPolicy,
  type TimelineEvent,
} from "@/lib/policyTimeline";

export const trackerHref = (id: string) => `/policy/?id=${id}`;

const productLabel: Record<KnownPolicy["product"], string> = {
  depeg: "USDM depeg",
  "exploit-v1": "Exploit · v1 pool",
  "exploit-v2": "Exploit · v2 committee",
};

const fmtAmt = (x: string | null, t: string | null) =>
  x ? `${(Number(x) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${t ?? ""}`.trim() : "—";

const when = (ms: number | null) =>
  ms
    ? new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })
    : "time not recorded";

async function bf<T>(path: string, signal: AbortSignal): Promise<T | null> {
  const r = await fetch(`${BLOCKFROST_URL}${path}`, { headers: { project_id: BLOCKFROST_ID ?? "" }, signal });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Blockfrost ${r.status}`);
  return (await r.json()) as T;
}

/** Live Cardano facts for one policy; null until read or when no Blockfrost id is in this build. */
function useCardanoLive(policy: KnownPolicy | undefined): { live: CardanoLive | null; error: string | null } {
  const [state, setState] = useState<{ id: string; live: CardanoLive | null; error: string | null }>({ id: "", live: null, error: null });
  const id = policy?.policyId ?? "";
  const buyTx = policy?.buyTx ?? null;
  // Script whose (100) reference-token burn closes the policy, for the pools we read live.
  const script = policy?.product === "depeg" ? PREVIEW.scriptHash : policy?.product === "exploit-v2" ? EXPLOIT.scriptHash : null;
  useEffect(() => {
    if (!id || !BLOCKFROST_ID) return;
    const ac = new AbortController();
    (async () => {
      const live: CardanoLive = {};
      if (buyTx) {
        const [tx, md] = await Promise.all([
          bf<{ block_time: number }>(`/txs/${buyTx}`, ac.signal),
          bf<unknown[]>(`/txs/${buyTx}/metadata`, ac.signal),
        ]);
        live.buyAt = tx ? tx.block_time * 1000 : null;
        live.ticket = md ? parseTicket(md) : null;
        if (live.ticket && live.ticket.policyId !== id) live.ticket = null;
      }
      if (script) {
        const hist = await bf<{ tx_hash: string; action: string }[]>(`/assets/${script}${refTokenName(id)}/history`, ac.signal);
        const burn = hist?.find((h) => h.action === "burned");
        if (burn) {
          const t = await bf<{ block_time: number }>(`/txs/${burn.tx_hash}`, ac.signal);
          live.closeTx = { txHash: burn.tx_hash, at: t ? t.block_time * 1000 : null };
        } else live.closeTx = null;
      }
      if (!ac.signal.aborted) setState({ id, live, error: null });
    })().catch((e) => {
      if (!ac.signal.aborted) setState({ id, live: null, error: e instanceof Error ? e.message : String(e) });
    });
    return () => ac.abort();
  }, [id, buyTx, script]);
  return state.id === id ? { live: state.live, error: state.error } : { live: null, error: null };
}

const dotTone: Record<TimelineEvent["tone"], string> = {
  done: "bg-accent",
  paid: "bg-success",
  rejected: "bg-[var(--gold)]",
  pending: "bg-[var(--gold)]",
  info: "bg-border-strong",
};

function TxLink({ e }: { e: TimelineEvent }) {
  if (!e.tx) return null;
  if (e.chain === "cardano")
    return (
      <a
        href={explorerTx(e.tx)}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-[11px] text-text-muted underline underline-offset-4 hover:text-text"
        aria-label={`Transaction ${e.tx} on Cardanoscan Preview`}
      >
        {shortHash(e.tx)} ↗
      </a>
    );
  return <MidnightHash h={e.tx} className="font-mono text-[11px] text-text-muted" />;
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="mt-6">
      {events.map((e, i) => (
        <li key={e.key} className="relative flex gap-4 pb-6 last:pb-0">
          {i < events.length - 1 && <span className="absolute left-[5px] top-4 h-full w-px bg-[var(--hairline)]" aria-hidden="true" />}
          <span className={`relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full ${dotTone[e.tone]}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm text-text">
              <Badge variant={e.chain === "cardano" ? "cardano" : "midnight"}>
                {e.chain === "cardano" ? "Cardano Preview" : `Midnight Preprod${e.registry ? ` · ${e.registry}` : ""}`}
              </Badge>
              <span className="font-medium">{e.title}</span>
            </p>
            {e.detail && <p className="mt-1 break-words text-xs leading-relaxed text-text-muted">{e.detail}</p>}
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-dim">
              <span>{when(e.at)}</span>
              {e.block ? <span className="font-mono">block {e.block.toLocaleString("en-US")}</span> : null}
              <TxLink e={e} />
              <span className="font-mono-label text-[9px]">{e.source === "live" ? "live read" : e.source === "snapshot" ? "build snapshot" : "deployment record"}</span>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Picker({ list, current }: { list: KnownPolicy[]; current?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(current ?? "");
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (q.trim()) router.push(trackerHref(q.trim().toLowerCase().replace(/^0x/, "")));
  };
  return (
    <section aria-labelledby="picker-title" className="glass-panel relative mt-6 p-5 sm:p-8">
      <h2 id="picker-title" className="text-lg font-semibold tracking-tight text-text">
        Track a policy
      </h2>
      <p className="mt-1 text-xs text-text-muted">Paste a policy id or the Cardano Preview Buy tx hash, or pick one of the {list.length} policies this site knows about.</p>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="policy-q" className="sr-only">
          Policy id or Buy tx hash
        </label>
        <input
          id="policy-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="64-hex policy id or Buy tx hash"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-full border border-border bg-white/[0.04] px-4 py-2.5 font-mono text-base text-text placeholder:text-text-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:text-sm"
        />
        <Button type="submit" size="sm">
          Track
        </Button>
      </form>
      <ul className="mt-5 divide-y divide-[var(--hairline)] rounded-2xl border border-[var(--hairline)] bg-white/[0.02]">
        {list.map((p) => (
          <li key={p.policyId}>
            <Link
              href={trackerHref(p.policyId)}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 transition hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="min-w-0 text-xs text-text">
                <span className="font-mono">{shortHash(p.policyId)}</span>
                <span className="ml-2 text-text-dim">{productLabel[p.product]}</span>
              </span>
              <span className="text-[11px] text-text-dim">
                {fmtAmt(p.coverage, p.ticker)} · {p.boughtAt ? new Date(p.boughtAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "date in record"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PolicyTracker() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const chain = useCoverChain();
  const exploitChain = useExploitCoverChain();
  const v1 = useMidnightActivity();
  const v2 = useMidnightV2Activity();
  const now = useNow(30_000);
  const list = useMemo(() => knownPolicies(chain.pool?.policies ?? null, exploitChain.pool?.policies ?? null), [chain.pool, exploitChain.pool]);
  const policy = id ? findPolicy(list, id) : undefined;
  const { live, error } = useCardanoLive(policy);
  const grace = Number((policy?.product === "depeg" ? COVER : EXPLOIT).params.claimGraceMs);

  const events = useMemo(
    () =>
      policy
        ? buildTimeline({
            policy,
            v1Actions: v1.actions,
            v2Actions: v2.actions,
            midnightSource: v1.source === "live" && v2.source === "live" ? "live" : "snapshot",
            cardanoSource: policy.product === "depeg" ? chain.source : exploitChain.source,
            cardanoLive: live,
            claimGraceMs: grace,
          })
        : [],
    [policy, v1.actions, v2.actions, v1.source, v2.source, chain.source, exploitChain.source, live, grace],
  );

  if (!policy)
    return (
      <>
        {id && (
          <p role="alert" className="rounded-xl border border-dashed border-border p-5 text-sm text-text-muted">
            No policy matches <span className="break-all font-mono text-text">{id}</span> in the Preview pool read or the deployment records. Check the id, or pick one below.
          </p>
        )}
        <Picker list={list} current={id} />
      </>
    );

  const { stages, status } = stagesOf(events, policy, now, grace);
  const registries = [events.some((e) => e.registry === "v1") && { tag: "v1", addr: V1_CONTRACT }, events.some((e) => e.registry === "v2") && { tag: "v2", addr: V2_CONTRACT }].filter(Boolean) as {
    tag: string;
    addr: string;
  }[];

  return (
    <>
      <section aria-labelledby="policy-title" className="glass-panel relative p-5 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono-label text-[10px] text-text-dim">{productLabel[policy.product]} policy</p>
            <h2 id="policy-title" className="mt-1 break-all font-mono text-sm text-text sm:text-base">
              {policy.policyId}
            </h2>
          </div>
          <Badge variant={status.startsWith("Paid") || status.includes("approved") ? "accent" : status === "Active" ? "cardano" : "gold"}>{status}</Badge>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-[11px] text-text-dim">Coverage</dt>
            <dd className="font-mono text-text">{fmtAmt(policy.coverage, policy.ticker)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-text-dim">Premium</dt>
            <dd className="font-mono text-text">{fmtAmt(policy.premium, policy.ticker)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-text-dim">Cover starts</dt>
            <dd className="text-xs text-text-muted">{policy.start ? when(policy.start) : "—"}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-text-dim">Expires</dt>
            <dd className="text-xs text-text-muted">{policy.expiry ? when(policy.expiry) : "—"}</dd>
          </div>
        </dl>
        <ol className="mt-6 grid gap-2 sm:grid-cols-4" aria-label="Lifecycle stages">
          {stages.map((s) => (
            <li
              key={s.label}
              className={`rounded-xl border px-3 py-2 text-xs ${
                s.state === "done"
                  ? "border-[color-mix(in_srgb,var(--accent)_35%,transparent)] text-text"
                  : s.state === "current"
                    ? "border-[color-mix(in_srgb,var(--gold)_35%,transparent)] text-gold"
                    : "border-[var(--hairline)] text-text-dim"
              }`}
            >
              {s.state === "done" ? "✓ " : s.state === "current" ? "• " : ""}
              {s.label}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="timeline-title" className="glass-panel relative mt-6 p-5 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="timeline-title" className="text-lg font-semibold tracking-tight text-text">
            Lifecycle
          </h2>
          <p className="text-[11px] text-text-dim" role="status">
            Cardano: {live ? "live (Blockfrost)" : chain.source === "live" ? "live pool read" : "build snapshot"}
            {error ? " · live tx read failed" : ""} · Midnight: {v1.source === "live" && v2.source === "live" ? "live indexer" : "build snapshot"}
          </p>
        </div>
        {events.length ? <Timeline events={events} /> : <p className="mt-4 text-sm text-text-muted">No recorded steps for this policy yet.</p>}
        {registries.length > 0 && (
          <p className="mt-6 flex flex-wrap items-center gap-2 border-t border-[var(--hairline)] pt-4 text-[11px] text-text-dim">
            Midnight registries:
            {registries.map((r) => (
              <span key={r.tag} className="inline-flex items-center gap-1">
                {r.tag} <MidnightHash h={r.addr} kind="contract" className="font-mono text-[11px] text-text-muted" />
              </span>
            ))}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          {(policy.product === "depeg" || policy.product === "exploit-v2") && policy.openOnCardano && (
            <Button href="/cover#my-policies" size="sm">
              Manage in My policies
            </Button>
          )}
          <Button href={policy.product === "depeg" ? "/claim" : `/claim/evidence/?policy=${policy.policyId}`} variant="secondary" size="sm">
            {policy.product === "depeg" ? "Claim checker" : "Seal claim evidence"}
          </Button>
          <Button href="/policy" variant="ghost" size="sm">
            All policies
          </Button>
        </div>
      </section>
    </>
  );
}
