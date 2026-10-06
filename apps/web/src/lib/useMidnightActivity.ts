"use client";

/**
 * Live activity of the Midnight Preprod policy-cover contract, shared by every
 * component on the page (one indexer socket, opened on first use). Starts from
 * the build-time snapshot, switches to the live stream once history replays,
 * and falls back to the snapshot if the indexer can't be reached.
 */
import { useSyncExternalStore } from "react";
import snapshot from "@/data/midnight-preprod-activity.json";
import { MIDNIGHT_PREPROD } from "@/lib/midnightPreprod";
import { countCalls, policyRecordFromState, stateHasPolicy, watchContractActions, type MidnightAction, type MidnightPolicyRecord } from "@/lib/midnightIndexer";
import type { MirrorState } from "@plutusshield/sdk/relay";

export type RelayPolicy = { policyId: string; state: MirrorState; source: "ticket" | "key" | null; buyTx: string; blockTime: number | null };

/**
 * The relay plan baked at build time (scripts/snapshot-midnight.mjs): every
 * live Preview policy and its Midnight mirror state, from the Buy tx ticket and
 * the contract state. "mirrored" is re-read live; the rest comes from here.
 */
export const RELAY_SNAPSHOT: { takenAt: string; policies: RelayPolicy[] } = {
  takenAt: snapshot.takenAt,
  policies: ((snapshot as { relay?: { policies: RelayPolicy[] } }).relay?.policies ?? []).map((p) => ({ ...p, policyId: p.policyId.toLowerCase() })),
};
const relayById = new Map(RELAY_SNAPSHOT.policies.map((p) => [p.policyId, p]));
export const relayEntry = (policyId: string): RelayPolicy | undefined => relayById.get(policyId.toLowerCase());

export type MidnightActivity = {
  source: "snapshot" | "live";
  /** ms; when the snapshot was taken, or the last live update. */
  asOf: number;
  actions: MidnightAction[];
  calls: Record<string, number>;
  /** Live state when available; otherwise the snapshot's checked policy ids. */
  isMirrored: (policyId: string) => boolean;
  /** The policy's Midnight record (status, evidence commitment): live state, else the snapshot. */
  record: (policyId: string) => MidnightPolicyRecord | null;
  error: string | null;
};

const snapIds = new Set(snapshot.mirroredPolicyIds.map((x) => x.toLowerCase()));
const snapActions = snapshot.actions as MidnightAction[];
const snapRecords = new Map(
  (((snapshot as { policyRecords?: MidnightPolicyRecord[] }).policyRecords ?? []) as MidnightPolicyRecord[]).map((r) => [r.policyId.toLowerCase(), r]),
);
/** Policy ids we know about, so the decoder also finds ids that end in zero bytes. */
const knownPolicyIds = [...new Set([...snapIds, ...RELAY_SNAPSHOT.policies.map((p) => p.policyId)])];

let current: MidnightActivity = {
  source: "snapshot",
  asOf: Date.parse(snapshot.takenAt),
  actions: snapActions,
  calls: countCalls(snapActions),
  isMirrored: (id) => snapIds.has(id.toLowerCase()),
  record: (id) => snapRecords.get(id.toLowerCase()) ?? null,
  error: null,
};
const listeners = new Set<() => void>();
let started = false;
let retryMs = 5_000;

const set = (next: MidnightActivity) => {
  current = next;
  for (const l of listeners) l();
};

const liveView = (actions: MidnightAction[], state: string): MidnightActivity => ({
  source: "live",
  asOf: Date.now(),
  actions,
  calls: countCalls(actions),
  isMirrored: (id) => stateHasPolicy(state, id),
  record: (id) => policyRecordFromState(state, id),
  error: null,
});

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const buf: MidnightAction[] = [];
  let state = "";
  let live = false;
  watchContractActions(MIDNIGHT_PREPROD.contractAddress, MIDNIGHT_PREPROD.deployBlock, {
    onAction: (a) => {
      buf.push(a);
      if (live) set(liveView([...buf], state));
    },
    onCaughtUp: (l) => {
      live = true;
      state = l.state;
      retryMs = 5_000;
      set(liveView([...buf], state));
    },
    onLiveState: (s) => {
      state = s;
      set(liveView([...buf], state));
    },
    onError: (e) => {
      // Keep whatever we last showed (live or snapshot), note the error, retry with backoff.
      set({ ...current, error: e.message });
      started = false;
      const wait = retryMs;
      retryMs = Math.min(retryMs * 2, 120_000);
      setTimeout(() => listeners.size > 0 && start(), wait);
    },
  }, { knownPolicyIds });
}

function subscribe(l: () => void) {
  listeners.add(l);
  start();
  return () => listeners.delete(l);
}

const initial = current;

export function useMidnightActivity(): MidnightActivity {
  return useSyncExternalStore(subscribe, () => current, () => initial);
}
