"use client";

import { MIRROR_STATE_LABEL, mirrorSummary, type MirrorState } from "@plutusshield/sdk/relay";
import { RELAY_SNAPSHOT, relayEntry, useMidnightActivity } from "@/lib/useMidnightActivity";
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

const mirrorCopy: Record<MirrorState | "unknown", { label: string; title: string; tone: string; dot: string }> = {
  mirrored: {
    label: MIRROR_STATE_LABEL.mirrored,
    title: "This policy id is a key in the policy-cover registry's public state on Midnight Preprod, so its holder can prove cover there.",
    tone: "text-midnight",
    dot: "bg-[var(--midnight)]",
  },
  ready: {
    label: MIRROR_STATE_LABEL.ready,
    title: "The Buy transaction carries a registration ticket that opens this policy's commitment. The issuer relay registers it on Midnight on its next run.",
    tone: "text-text-muted",
    dot: "border border-[var(--midnight)]",
  },
  "awaiting-key": {
    label: MIRROR_STATE_LABEL["awaiting-key"],
    title: "Bound to a Midnight key, but the relay has neither the Buy's registration ticket nor the holder's key, so it can't register it yet.",
    tone: "text-[var(--gold)]",
    dot: "border border-[var(--gold)]",
  },
  "pre-binding": {
    label: MIRROR_STATE_LABEL["pre-binding"],
    title: "Bought before Midnight keys shipped (Oct 6, 2026): the datum holds a placeholder commitment that no key opens, and registerPolicy rejects it by design.",
    tone: "text-text-dim",
    dot: "border border-border-strong",
  },
  unknown: {
    label: "Not mirrored yet",
    title: "Not registered in the Midnight Preprod registry yet. Every Buy publishes a registration ticket and the relay mirrors policies after they confirm on Cardano.",
    tone: "text-text-dim",
    dot: "border border-border-strong",
  },
};

/** Per-policy Midnight mirror state: live "mirrored" from the indexer, otherwise the build-time relay plan. */
export function MirroredOnMidnight({ policyId }: { policyId: string }) {
  const a = useMidnightActivity();
  const state: MirrorState | "unknown" = a.isMirrored(policyId) ? "mirrored" : (() => {
    const s = relayEntry(policyId)?.state;
    // The snapshot said mirrored but the live state doesn't: don't claim it.
    return !s || s === "mirrored" ? "unknown" : s;
  })();
  const c = mirrorCopy[state];
  return (
    <span className={`flex items-center gap-1.5 text-[11px] leading-snug ${c.tone}`} title={c.title}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} aria-hidden="true" />
      {c.label}
    </span>
  );
}

/** "3 of 11 live Preview policies mirrored" line for the /app panel; mirrored is live, the rest from the relay plan. */
export function RelayStatus() {
  const a = useMidnightActivity();
  const entries = RELAY_SNAPSHOT.policies.map((p) => ({ state: a.isMirrored(p.policyId) ? ("mirrored" as const) : p.state === "mirrored" ? ("ready" as const) : p.state }));
  if (!entries.length) return null;
  const n = mirrorSummary(entries);
  const parts = [
    n.ready ? `${n.ready} relay pending` : null,
    n["awaiting-key"] ? `${n["awaiting-key"]} awaiting holder key` : null,
    n["pre-binding"] ? `${n["pre-binding"]} pre-binding (can't mirror)` : null,
  ].filter(Boolean);
  return (
    <p className="relative mt-4 flex flex-wrap items-baseline gap-x-2 text-xs text-text-muted" aria-live="polite">
      <span className="font-display text-base tabular-nums text-text">
        {n.mirrored} of {n.mirrorable}
      </span>
      <span>
        mirrorable Cardano Preview policies are mirrored on Midnight
        {parts.length ? <span className="text-text-dim"> · {parts.join(" · ")}</span> : null}
      </span>
    </p>
  );
}
