"use client";

/**
 * The connected wallet's policies on Cardano Preview: every policy-datum UTxO
 * at the cover script whose user token this wallet holds, or whose refund
 * address is this wallet. Decoded with the SDK from the datum bytes.
 */
import { useMemo } from "react";
import { useNow } from "@/lib/useNow";
import { Badge } from "@/components/ui/Badge";
import { WalletButton } from "@/components/wallet/WalletButton";
import { formatUnits } from "@plutusshield/sdk/cip30";
import { useWallet } from "@/lib/wallet";
import { PREVIEW, PREVIEW_ASSETS, explorerTx } from "@/lib/preview";
import { walletPolicies, type PolicyStatus, type WalletPolicy } from "@/lib/tx/cover";
import { COVER, type CoverChain } from "@/lib/useCoverChain";
import { PolicyAction } from "./PolicyAction";

const statusCopy: Record<PolicyStatus, { label: string; variant: "gold" | "accent" | "midnight" | "default" }> = {
  waiting: { label: "Waiting period", variant: "gold" },
  active: { label: "Active", variant: "accent" },
  claimable: { label: "Claim window", variant: "midnight" },
  expired: { label: "Expired", variant: "default" },
};

const when = (ms: bigint) =>
  new Date(Number(ms)).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

function untilText(ms: number) {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 90) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
}

/** Hook form, for summary cards elsewhere (e.g. /app). */
export function useMyPolicies(chain: CoverChain): { policies: WalletPolicy[] | null; now: number } {
  const w = useWallet();
  const now = useNow(30_000);
  const policies = useMemo(() => {
    if (w.status !== "connected" || !w.balance || !chain.pool || now === null) return null;
    return walletPolicies(
      chain.pool.policies,
      PREVIEW.scriptHash,
      { units: w.balance.assets.keys(), paymentHash: w.address?.paymentHash },
      BigInt(now),
      COVER.params.claimGraceMs,
    );
  }, [w.status, w.balance, w.address, chain.pool, now]);
  return { policies, now: now ?? 0 };
}

export function MyPolicies({ chain }: { chain: CoverChain }) {
  const w = useWallet();
  const { policies, now } = useMyPolicies(chain);
  const connected = w.status === "connected";

  return (
    <section id="my-policies" aria-labelledby="my-policies-title" className="glass-panel relative mt-6 scroll-mt-24 p-5 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="my-policies-title" className="text-lg font-semibold tracking-tight text-text">My policies</h2>
          <p className="mt-1 text-xs text-text-muted">
            Read from the policy datums at the cover script on Preview{chain.source === "snapshot" ? " (build snapshot; live read unavailable)" : ""}. Policies you
            hold the claim token for, or bought from this wallet.
          </p>
        </div>
        {connected && (
          <button
            type="button"
            onClick={() => void chain.refresh()}
            disabled={chain.loading}
            className="rounded-full border border-border bg-white/[0.04] px-4 py-2 text-xs text-text transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            {chain.loading ? "Reading…" : "Refresh"}
          </button>
        )}
      </div>

      {!connected ? (
        <div className="mt-5 flex flex-wrap items-center gap-4 rounded-xl border border-dashed border-border p-5">
          <p className="text-sm text-text-muted">Connect a Preview wallet to see the cover it holds.</p>
          <WalletButton />
        </div>
      ) : policies === null ? (
        <p className="mt-5 text-sm text-text-muted">Reading your policies…</p>
      ) : policies.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-border p-5 text-sm text-text-muted">
          No policies for this wallet yet. Buy one above; it shows up here once its transaction is in a block.
        </p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <caption className="sr-only">Your PlutusShield policies on Cardano Preview</caption>
            <thead className="text-xs text-text-dim">
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-4 font-normal">Coverage</th>
                <th scope="col" className="py-2 pr-4 font-normal">Premium paid</th>
                <th scope="col" className="py-2 pr-4 font-normal">Cover period</th>
                <th scope="col" className="py-2 pr-4 font-normal">Status</th>
                <th scope="col" className="py-2 pr-4 font-normal">Bought in</th>
                <th scope="col" className="py-2 font-normal">Action</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => {
                const a = PREVIEW_ASSETS[p.tranche];
                const f = (x: bigint) => formatUnits(x, a.decimals, 2);
                const s = statusCopy[p.status];
                const [hash] = p.ref.split("#");
                const sub =
                  p.status === "waiting"
                    ? `starts in ${untilText(Number(p.policy.start) - now)}`
                    : p.status === "active"
                      ? `${untilText(Number(p.policy.expiry) - now)} left`
                      : p.status === "claimable"
                        ? `claims close in ${untilText(Number(p.policy.expiry + COVER.params.claimGraceMs) - now)}`
                        : "capacity can be released";
                return (
                  <tr key={p.ref} className="border-b border-border/60 align-top last:border-0">
                    <td className="py-3 pr-4">
                      <span className="font-mono text-text">{f(p.policy.coverage)}</span>{" "}
                      <span className="text-xs text-text-dim">{a.ticker}</span>
                      <span className="mt-0.5 block text-[11px] text-text-dim">USDM depeg · paid in {a.symbol}</span>
                    </td>
                    <td className="py-3 pr-4 font-mono text-text-muted">
                      {f(p.policy.premium)} <span className="text-xs text-text-dim">{a.ticker}</span>
                    </td>
                    <td className="py-3 pr-4 text-xs text-text-muted">
                      {when(p.policy.start)}
                      <span className="block text-text-dim">to {when(p.policy.expiry)}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <Badge variant={s.variant}>{s.label}</Badge>
                      <span className="mt-1 block text-[11px] text-text-dim">{sub}</span>
                      {!p.holder && <span className="mt-0.5 block text-[11px] text-[var(--gold)]">Claim token isn&apos;t in this wallet</span>}
                    </td>
                    <td className="py-3 pr-4">
                      <a
                        href={explorerTx(hash)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs text-text-muted underline underline-offset-4 hover:text-text"
                        aria-label={`Purchase transaction ${hash} on Cardanoscan Preview`}
                      >
                        {hash.slice(0, 8)}…{hash.slice(-6)} ↗
                      </a>
                    </td>
                    <td className="py-3">
                      <PolicyAction p={p} chain={chain} now={now} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] leading-relaxed text-text-dim">
            Claims settle on Cardano: when {Number(COVER.params.oracle.quorum)} of {COVER.params.oracle.feeds.length} oracle feeds attest a depeg inside a policy&apos;s
            cover period, its holder files the claim here and the coverage is paid from the tranche in the same transaction. Unclaimed
            policies can be released by anyone once the claim grace ends; the deposit always returns to the buyer. Settled and released
            policies burn their tokens and leave this list. The Midnight private registry for holders is built and tested but not yet
            connected to this flow.
          </p>
        </div>
      )}
    </section>
  );
}
