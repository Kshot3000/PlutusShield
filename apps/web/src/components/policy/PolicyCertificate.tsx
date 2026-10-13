"use client";

/**
 * Certificate of Cover for one policy: a printable / downloadable Markdown
 * certificate built in the browser from the policy record and deployment
 * params by @plutusshield/sdk/certificate. Nothing is uploaded anywhere.
 * Mirrors PolicyCalendar's honesty style.
 */
import { useMemo, useRef, useState } from "react";
import {
  buildCoverageCertificate,
  coverageCertificateFilename,
  coverageCertificateMarkdown,
  type CoverageCertificateInput,
} from "@plutusshield/sdk/certificate";
import { Button } from "@/components/ui/Button";
import type { KnownPolicy } from "@/lib/policyTimeline";

const SITE_ROOT =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.NEXT_PUBLIC_BASE_PATH ? `https://kshot3000.github.io${process.env.NEXT_PUBLIC_BASE_PATH}` : "https://kshot3000.github.io/PlutusShield");

const fmt = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

export function PolicyCertificate({
  policy,
  claimGraceMs,
  coverage,
  premium,
  pool,
  waitingPeriodMs,
  trigger,
  midnightCommitment,
}: {
  policy: KnownPolicy;
  claimGraceMs: number;
  coverage: string | null;
  premium?: string | null;
  pool?: string | null;
  waitingPeriodMs?: number | null;
  trigger?: string | null;
  midnightCommitment?: string | null;
}) {
  const [saved, setSaved] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const input = useMemo<CoverageCertificateInput | null>(() => {
    if (!policy.expiry || !coverage) return null;
    const id = policy.policyId;
    const product = policy.product === "depeg" ? "depeg" : "exploit";
    return {
      policyId: id,
      product,
      coverage,
      premium: premium ?? null,
      asset: policy.ticker,
      start: policy.start && policy.start < policy.expiry ? policy.start : null,
      expiry: policy.expiry,
      claimGraceMs,
      network: "Cardano Preview",
      pool: pool ?? null,
      midnightCommitment: midnightCommitment ?? null,
      trackerUrl: `${SITE_ROOT}/policy/?id=${id}`,
      termsUrl: `${SITE_ROOT}/docs/terms/`,
      claimUrl: product === "depeg" ? `${SITE_ROOT}/claim/` : `${SITE_ROOT}/claim/evidence/?policy=${id}`,
      waitingPeriodMs: waitingPeriodMs ?? null,
      trigger: trigger ?? null,
    };
  }, [policy, claimGraceMs, coverage, premium, pool, waitingPeriodMs, trigger, midnightCommitment]);

  const cert = useMemo(() => (input ? buildCoverageCertificate(input) : null), [input]);

  if (!cert || !input) return null;

  const download = () => {
    const blob = new Blob([coverageCertificateMarkdown(cert)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = coverageCertificateFilename(input.policyId);
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
    w.document.write(`<!doctype html><html><head><title>${cert.title} · ${cert.policyIdShort}</title>
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
    <section aria-labelledby="certificate-title" className="glass-panel relative mt-6 p-5 sm:p-8">
      <h2 id="certificate-title" className="text-lg font-semibold tracking-tight text-text">
        Certificate of Cover
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        Download or print proof of what this policy covers. Built in your browser from the policy record and deployment params; nothing is sent anywhere.
      </p>

      <div ref={printRef} className="mt-4 rounded-xl border border-[var(--hairline)] p-4 sm:p-5">
        <h3 className="text-base font-semibold text-text">{cert.title}</h3>
        <p className="mt-0.5 text-xs text-text-muted">{cert.subtitle}</p>
        <dl className="mt-4 grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-[11px] text-text-dim">Coverage</dt>
            <dd className="font-mono text-sm text-text">{cert.coverage}</dd>
          </div>
          {cert.premium && (
            <div>
              <dt className="text-[11px] text-text-dim">Premium</dt>
              <dd className="font-mono text-sm text-text">{cert.premium}</dd>
            </div>
          )}
          <div>
            <dt className="text-[11px] text-text-dim">Term</dt>
            <dd className="text-xs text-text-muted">
              {cert.start ? `${fmt(cert.start)} → ${fmt(cert.expiry)}` : `until ${fmt(cert.expiry)}`}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-text-dim">Claim deadline</dt>
            <dd className="text-xs text-text-muted">{fmt(cert.claimDeadline)}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[11px] text-text-dim">What pays</dt>
            <dd className="text-xs text-text-muted">{cert.trigger}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[11px] text-text-dim">Network</dt>
            <dd className="text-xs text-text-muted">{cert.network} · testnet, not audited</dd>
          </div>
        </dl>
        <ul className="mt-4 space-y-1 border-t border-[var(--hairline)] pt-3 text-[11px] text-text-dim">
          {cert.disclaimers.slice(0, 2).map((d) => (
            <li key={d.slice(0, 40)}>{d}</li>
          ))}
        </ul>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={download}>
          Download certificate (.md)
        </Button>
        <Button size="sm" variant="secondary" onClick={print}>
          Print
        </Button>
        <span className="text-[11px] text-text-dim" role="status">
          {saved ? "Saved." : "Same facts as the on-chain policy and /docs/terms."}
        </span>
      </div>
    </section>
  );
}
