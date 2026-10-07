"use client";

import { MIRROR_STATE_LABEL, mirrorSummary, type MirrorState } from "@plutusshield/sdk/relay";
import { RELAY_SNAPSHOT, relayEntry, useMidnightActivity } from "@/lib/useMidnightActivity";
import { RELAY_SNAPSHOT_V2, useMidnightV2Activity } from "@/lib/useMidnightV2Activity";
import { MIDNIGHT_V2 } from "@/lib/midnightPreprodV2";
import { useNow } from "@/lib/useNow";
import { shortHash } from "@/lib/midnightPreprod";
import { describeChange, type MidnightAction, type MidnightPolicyStatus, type PolicyChange } from "@/lib/midnightIndexer";

type Registry = "v1" | "v2";

const circuitCopy: Record<string, string> = {
  deploy: "Registry deployed",
  registerPolicy: "Policy mirrored from Cardano",
  proveCover: "Cover proven in zero knowledge",
  rotateHolder: "Holder key rotated",
  fileClaim: "Claim filed with sealed evidence",
  resolveClaim: "Claim resolved by assessor",
  voteClaim: "Committee seat voted",
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

/**
 * Live counters for the panel header: successful calls on the current registry
 * (policy-cover v2, claims decided by the assessor committee), with the v1
 * registry's totals underneath so its history stays visible.
 */
export function LiveCounters() {
  const v2 = useMidnightV2Activity();
  const v1 = useMidnightActivity();
  const cells = [
    { label: "Policies mirrored", value: v2.calls.registerPolicy ?? 0 },
    { label: "Cover proofs", value: v2.calls.proveCover ?? 0 },
    { label: "Claims filed", value: v2.calls.fileClaim ?? 0 },
    { label: "Committee votes", value: v2.calls.voteClaim ?? 0 },
  ];
  return (
    <div className="text-right">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-live="polite">
        {cells.map((c) => (
          <div key={c.label} className="rounded-2xl border border-[var(--hairline)] bg-white/[0.02] px-4 py-3">
            <dt className="font-mono-label text-[9px] text-text-dim">{c.label}</dt>
            <dd className="font-display text-2xl tabular-nums text-text">{c.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] leading-snug text-text-dim">
        Registry v2, {MIDNIGHT_V2.quorumLabel} assessor committee.{" "}
        <span title="policy-cover v1: the first Preprod registry, with claims resolved by a single assessor key. Kept for its history; new claims go to v2.">
          v1 (single assessor): {v1.calls.registerPolicy ?? 0} mirrored · {v1.calls.proveCover ?? 0} proofs · {v1.calls.resolveClaim ?? 0} claims resolved
        </span>
      </p>
    </div>
  );
}

// registerPolicy rows already say what happened; claim lifecycle rows name the policy and the outcome.
const showChanges = (entryPoint: string) =>
  entryPoint === "fileClaim" || entryPoint === "resolveClaim" || entryPoint === "voteClaim" || entryPoint === "expirePolicy" || entryPoint === "rotateHolder";

const changeTone = (c: PolicyChange) =>
  c.to === "PAID" ? "text-success" : c.to === "CLAIM_PENDING" ? "text-[var(--gold)]" : c.from === "CLAIM_PENDING" ? "text-text-muted" : "text-text-dim";

function ChangeLine({ c, entryPoint }: { c: PolicyChange; entryPoint: string }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 text-[11px] leading-snug">
      <span className="font-mono text-[10.5px] text-text-dim" title={c.policyId}>
        policy {shortHash(c.policyId)}
      </span>
      <span className={changeTone(c)}>
        {describeChange(c, entryPoint)}
        {c.from !== "NONE" && c.from !== c.to ? (
          <span className="font-mono text-[10px] text-text-dim">
            {" "}
            {c.from} → {c.to}
          </span>
        ) : null}
      </span>
      {c.evidence && c.to === "CLAIM_PENDING" ? (
        <span className="font-mono text-[10px] text-text-dim" title={`evidenceCommitment ${c.evidence}`}>
          evidence {shortHash(c.evidence)}
        </span>
      ) : null}
    </span>
  );
}

const registryTag: Record<Registry, { label: string; title: string; tone: string }> = {
  v2: { label: "v2", title: `policy-cover v2: claims decided by a ${MIDNIGHT_V2.quorumLabel} assessor committee (voteClaim)`, tone: "border-[color-mix(in_srgb,var(--midnight)_45%,transparent)] text-midnight" },
  v1: { label: "v1", title: "policy-cover v1: claims resolved by a single assessor (resolveClaim)", tone: "border-[var(--hairline)] text-text-dim" },
};

/**
 * Every call both policy-cover registries have received, newest first,
 * streamed from the Preprod indexer (one socket per contract). Rows are tagged
 * with the registry they hit.
 */
export function ActivityFeed({ limit = 8 }: { limit?: number }) {
  const v1 = useMidnightActivity();
  const v2 = useMidnightV2Activity();
  const now = useNow(15_000);
  const all: (MidnightAction & { registry: Registry })[] = [
    ...[...v1.actions].reverse().map((x) => ({ ...x, registry: "v1" as const })),
    ...[...v2.actions].reverse().map((x) => ({ ...x, registry: "v2" as const })),
  ].sort((x, y) => y.height - x.height || (x.registry === y.registry ? 0 : x.registry === "v2" ? -1 : 1));
  const rows = all.slice(0, limit);
  const live = v1.source === "live" && v2.source === "live";
  const a = { actions: all, asOf: Math.min(v1.asOf, v2.asOf), error: v1.error ?? v2.error };
  return (
    <div className="relative mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-mono-label text-[10px] text-text-dim">Contract activity</h3>
        <p className="flex items-center gap-2 text-[11px] text-text-dim" role="status">
          <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-success animate-pulse-dot" : "bg-border-strong"}`} aria-hidden="true" />
          {live ? "Streaming both registries from the Midnight Preprod indexer" : `Snapshot from ${stamp(a.asOf)}`}
          {a.error && !live ? " · indexer unreachable, retrying" : null}
        </p>
      </div>
      <ol className="mt-3 divide-y divide-[var(--hairline)] rounded-2xl border border-[var(--hairline)] bg-white/[0.02]">
        {rows.map((r) => (
          <li key={r.registry + r.txHash + r.entryPoint} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5">
            <span className="min-w-0 text-xs text-text">
              <span
                className={`mr-2 inline-block rounded-full border px-1.5 py-px align-[1px] font-mono text-[9.5px] ${registryTag[r.registry].tone}`}
                title={registryTag[r.registry].title}
              >
                {registryTag[r.registry].label}
              </span>
              {r.registry === "v2" && r.entryPoint === "deploy" ? "v2 registry deployed with the committee" : 
              circuitCopy[r.entryPoint] ?? r.entryPoint}{" "}
              <span className="font-mono text-[10.5px] text-text-dim">{r.entryPoint === "deploy" ? "constructor" : `${r.entryPoint}()`}</span>
              {r.status !== "SUCCESS" && <span className="ml-2 text-[10.5px] text-[var(--gold)]">{r.status.toLowerCase().replace("_", " ")}</span>}
            </span>
            <span className="font-mono text-[10.5px] text-text-dim" title={`${r.txHash} · ${new Date(r.timestamp).toISOString()}`}>
              {shortHash(r.txHash)} · block {r.height.toLocaleString("en-US")}
              {now !== null && <> · {ago(r.timestamp, now)}</>}
            </span>
            {showChanges(r.entryPoint) && r.changes?.length ? (
              <span className="w-full space-y-0.5">
                {r.changes.map((c) => (
                  <ChangeLine key={c.policyId} c={c} entryPoint={r.entryPoint} />
                ))}
              </span>
            ) : null}
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

const statusCopy: Record<MidnightPolicyStatus, { label: string; title: string; tone: string; dot: string }> = {
  ACTIVE: {
    label: "Mirrored · ACTIVE on Midnight",
    title: "Registered in the policy-cover registry on Midnight Preprod with status ACTIVE: its holder can prove cover or file an exploit claim there.",
    tone: "text-midnight",
    dot: "bg-[var(--midnight)]",
  },
  CLAIM_PENDING: {
    label: "Claim pending on Midnight",
    title: "The holder filed an exploit claim (fileClaim) with a sealed evidence commitment. The assessor opens the bundle off-ledger and checks it against that commitment before resolveClaim.",
    tone: "text-[var(--gold)]",
    dot: "bg-[var(--gold)] animate-pulse-dot",
  },
  PAID: {
    label: "Claim approved · PAID on Midnight",
    title: "The assessor approved the claim (resolveClaim) on Midnight Preprod: the record is PAID and keeps its evidence commitment. Exploit-pool policies are then paid on Cardano Preview by an assessor-signed Settle; depeg-pool policies settle only on an oracle quorum.",
    tone: "text-success",
    dot: "bg-success",
  },
  EXPIRED: {
    label: "Expired on Midnight",
    title: "The issuer mirrored this policy's expiry (expirePolicy) into the Midnight registry.",
    tone: "text-text-dim",
    dot: "border border-border-strong",
  },
};

/** v2 decides claims by committee quorum, so its pending/paid copy names the committee, not one assessor. */
const statusCopyV2: Partial<Record<MidnightPolicyStatus, { title: string }>> = {
  CLAIM_PENDING: {
    title: `The holder filed an exploit claim (fileClaim) with a sealed evidence commitment. Each seat of the ${MIDNIGHT_V2.quorumLabel} assessor committee opens the bundle off-ledger, checks it against that commitment, and casts voteClaim; the claim pays at ${MIDNIGHT_V2.threshold} approvals.`,
  },
  PAID: {
    title: `The ${MIDNIGHT_V2.quorumLabel} assessor committee approved the claim (voteClaim quorum) on Midnight Preprod: the record is PAID and keeps its evidence commitment. Exploit-pool policies are then paid on Cardano Preview by a committee-signed Settle; depeg-pool policies settle only on an oracle quorum.`,
  },
};

/**
 * Per-policy Midnight state: the live record's lifecycle status (ACTIVE /
 * CLAIM_PENDING / PAID / EXPIRED, decoded from the indexer's contract state),
 * from the v2 registry when the policy is there, else v1; otherwise the
 * build-time relay plan.
 */
export function MirroredOnMidnight({ policyId }: { policyId: string }) {
  const v1 = useMidnightActivity();
  const v2 = useMidnightV2Activity();
  const registry: Registry | null = v2.isMirrored(policyId) ? "v2" : v1.isMirrored(policyId) ? "v1" : null;
  const rec = registry === "v2" ? v2.record(policyId) : registry === "v1" ? v1.record(policyId) : null;
  if (rec && registry) {
    const c = statusCopy[rec.status];
    const title = (registry === "v2" ? (statusCopyV2[rec.status]?.title ?? c.title) : c.title) + (rec.evidence ? ` Evidence commitment ${rec.evidence}.` : "") + ` ${registryTag[registry].title}.`;
    return (
      <span className={`flex items-center gap-1.5 text-[11px] leading-snug ${c.tone}`} title={title}>
        <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} aria-hidden="true" />
        {c.label}
        <span className="font-mono text-[9.5px] text-text-dim">{registry}</span>
      </span>
    );
  }
  const state: MirrorState | "unknown" = registry ? "mirrored" : (() => {
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

/**
 * "2 of 3 mirrorable Preview policies are in the v2 registry" line for the
 * /app panel: mirrored is read live from each registry, the rest comes from
 * the build-time relay plan. v1's count follows as a footnote.
 */
export function RelayStatus() {
  const v1 = useMidnightActivity();
  const v2 = useMidnightV2Activity();
  const plan2 = RELAY_SNAPSHOT_V2.policies.length ? RELAY_SNAPSHOT_V2.policies : RELAY_SNAPSHOT.policies;
  const entries = plan2.map((p) => ({ state: v2.isMirrored(p.policyId) ? ("mirrored" as const) : p.state === "mirrored" ? ("ready" as const) : p.state }));
  if (!entries.length) return null;
  const n = mirrorSummary(entries);
  const v1n = RELAY_SNAPSHOT.policies.filter((p) => v1.isMirrored(p.policyId)).length;
  const parts = [
    n.ready ? `${n.ready} relay pending` : null,
    n["awaiting-key"] ? `${n["awaiting-key"]} awaiting holder key` : null,
    n["pre-binding"] ? `${n["pre-binding"]} pre-binding (can't mirror)` : null,
    `${v1n} in the v1 registry`,
  ].filter(Boolean);
  return (
    <p className="relative mt-4 flex flex-wrap items-baseline gap-x-2 text-xs text-text-muted" aria-live="polite">
      <span className="font-display text-base tabular-nums text-text">
        {n.mirrored} of {n.mirrorable}
      </span>
      <span>
        mirrorable Cardano Preview policies are in the v2 registry on Midnight
        {parts.length ? <span className="text-text-dim"> · {parts.join(" · ")}</span> : null}
      </span>
    </p>
  );
}
