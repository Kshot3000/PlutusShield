"use client";

import { useMidnightActivity } from "@/lib/useMidnightActivity";
import { useNow } from "@/lib/useNow";
import { shortHash } from "@/lib/midnightPreprod";

const circuitCopy: Record<string, string> = {
  deploy: "Registry deployed",
  registerPolicy: "Policy mirrored from Cardano",
  proveCover: "Cover proven in zero knowledge",
  rotateHolder: "Holder key rotated",
  fileClaim: "Claim filed with sealed evidence",
  resolveClaim: "Claim resolved by assessor",
  expirePolicy: "Policy expiry mirrored",
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

const stamp = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Live counters for the panel header: successful calls of each circuit. */
export function LiveCounters() {
  const a = useMidnightActivity();
  const cells = [
    { label: "Policies mirrored", value: a.calls.registerPolicy ?? 0 },
    { label: "Cover proofs", value: a.calls.proveCover ?? 0 },
    { label: "Claims filed", value: a.calls.fileClaim ?? 0 },
  ];
  return (
    <dl className="grid grid-cols-3 gap-3 text-right" aria-live="polite">
      {cells.map((c) => (
        <div key={c.label} className="rounded-2xl border border-[var(--hairline)] bg-white/[0.02] px-4 py-3">
          <dt className="font-mono-label text-[9px] text-text-dim">{c.label}</dt>
          <dd className="font-display text-2xl tabular-nums text-text">{c.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Every call the policy-cover contract has received, newest first, streamed from the Preprod indexer. */
export function ActivityFeed({ limit = 6 }: { limit?: number }) {
  const a = useMidnightActivity();
  const now = useNow(15_000);
  const rows = [...a.actions].reverse().slice(0, limit);
  const live = a.source === "live";
  return (
    <div className="relative mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-mono-label text-[10px] text-text-dim">Contract activity</h3>
        <p className="flex items-center gap-2 text-[11px] text-text-dim" role="status">
          <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-success animate-pulse-dot" : "bg-border-strong"}`} aria-hidden="true" />
          {live ? "Streaming from the Midnight Preprod indexer" : `Snapshot from ${stamp(a.asOf)}`}
          {a.error && !live ? " · indexer unreachable, retrying" : null}
        </p>
      </div>
      <ol className="mt-3 divide-y divide-[var(--hairline)] rounded-2xl border border-[var(--hairline)] bg-white/[0.02]">
        {rows.map((r) => (
          <li key={r.txHash + r.entryPoint} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5">
            <span className="min-w-0 text-xs text-text">
              {circuitCopy[r.entryPoint] ?? r.entryPoint}{" "}
              <span className="font-mono text-[10.5px] text-text-dim">{r.entryPoint === "deploy" ? "constructor" : `${r.entryPoint}()`}</span>
              {r.status !== "SUCCESS" && <span className="ml-2 text-[10.5px] text-[var(--gold)]">{r.status.toLowerCase().replace("_", " ")}</span>}
            </span>
            <span className="font-mono text-[10.5px] text-text-dim" title={`${r.txHash} · ${new Date(r.timestamp).toISOString()}`}>
              {shortHash(r.txHash)} · block {r.height.toLocaleString("en-US")}
              {now !== null && <> · {ago(r.timestamp, now)}</>}
            </span>
          </li>
        ))}
      </ol>
      {a.actions.length > limit && (
        <p className="mt-2 text-[11px] text-text-dim">
          Showing the latest {limit} of {a.actions.length} calls.
        </p>
      )}
    </div>
  );
}

/** Small "mirrored on Midnight" line for a policy row. */
export function MirroredOnMidnight({ policyId }: { policyId: string }) {
  const a = useMidnightActivity();
  const yes = a.isMirrored(policyId);
  return (
    <span
      className={`flex items-center gap-1.5 text-[11px] leading-snug ${yes ? "text-midnight" : "text-text-dim"}`}
      title={yes ? "This policy id is a key in the policy-cover registry's public state on Midnight Preprod." : "Not registered in the Midnight Preprod registry yet. The relay mirrors policies after they confirm on Cardano."}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${yes ? "bg-[var(--midnight)]" : "border border-border-strong"}`} aria-hidden="true" />
      {yes ? "Mirrored on Midnight" : "Not mirrored yet"}
    </span>
  );
}
