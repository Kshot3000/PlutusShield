"use client";

/**
 * The connected wallet's policies on Cardano Preview, across both pools: every
 * policy-datum UTxO at the USDM depeg cover script (cover.ak) or the
 * exploit-cover v2 script (exploit_cover.ak, 2-of-3 assessor committee) whose
 * user token this wallet holds, or whose refund address is this wallet.
 * Decoded with the SDK from the datum bytes. Each row carries its product, so
 * the action is the right one: oracle Settle for depeg, a Midnight claim for
 * exploit cover.
 */
import Link from "next/link";
import { useMemo } from "react";
import { useNow } from "@/lib/useNow";
import { Badge } from "@/components/ui/Badge";
import { WalletButton } from "@/components/wallet/WalletButton";
import { formatUnits } from "@plutusshield/sdk/cip30";
import { useWallet } from "@/lib/wallet";
import { PREVIEW, PREVIEW_ASSETS, explorerTx } from "@/lib/preview";
import { walletPolicies, type PolicyStatus, type WalletPolicy } from "@/lib/tx/cover";
import { COVER, type CoverChain } from "@/lib/useCoverChain";
import { EXPLOIT, EXPLOIT_COMMITTEE, type ExploitCoverChain } from "@/lib/useExploitCoverChain";
import { PolicyAction } from "./PolicyAction";
import { ExploitPolicyAction } from "./ExploitPolicyAction";
import { MidnightKeyCell } from "./MidnightKey";

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

export type CoverProduct = "depeg" | "exploit-v2";

/** A wallet policy plus which Preview pool (and so which claim path) it belongs to. */
export interface MyPolicy extends WalletPolicy {
  product: CoverProduct;
}

export const PRODUCT_COPY: Record<CoverProduct, { label: string; short: string; badge: "cardano" | "midnight" }> = {
  depeg: { label: "USDM depeg", short: "Depeg", badge: "cardano" },
  "exploit-v2": { label: `Smart-contract exploit · v2 committee (${EXPLOIT_COMMITTEE.threshold}-of-${EXPLOIT_COMMITTEE.seats})`, short: "Exploit", badge: "midnight" },
};

export const claimGraceOf = (product: CoverProduct) => (product === "depeg" ? COVER.params.claimGraceMs : EXPLOIT.params.claimGraceMs);

/**
 * Hook form, for summary cards elsewhere (e.g. /app): the wallet's policies in
 * both pools, newest cover first. `null` until a wallet is connected and read.
 */
export function useMyPolicies(chain: CoverChain, exploit: ExploitCoverChain): { policies: MyPolicy[] | null; now: number } {
  const w = useWallet();
  const now = useNow(30_000);
  const policies = useMemo(() => {
    if (w.status !== "connected" || !w.balance || now === null || (!chain.pool && !exploit.pool)) return null;
    const wallet = { units: [...w.balance.assets.keys()], paymentHash: w.address?.paymentHash };
    const t = BigInt(now);
    const depeg: MyPolicy[] = chain.pool
      ? walletPolicies(chain.pool.policies, PREVIEW.scriptHash, wallet, t, COVER.params.claimGraceMs).map((p) => ({ ...p, product: "depeg" }))
      : [];
    const exp: MyPolicy[] = exploit.pool
      ? walletPolicies(exploit.pool.policies, EXPLOIT.scriptHash, wallet, t, EXPLOIT.params.claimGraceMs).map((p) => ({ ...p, product: "exploit-v2" }))
      : [];
    return [...depeg, ...exp].sort((a, b) => Number(b.policy.start - a.policy.start));
  }, [w.status, w.balance, w.address, chain.pool, exploit.pool, now]);
  return { policies, now: now ?? 0 };
}

export function MyPolicies({ chain, exploit }: { chain: CoverChain; exploit: ExploitCoverChain }) {
  const w = useWallet();
  const { policies, now } = useMyPolicies(chain, exploit);
  const connected = w.status === "connected";
  const loading = chain.loading || exploit.loading;
  const snapshots = [chain.source === "snapshot" && "depeg", exploit.source === "snapshot" && "exploit"].filter(Boolean) as string[];
  const errors = [chain.error && `depeg pool: ${chain.error}`, exploit.error && `exploit pool: ${exploit.error}`].filter(Boolean) as string[];
  const counts = policies && { depeg: policies.filter((p) => p.product === "depeg").length, exploit: policies.filter((p) => p.product === "exploit-v2").length };

  return (
    <section id="my-policies" aria-labelledby="my-policies-title" className="glass-panel relative mt-6 scroll-mt-24 p-5 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="my-policies-title" className="text-lg font-semibold tracking-tight text-text">My policies</h2>
          <p className="mt-1 text-xs text-text-muted">
            Read from the policy datums at both Preview cover scripts: the USDM depeg pool and the smart-contract exploit v2 pool
            {snapshots.length ? ` (${snapshots.join(" and ")} from the build snapshot; live read unavailable)` : ""}. Policies you hold the
            claim token for, or bought from this wallet.
          </p>
          {counts && (counts.depeg > 0 || counts.exploit > 0) && (
            <p className="mt-1 text-[11px] text-text-dim">
              {counts.depeg} depeg · {counts.exploit} exploit
            </p>
          )}
          {errors.length > 0 && <p className="mt-1 text-[11px] text-[var(--gold)]">Live read failed for the {errors.join("; ")}</p>}
        </div>
        {connected && (
          <button
            type="button"
            onClick={() => void Promise.all([chain.refresh(), exploit.refresh()])}
            disabled={loading}
            className="rounded-full border border-border bg-white/[0.04] px-4 py-2 text-xs text-text transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            {loading ? "Reading…" : "Refresh"}
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
          No policies for this wallet in either pool yet. Buy depeg or exploit cover above; it shows up here once its transaction is in a block.
        </p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[1040px] text-left text-sm">
            <caption className="sr-only">Your PlutusShield policies on Cardano Preview</caption>
            <thead className="text-xs text-text-dim">
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-4 font-normal">Coverage</th>
                <th scope="col" className="py-2 pr-4 font-normal">Premium paid</th>
                <th scope="col" className="py-2 pr-4 font-normal">Cover period</th>
                <th scope="col" className="py-2 pr-4 font-normal">Status</th>
                <th scope="col" className="py-2 pr-4 font-normal">Bought in · lifecycle</th>
                <th scope="col" className="py-2 pr-4 font-normal">Midnight key</th>
                <th scope="col" className="py-2 font-normal">Action</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => {
                const a = PREVIEW_ASSETS[p.tranche];
                const pc = PRODUCT_COPY[p.product];
                const grace = claimGraceOf(p.product);
                const f = (x: bigint) => formatUnits(x, a.decimals, 2);
                const s = statusCopy[p.status];
                const [hash] = p.ref.split("#");
                const sub =
                  p.status === "waiting"
                    ? `starts in ${untilText(Number(p.policy.start) - now)}`
                    : p.status === "active"
                      ? `${untilText(Number(p.policy.expiry) - now)} left`
                      : p.status === "claimable"
                        ? `claims close in ${untilText(Number(p.policy.expiry + grace) - now)}`
                        : "capacity can be released";
                return (
                  <tr key={`${p.product}:${p.ref}`} className="border-b border-border/60 align-top last:border-0">
                    <td className="py-3 pr-4">
                      <span className="font-mono text-text">{f(p.policy.coverage)}</span>{" "}
                      <span className="text-xs text-text-dim">{a.ticker}</span>
                      <span className="mt-1 block">
                        <Badge variant={pc.badge}>{pc.short}</Badge>
                      </span>
                      <span className="mt-1 block text-[11px] text-text-dim">
                        {pc.label} · paid in {a.symbol}
                      </span>
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
                      <Link
                        href={`/policy/?id=${p.policy.policyId}`}
                        className="mt-1 block text-[11px] text-accent-strong underline underline-offset-4 hover:text-text"
                        aria-label={`Lifecycle timeline for policy ${p.policy.policyId}`}
                      >
                        Track lifecycle →
                      </Link>
                    </td>
                    <td className="py-3 pr-4">
                      <MidnightKeyCell policyId={p.policy.policyId} midnightCommitment={p.policy.midnightCommitment} holder={p.holder} />
                    </td>
                    <td className="py-3">
                      {p.product === "depeg" ? <PolicyAction p={p} chain={chain} now={now} /> : <ExploitPolicyAction p={p} exploit={exploit} now={now} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] leading-relaxed text-text-dim">
            <span className="text-cardano">Depeg cover</span> settles on an oracle: when {Number(COVER.params.oracle.quorum)} of{" "}
            {COVER.params.oracle.feeds.length} oracle feeds attest a USDM depeg inside a policy&apos;s cover period, its holder files the
            claim here and the coverage is paid from the tranche in the same Cardano transaction.{" "}
            <span className="text-midnight">Exploit cover</span> is assessed: its holder seals evidence and files the claim on Midnight
            from <Link href="/claim/evidence" className="underline underline-offset-4 hover:text-text">/claim/evidence</Link> (File with
            Lace or the holder claim kit), {EXPLOIT_COMMITTEE.threshold} of the {EXPLOIT_COMMITTEE.seats} assessors vote on Midnight
            Preprod, and the payout is a Cardano Settle that {EXPLOIT_COMMITTEE.threshold} of them sign. Unclaimed policies in either pool
            can be released by anyone once the claim grace ends; the deposit always returns to the buyer. Settled and released policies
            burn their tokens and leave this list.
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-text-dim">
            <span className="text-midnight">Midnight key:</span> every Buy makes a private key in your browser and writes only its
            commitment into the policy datum. That key is what the Midnight <span className="font-mono">policy-cover</span> registry
            checks when you prove cover or file a claim there, without revealing your wallet or the amount. &ldquo;On this device&rdquo;
            means the saved key re-derives this policy&apos;s on-chain commitment. Keys stay in this browser until you export them;
            on another device, use &ldquo;Restore from backup&rdquo;. Policies bought before Midnight keys shipped (Oct 6, 2026) have none.
            The Buy also publishes a <span className="font-mono">registration ticket</span> (the holder and coverage
            commitments, never the key) so the relay can mirror the policy on Midnight from chain data alone.
            &ldquo;Mirrored on Midnight&rdquo; is read live from the Midnight Preprod indexer: the policy id is a key in the
            registry&apos;s public state, so its holder can prove cover there. &ldquo;Relay pending&rdquo; means the ticket
            checks out and the next relay run registers it; &ldquo;Pre-binding&rdquo; policies carry a placeholder commitment
            and can&apos;t be mirrored.
          </p>
        </div>
      )}
    </section>
  );
}
