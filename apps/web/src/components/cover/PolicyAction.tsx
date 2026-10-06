"use client";

/**
 * The per-policy action in "My policies": file a claim (Settle) when a quorum
 * of oracle feeds attests a depeg inside the cover period, or release an
 * unclaimed policy after the claim grace (Expire; anyone may submit it and
 * the policy deposit goes back to the buyer). Built by the shared
 * lib/tx/claim.ts, signed by the connected CIP-30 wallet.
 */
import { useRef, useState } from "react";
import { formatUnits } from "@plutusshield/sdk/cip30";
import { useWallet } from "@/lib/wallet";
import { PREVIEW_ASSETS, explorerTx } from "@/lib/preview";
import { claimCheck, releasableAt } from "@/lib/tx/claim";
import type { WalletPolicy } from "@/lib/tx/cover";
import { COVER, type CoverChain } from "@/lib/useCoverChain";

type Phase =
  | { kind: "idle" }
  | { kind: "working"; step: string }
  | { kind: "done"; hash: string; summary: string }
  | { kind: "error"; message: string };

const QUORUM = Number(COVER.params.oracle.quorum);
const FEEDS = COVER.params.oracle.feeds.length;

export function PolicyAction({ p, chain, now }: { p: WalletPolicy; chain: CoverChain; now: number }) {
  const w = useWallet();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const ac = useRef<AbortController | null>(null);
  const a = PREVIEW_ASSETS[p.tranche];

  const check = chain.feeds ? claimCheck(COVER, p.policy, chain.feeds, now) : null;
  const canClaim = p.holder && (p.status === "active" || p.status === "claimable") && !!check?.ok;
  const canRelease = p.status === "expired" && now >= releasableAt(COVER, p.policy);
  const wrongNetwork = w.status === "connected" && w.networkId !== 0;

  async function run(kind: "settle" | "expire") {
    const api = w.signingApi();
    if (!api) return setPhase({ kind: "error", message: "Reconnect your wallet and try again." });
    ac.current?.abort();
    ac.current = new AbortController();
    try {
      setPhase({ kind: "working", step: "Reading the pool, your policy and the oracle feeds…" });
      const { lucidFor, COVER_SCRIPT, waitForTx } = await import("@/lib/tx/browser");
      const { buildSettle, buildExpire } = await import("@/lib/tx/claim");
      const lucid = await lucidFor(api);
      let summary: string;
      let tx;
      if (kind === "settle") {
        const feeds = await lucid.utxosAt(COVER_SCRIPT.oracleAddress!);
        const r = await buildSettle(lucid, COVER_SCRIPT, { policyId: p.policy.policyId, feeds, now: Date.now() });
        tx = r.tx;
        summary = `Claim paid: ${formatUnits(r.payout, a.decimals, 2)} ${a.ticker} to this wallet, on the attestation of ${r.feeds.join(" and ")}.`;
      } else {
        const r = await buildExpire(lucid, COVER_SCRIPT, { policyId: p.policy.policyId, now: Date.now() });
        tx = r.tx;
        summary = `Released ${formatUnits(p.policy.coverage, a.decimals, 0)} ${a.ticker} of pool capacity; the ${formatUnits(r.refund, 6, 1)} ADA policy deposit went back to the buyer.`;
      }
      setPhase({ kind: "working", step: "Approve the transaction in your wallet." });
      const signed = await tx.sign.withWallet().complete();
      setPhase({ kind: "working", step: "Submitting to Cardano Preview…" });
      const hash = await signed.submit();
      setPhase({ kind: "working", step: "Submitted. Waiting for a block…" });
      await waitForTx(hash, ac.current.signal);
      setPhase({ kind: "done", hash, summary });
      void chain.refresh();
      void w.refresh();
    } catch (e) {
      const { txError } = await import("@/lib/tx/browser");
      setPhase({ kind: "error", message: txError(e) });
    }
  }

  if (phase.kind === "working") return <p role="status" className="text-[11px] text-text-muted">{phase.step}</p>;
  if (phase.kind === "done")
    return (
      <div role="status" className="max-w-[220px] text-[11px] text-text-muted">
        <p className="text-[var(--accent)]">{phase.summary}</p>
        <a href={explorerTx(phase.hash)} target="_blank" rel="noreferrer" className="font-mono underline underline-offset-4 hover:text-text">
          {phase.hash.slice(0, 8)}… ↗
        </a>
      </div>
    );

  const button = (label: string, kind: "settle" | "expire", aria: string) => (
    <button
      type="button"
      onClick={() => void run(kind)}
      disabled={wrongNetwork}
      aria-label={aria}
      className="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-bg transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
    >
      {label}
    </button>
  );

  return (
    <div className="max-w-[220px] space-y-1">
      {canClaim
        ? button(`Claim ${formatUnits(p.policy.coverage, a.decimals, 0)} ${a.ticker}`, "settle", `File a claim for ${formatUnits(p.policy.coverage, a.decimals, 2)} ${a.ticker}`)
        : canRelease
          ? button("Release", "expire", "Release this expired policy's capacity and refund its deposit to the buyer")
          : (
            <p className="text-[11px] leading-snug text-text-dim">
              {p.status === "expired"
                ? "Claim window closed."
                : !p.holder
                  ? "Claim token is in another wallet."
                  : `Claim opens when ${QUORUM} of ${FEEDS} oracle feeds attest a depeg${check ? ` (${check.feeds.length} so far)` : ""}.`}
            </p>
          )}
      {phase.kind === "error" && <p role="alert" className="text-[11px] text-[var(--danger)]">{phase.message}</p>}
    </div>
  );
}
