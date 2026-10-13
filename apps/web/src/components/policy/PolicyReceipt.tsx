"use client";

/**
 * Premium receipt for one policy: a printable / downloadable Markdown Buy
 * proof built in the browser from the policy record by
 * @plutusshield/sdk/receipt. Nothing is uploaded anywhere. Only renders when
 * a real Buy tx hash and premium / coverage labels are known — never invents
 * a hash. Mirrors PolicyCertificate's honesty style.
 */
import { useMemo, useRef, useState } from "react";
import {
  buildPremiumReceipt,
  premiumReceiptFilename,
  premiumReceiptMarkdown,
  type PremiumReceiptInput,
} from "@plutusshield/sdk/receipt";
import { Button } from "@/components/ui/Button";
import type { KnownPolicy } from "@/lib/policyTimeline";

const SITE_ROOT =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.NEXT_PUBLIC_BASE_PATH ? `https://kshot3000.github.io${process.env.NEXT_PUBLIC_BASE_PATH}` : "https://kshot3000.github.io/PlutusShield");

const fmt = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

export function PolicyReceipt({
  policy,
  coverage,
  premium,
  pool,
  buyExplorerUrl,
  premiumAsset,
  midnightCommitment,
  boughtAtMs,
}: {
  policy: KnownPolicy;
  coverage: string | null;
  premium: string | null;
  pool?: string | null;
  /** Absolute Cardano Preview explorer URL for policy.buyTx. */
  buyExplorerUrl: string | null;
  premiumAsset?: string | null;
  midnightCommitment?: string | null;
  /** Prefer live Blockfrost Buy block_time when the policy record has no boughtAt. */
  boughtAtMs?: number | null;
}) {
  const [saved, setSaved] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const input = useMemo<PremiumReceiptInput | null>(() => {
    if (!policy.buyTx || !premium || !coverage || !buyExplorerUrl) return null;
    const id = policy.policyId;
    const product = policy.product === "depeg" ? "depeg" : "exploit";
    const boughtAt = boughtAtMs ?? policy.boughtAt ?? null;
    return {
      policyId: id,
      product,
      coverage,
      premium,
      asset: policy.ticker,
      premiumAsset: premiumAsset ?? null,
      boughtAt,
      network: "Cardano Preview",
      pool: pool ?? null,
      buyTx: policy.buyTx,
      buyExplorerUrl,
      midnightCommitment: midnightCommitment ?? null,
      trackerUrl: `${SITE_ROOT}/policy/?id=${id}`,
      termsUrl: `${SITE_ROOT}/docs/terms/`,
      // Deterministic Issued when Buy time is known; if still unknown the
      // receipt stays hidden (we refuse Date.now()).
      issuedAt: boughtAt ?? undefined,
    };
  }, [policy, coverage, premium, pool, buyExplorerUrl, premiumAsset, midnightCommitment, boughtAtMs]);

  const receipt = useMemo(() => {
    if (!input) return null;
    // boughtAt or issuedAt required — skip rather than invent a clock.
    if (input.boughtAt == null && input.issuedAt == null) return null;
    try {
      return buildPremiumReceipt(input);
    } catch {
      return null;
    }
  }, [input]);

  if (!receipt || !input) return null;

  const download = () => {
    const blob = new Blob([premiumReceiptMarkdown(receipt)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = premiumReceiptFilename(input.policyId);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSaved(true);
  };

  const print = () => {
    const node = printRef.current;
    if (!node) {
      window.print();
      return;
    }
    const w = window.open("", "_blank", "noopener,noreferrer,width=720,height=900");
    if (!w) {
      window.print();
      return;
    }
    w.document.write(`<!doctype html><html><head><title>${receipt.title} · ${receipt.policyIdShort}</title>
<style>
  body{font:14px/1.45 system-ui,sans-serif;color:#111;margin:2rem;max-width:40rem}
  h1{font-size:1.4rem;margin:0 0 .25rem} h2{font-size:.95rem;font-weight:600;color:#444;margin:0 0 1.25rem}
  table{width:100%;border-collapse:collapse} th,td{text-align:left;padding:.4rem .5rem;border-bottom:1px solid #ddd;vertical-align:top}
  th{width:32%;color:#555;font-weight:600} ul{padding-left:1.1rem} .foot{margin-top:1.5rem;font-size:11px;color:#666}
  @media print{body{margin:0}}
</style></head><body>${node.innerHTML}<p class="foot">PlutusShield · Cardano Preview + Midnight Preprod · ${SITE_ROOT}/</p>
<script>window.onload=()=>{window.print();}</script></body></html>`);
    w.document.close();
  };

  return (
    <section aria-labelledby="receipt-title" className="glass-panel relative mt-6 p-5 sm:p-8">
      <h2 id="receipt-title" className="text-lg font-semibold tracking-tight text-text">
        Premium receipt
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        Download or print proof of the Cardano Preview Buy payment. Built in your browser from the policy record; nothing is sent anywhere. Not a guarantee of future payout.
      </p>

      <div ref={printRef} className="mt-4 rounded-xl border border-[var(--hairline)] p-4 sm:p-5">
        <h3 className="text-base font-semibold text-text">{receipt.title}</h3>
        <p className="mt-0.5 text-xs text-text-muted">{receipt.subtitle}</p>
        <dl className="mt-4 grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-[11px] text-text-dim">Premium paid</dt>
            <dd className="font-mono text-sm text-text">{receipt.premium}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-text-dim">Coverage</dt>
            <dd className="font-mono text-sm text-text">{receipt.coverage}</dd>
          </div>
          {receipt.boughtAt != null && (
            <div>
              <dt className="text-[11px] text-text-dim">Bought at</dt>
              <dd className="text-xs text-text-muted">{fmt(receipt.boughtAt)}</dd>
            </div>
          )}
          <div>
            <dt className="text-[11px] text-text-dim">Buy transaction</dt>
            <dd className="font-mono text-xs text-text break-all">{receipt.buyTx.slice(0, 16)}…{receipt.buyTx.slice(-8)}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[11px] text-text-dim">Explorer</dt>
            <dd className="text-xs text-accent">
              <a href={receipt.buyExplorerUrl} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                {receipt.buyExplorerUrl.replace(/^https?:\/\//, "").slice(0, 64)}
                {receipt.buyExplorerUrl.length > 64 + 8 ? "…" : ""}
              </a>
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[11px] text-text-dim">Network</dt>
            <dd className="text-xs text-text-muted">{receipt.network} · testnet, not audited</dd>
          </div>
        </dl>
        <ul className="mt-4 space-y-1 border-t border-[var(--hairline)] pt-3 text-[11px] text-text-dim">
          {receipt.disclaimers.slice(0, 2).map((d) => (
            <li key={d.slice(0, 40)}>{d}</li>
          ))}
        </ul>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={download}>
          Download receipt (.md)
        </Button>
        <Button size="sm" variant="secondary" onClick={print}>
          Print
        </Button>
        <span className="text-[11px] text-text-dim" role="status">
          {saved ? "Saved." : "Same Buy tx as the on-chain payment and timeline."}
        </span>
      </div>
    </section>
  );
}
