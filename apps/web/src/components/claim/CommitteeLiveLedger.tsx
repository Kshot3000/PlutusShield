"use client";

import { useMidnightV2Activity } from "@/lib/useMidnightV2Activity";
import { MIDNIGHT_V2 as V } from "@/lib/midnightPreprodV2";
import { shortHash } from "@/lib/midnightPreprod";
import { useNow } from "@/lib/useNow";

const circuitCopy: Record<string, string> = {
  deploy: "v2 registry deployed with the committee",
  registerPolicy: "Policy mirrored from Cardano",
  proveCover: "Cover proven in zero knowledge",
  rotateHolder: "Holder key rotated",
  fileClaim: "Claim filed with sealed evidence",
  voteClaim: "Committee seat voted",
  expirePolicy: "Policy expiry mirrored",
};

const statusTone: Record<string, string> = {
  PAID: "text-success",
  CLAIM_PENDING: "text-midnight",
  ACTIVE: "text-text-muted",
  EXPIRED: "text-text-dim",
};

function ago(ms: number, now: number | null): string {
  if (now === null) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/**
 * The v2 committee contract read straight from the Midnight Preprod indexer:
 * successful calls per circuit, each claim policy's current ledger status and
 * claim round, and the latest actions. Falls back to the build snapshot.
 */
export function CommitteeLiveLedger() {
  const a = useMidnightV2Activity();
  const now = useNow(30_000);
  if (!V.live) return null;
  const cells = [
    { label: "Policies", value: a.calls.registerPolicy ?? 0 },
    { label: "Cover proofs", value: a.calls.proveCover ?? 0 },
    { label: "Claims filed", value: a.calls.fileClaim ?? 0 },
    { label: "Committee votes", value: a.calls.voteClaim ?? 0 },
  ];
  const recent = a.actions.slice(-5).reverse();
  const policies = [...new Set(V.claims.map((c) => c.policyId))];
  return (
    <div className="relative mt-6 rounded-2xl border border-midnight/20 bg-midnight/[0.03] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono-label text-[9.5px] text-text-dim">v2 ledger, read from the Preprod indexer</p>
        <p className="flex items-center gap-1.5 text-[10.5px] text-text-dim" aria-live="polite">
          <span
            className={`h-1.5 w-1.5 rounded-full ${a.source === "live" ? "bg-success shadow-[0_0_8px_var(--success,#3ddc97)]" : "bg-white/30"}`}
            aria-hidden="true"
          />
          {a.source === "live" ? "Live" : `Snapshot ${ago(a.asOf, now)}`}
          {a.error && a.source !== "live" ? " · indexer unreachable, retrying" : ""}
        </p>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-live="polite">
        {cells.map((c) => (
          <div key={c.label} className="rounded-xl border border-[var(--hairline)] bg-white/[0.02] px-3 py-2">
            <dt className="font-mono-label text-[9px] text-text-dim">{c.label}</dt>
            <dd className="font-display text-xl tabular-nums text-text">{c.value}</dd>
          </div>
        ))}
      </dl>

      {policies.length > 0 && (
        <ul className="mt-3 space-y-1 text-[11.5px]">
          {policies.map((id) => {
            const r = a.record(id);
            return (
              <li key={id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-text-dim">Policy</span>
                <span className="font-mono text-[11px] text-text" title={id}>
                  {shortHash(id)}
                </span>
                <span className="text-text-dim">on the ledger now:</span>
                <span className={statusTone[r?.status ?? ""] ?? "text-text-muted"}>{r?.status ?? "not found"}</span>
                {r?.round != null && <span className="text-text-dim">· claim round {r.round}</span>}
              </li>
            );
          })}
        </ul>
      )}

      {recent.length > 0 && (
        <ol className="mt-3 divide-y divide-[var(--hairline)] border-t border-[var(--hairline)] text-[11.5px]">
          {recent.map((x) => (
            <li key={x.txHash + x.entryPoint} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
              <span className="text-text">
                <span className="font-mono text-[11px] text-midnight">{x.entryPoint}</span>
                <span className="ml-2 text-text-muted">{circuitCopy[x.entryPoint] ?? x.entryPoint}</span>
                {x.status !== "SUCCESS" && <span className="ml-2 text-danger">{x.status}</span>}
              </span>
              <span className="text-[10.5px] text-text-dim">
                <span className="font-mono" title={x.txHash}>
                  {shortHash(x.txHash)}
                </span>{" "}
                · block {x.height.toLocaleString("en-US")} {now !== null ? `· ${ago(x.timestamp, now)}` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
