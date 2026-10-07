"use client";

/**
 * Live activity of the Midnight Preprod policy-cover v2 contract (M-of-3
 * committee voteClaim). Same pattern as useMidnightActivity: start from the
 * build-time snapshot (scripts/snapshot-midnight.mjs), switch to the indexer
 * stream once history replays, keep the last view and retry with backoff if the
 * indexer can't be reached. Read-only: no wallet, no keys.
 */
import { useSyncExternalStore } from "react";
import snapshot from "@/data/midnight-preprod-v2-activity.json";
import { MIDNIGHT_V2 } from "@/lib/midnightPreprodV2";
import { countCalls, policyRecordFromState, stateHasPolicy, watchContractActions, type MidnightAction, type MidnightPolicyRecord } from "@/lib/midnightIndexer";
import { RELAY_SNAPSHOT } from "@/lib/useMidnightActivity";
import type { MirrorState } from "@plutusshield/sdk/relay";

export type MidnightV2Activity = {
  source: "snapshot" | "live";
  /** ms; snapshot time, or the last live update. */
  asOf: number;
  actions: MidnightAction[];
  calls: Record<string, number>;
  /** Is this policy id in the v2 registry: live state, else the snapshot. */
  isMirrored: (policyId: string) => boolean;
  /** The policy's v2 record (status, evidence, claim round): live state, else the snapshot. */
  record: (policyId: string) => MidnightPolicyRecord | null;
  error: string | null;
};

const snapActions = (snapshot.actions ?? []) as MidnightAction[];
const snapRecords = new Map(((snapshot.policyRecords ?? []) as MidnightPolicyRecord[]).map((r) => [r.policyId.toLowerCase(), r]));
const snapMirrored = new Set([...(((snapshot as { mirroredPolicyIds?: string[] }).mirroredPolicyIds ?? []) as string[]), ...snapRecords.keys()].map((x) => x.toLowerCase()));
/** Every policy id we know about (v2 record + the Preview relay plan), so the decoder also finds ids that end in zero bytes. */
const knownPolicyIds = [
  ...new Set([...MIDNIGHT_V2.registrations.map((r) => r.policyId), ...MIDNIGHT_V2.claims.map((c) => c.policyId), ...RELAY_SNAPSHOT.policies.map((p) => p.policyId)].map((x) => x.toLowerCase())),
];

export type RelayPolicyV2 = { policyId: string; state: MirrorState };
/** The relay plan against the v2 registry, baked at build time ("mirrored" is re-read live). */
export const RELAY_SNAPSHOT_V2: { policies: RelayPolicyV2[] } = {
  policies: ((snapshot as { relay?: { policies: RelayPolicyV2[] } }).relay?.policies ?? []).map((p) => ({ ...p, policyId: p.policyId.toLowerCase() })),
};

let current: MidnightV2Activity = {
  source: "snapshot",
  asOf: Date.parse(snapshot.takenAt),
  actions: snapActions,
  calls: countCalls(snapActions),
  isMirrored: (id) => snapMirrored.has(id.toLowerCase()),
  record: (id) => snapRecords.get(id.toLowerCase()) ?? null,
  error: null,
};
const listeners = new Set<() => void>();
let started = false;
let retryMs = 5_000;

const set = (next: MidnightV2Activity) => {
  current = next;
  for (const l of listeners) l();
};

const liveView = (actions: MidnightAction[], state: string): MidnightV2Activity => ({
  source: "live",
  asOf: Date.now(),
  actions,
  calls: countCalls(actions),
  isMirrored: (id) => stateHasPolicy(state, id),
  record: (id) => policyRecordFromState(state, id) ?? snapRecords.get(id.toLowerCase()) ?? null,
  error: null,
});

function start() {
  if (started || typeof window === "undefined" || !MIDNIGHT_V2.contractAddress) return;
  started = true;
  const buf: MidnightAction[] = [];
  let state = "";
  let live = false;
  watchContractActions(
    MIDNIGHT_V2.contractAddress,
    MIDNIGHT_V2.deployBlock ?? 0,
    {
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
        set({ ...current, error: e.message });
        started = false;
        const wait = retryMs;
        retryMs = Math.min(retryMs * 2, 120_000);
        setTimeout(() => listeners.size > 0 && start(), wait);
      },
    },
    { knownPolicyIds },
  );
}

function subscribe(l: () => void) {
  listeners.add(l);
  start();
  return () => listeners.delete(l);
}

const initial = current;

export function useMidnightV2Activity(): MidnightV2Activity {
  return useSyncExternalStore(subscribe, () => current, () => initial);
}
