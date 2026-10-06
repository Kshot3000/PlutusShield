"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { CurrencyMark } from "@/components/ui/ChoiceGroup";
import { readPoolState, type ChainUtxo, type LivePoolState } from "@plutusshield/sdk/chain";
import { CHAIN_API, fetchPreviewUtxos } from "@/lib/chainRead";
import { formatUnits } from "@plutusshield/sdk/cip30";
import { PREVIEW, PREVIEW_ASSETS, explorerAddress, explorerTx } from "@/lib/preview";
import snapshot from "@/data/preview-pool-snapshot.json";
import { LpPanel } from "@/components/pool/LpPanel";

type Source = { kind: "live"; at: Date } | { kind: "snapshot"; at: Date; reason?: string };

const assets = PREVIEW_ASSETS.map((a) => a.asset);
const read = (utxos: ChainUtxo[]) => readPoolState(utxos, PREVIEW.scriptHash, assets, PREVIEW.maxUtilizationBps);

function initial(): { state: LivePoolState | null; error: string | null } {
  try {
    return { state: read(snapshot.utxos as ChainUtxo[]), error: null };
  } catch (e) {
    return { state: null, error: e instanceof Error ? e.message : String(e) };
  }
}

const pctBps = (bps: bigint, d = 2) => `${(Number(bps) / 100).toFixed(d)}%`;
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;
const day = (ms: bigint) =>
  new Date(Number(ms)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const ago = (d: Date) => {
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

function Bar({ bps }: { bps: bigint }) {
  const w = Math.min(100, Number(bps) / 100);
  const cap = Number(PREVIEW.maxUtilizationBps) / 100;
  return (
    <div className="relative h-2 overflow-hidden rounded-full bg-white/[0.06]" role="img" aria-label={`Utilization ${pctBps(bps)} of a ${cap}% cap`}>
      <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]" style={{ width: `${Math.max(w, 0.8)}%` }} />
      <div className="absolute inset-y-0 w-px bg-[var(--danger)]/70" style={{ left: `${cap}%` }} />
    </div>
  );
}

export function LivePool() {
  const [{ state, error }, setView] = useState(initial);
  const [source, setSource] = useState<Source>({ kind: "snapshot", at: new Date(snapshot.takenAt) });
  const [loading, setLoading] = useState(false);
  const [, tick] = useState(0);
  // Time-relative copy (ages, policy status) only after mount, so the static HTML hydrates cleanly.
  const [mounted, setMounted] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const utxos = await fetchPreviewUtxos(PREVIEW.poolAddress, signal);
      setView({ state: read(utxos), error: null });
      setSource({ kind: "live", at: new Date() });
    } catch (e) {
      if (signal?.aborted) return;
      setSource((s) => ({ kind: "snapshot", at: s.kind === "snapshot" ? s.at : new Date(snapshot.takenAt), reason: e instanceof Error ? e.message : String(e) }));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setMounted(true);
    void refresh(ac.signal);
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => (ac.abort(), clearInterval(t));
  }, [refresh]);

  const now = BigInt(mounted ? Date.now() : new Date(snapshot.takenAt).getTime());
  const policies = useMemo(() => state?.policies ?? [], [state]);

  return (
    <section aria-labelledby="live-pool" className="glass-panel relative mb-10 rounded-[1.6rem] p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="cardano">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--cardano)]" aria-hidden />
              Live on Cardano Preview
            </Badge>
            <Badge>{source.kind === "live" ? `Read from chain via ${CHAIN_API === "blockfrost" ? "Blockfrost" : "Koios"} · ${ago(source.at)}` : mounted ? `Snapshot · ${ago(source.at)}` : "Snapshot"}</Badge>
          </div>
          <h2 id="live-pool" className="mt-3 text-xl font-semibold tracking-tight text-text sm:text-2xl">
            The real pool, read straight from the ledger
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">
            Your browser finds the UTxO holding the pool NFT, decodes its inline datum with the PlutusShield SDK, and
            shows each tranche exactly as the validator sees it. Testnet funds only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded-full border border-border bg-white/[0.04] px-4 py-2 text-xs text-text transition hover:bg-white/[0.08] disabled:opacity-50"
          >
            {loading ? "Reading…" : "Refresh"}
          </button>
          <a
            href={explorerAddress(PREVIEW.poolAddress)}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-border px-4 py-2 text-xs text-text-muted transition hover:text-text"
          >
            Pool address ↗
          </a>
        </div>
      </div>

      {error || !state ? (
        <p className="mt-6 rounded-lg border border-[color-mix(in_srgb,var(--danger)_40%,var(--border))] p-4 text-sm text-[var(--danger)]">
          Couldn&apos;t read the pool: {error ?? "no data"}.
        </p>
      ) : (
        <>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {state.tranches.map((t) => {
              const a = PREVIEW_ASSETS[t.index];
              const f = (x: bigint) => formatUnits(x, a.decimals, 2);
              return (
                <div key={t.index} className="rounded-[1.2rem] border border-border bg-white/[0.02] p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <CurrencyMark currency={a.symbol} />
                      <div>
                        <p className="text-sm font-semibold text-text">{a.ticker} tranche</p>
                        <p className="font-mono-label text-[10px] text-text-dim">LP token {a.lpToken}</p>
                      </div>
                    </div>
                    <p className="text-right">
                      <span className="block font-mono text-lg text-text">{f(t.capital)}</span>
                      <span className="font-mono-label text-[10px] text-text-dim">capital</span>
                    </p>
                  </div>
                  <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                    {[
                      ["Active cover", `${f(t.activeCover)} ${a.ticker}`],
                      ["Free capacity", `${f(t.freeCapacity)} ${a.ticker}`],
                      ["LP shares", f(t.totalShares)],
                      ["Share price", (Number(t.sharePriceMicro) / 1e6).toFixed(6)],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-xs text-text-dim">{k}</dt>
                        <dd className="font-mono text-text">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-5">
                    <div className="mb-2 flex justify-between text-xs text-text-dim">
                      <span>Utilization {pctBps(t.utilizationBps)}</span>
                      <span>cap {pctBps(PREVIEW.maxUtilizationBps, 0)}</span>
                    </div>
                    <Bar bps={t.utilizationBps} />
                  </div>
                </div>
              );
            })}
          </div>

          <LpPanel tranches={state.tranches} onConfirmed={() => void refresh()} />

          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <caption className="mb-3 text-left font-mono-label text-[10px] text-text-dim">
                Policies on-chain ({policies.length})
              </caption>
              <thead className="text-xs text-text-dim">
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 pr-4 font-normal">Cover</th>
                  <th scope="col" className="py-2 pr-4 font-normal">Premium</th>
                  <th scope="col" className="py-2 pr-4 font-normal">Term (UTC)</th>
                  <th scope="col" className="py-2 pr-4 font-normal">Status</th>
                  <th scope="col" className="py-2 font-normal">Reference</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => {
                  const a = PREVIEW_ASSETS[p.tranche];
                  const f = (x: bigint) => formatUnits(x, a.decimals, 2);
                  const live = p.policy.start <= now && now < p.policy.expiry;
                  const waiting = now < p.policy.start;
                  const [hash] = p.ref.split("#");
                  return (
                    <tr key={p.ref} className="border-b border-border/60 last:border-0">
                      <td className="py-2.5 pr-4 font-mono text-text">{f(p.policy.coverage)} {a.ticker}</td>
                      <td className="py-2.5 pr-4 font-mono text-text-muted">{f(p.policy.premium)} {a.ticker}</td>
                      <td className="py-2.5 pr-4 text-text-muted">{day(p.policy.start)} – {day(p.policy.expiry)}</td>
                      <td className="py-2.5 pr-4">
                        <Badge variant={live ? "accent" : waiting ? "gold" : "default"}>
                          {live ? "Active" : waiting ? "Waiting period" : "Expired"}
                        </Badge>
                      </td>
                      <td className="py-2.5">
                        <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className="font-mono text-xs text-text-muted underline underline-offset-4 hover:text-text">
                          {short(hash)} ↗
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-[11px] leading-relaxed text-text-dim">
            Pool UTxO{" "}
            <a href={explorerTx(state.poolRef.split("#")[0])} target="_blank" rel="noreferrer" className="font-mono underline underline-offset-4 hover:text-text">
              {short(state.poolRef)}
            </a>{" "}
            · script {short(PREVIEW.scriptHash)} · oracle quorum {PREVIEW.oracleQuorum} · initialised in{" "}
            <a href={explorerTx(PREVIEW.initTx)} target="_blank" rel="noreferrer" className="font-mono underline underline-offset-4 hover:text-text">
              {short(PREVIEW.initTx)}
            </a>
            .{source.kind === "snapshot" && source.reason ? " Live read unavailable right now, so this is the snapshot taken when the site was built." : ""}
          </p>
        </>
      )}
    </section>
  );
}
