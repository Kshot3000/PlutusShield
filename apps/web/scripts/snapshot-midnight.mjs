#!/usr/bin/env node
/**
 * Snapshot the live Midnight Preprod policy-cover contract's activity into
 * src/data/midnight-preprod-activity.json, so the static site has real Midnight
 * state to show even when a browser can't reach the indexer. Runs as part of
 * `pnpm build` (Node 22 type stripping loads src/lib/midnightIndexer.ts).
 * Also bakes the relay plan (contracts/midnight/relay/plan.ts) without any
 * local keys: every live Preview policy with its Midnight mirror state
 * (mirrored / ready = Buy ticket opens the datum / awaiting-key / pre-binding).
 * Also bakes each known policy's Midnight record (status ACTIVE / CLAIM_PENDING /
 * PAID / EXPIRED and evidence commitment, decoded from the serialized state)
 * and per-action policy changes (claim filed / approved / rejected) for the
 * activity feed. Non-fatal: on any error the committed snapshot is kept.
 */
import { readFileSync, writeFileSync } from "node:fs";

const OUT = new URL("../src/data/midnight-preprod-activity.json", import.meta.url);
const RECORD = new URL("../../../contracts/midnight/deployments/preprod.json", import.meta.url);
const DEPLOYMENT = new URL("../src/data/preview-deployment.json", import.meta.url);

try {
  const { watchContractActions, stateHasPolicy, policyRecordsFromState } = await import("../src/lib/midnightIndexer.ts");
  const record = JSON.parse(readFileSync(RECORD, "utf8"));
  const knownPolicyIds = [...new Set([...(record.registrations ?? []).map((r) => r.policyId), ...(record.claims ?? []).map((c) => c.policyId)])];
  const actions = [];
  const latest = await new Promise((resolve, reject) => {
    const stop = watchContractActions(record.contractAddress, record.blockHeight, {
      onAction: (a) => actions.push(a),
      onCaughtUp: (l) => (stop(), resolve(l)),
      onError: reject,
    }, { timeoutMs: 60_000, knownPolicyIds });
  });
  const { buildRelayPlan, publicEntry } = await import("../../../contracts/midnight/relay/plan.ts");
  const { mirrorSummary } = await import("../../../packages/sdk/src/relay.ts");
  const plan = await buildRelayPlan({ deployment: JSON.parse(readFileSync(DEPLOYMENT, "utf8")), keyDirs: [], isMirrored: (id) => stateHasPolicy(latest.state, id) });
  const relay = { summary: mirrorSummary(plan), policies: plan.map(publicEntry) };
  const policyRecords = policyRecordsFromState(latest.state, [...knownPolicyIds, ...plan.map((e) => e.policyId)]);
  const mirroredPolicyIds = [...new Set([...(record.registrations ?? []).map((r) => r.policyId), ...plan.map((e) => e.policyId)])].filter((id) => stateHasPolicy(latest.state, id));
  writeFileSync(
    OUT,
    JSON.stringify({ takenAt: new Date().toISOString(), address: record.contractAddress, fromHeight: record.blockHeight, actions, mirroredPolicyIds, policyRecords, relay }, null, 1) + "\n",
  );
  const n = relay.summary;
  const byStatus = policyRecords.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
  console.log(`midnight snapshot: ${actions.length} actions, ${mirroredPolicyIds.length} mirrored (${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(", ")}); relay: ${n.mirrored}/${n.total} live Preview policies mirrored, ${n.ready} ready, ${n["awaiting-key"]} awaiting key, ${n["pre-binding"]} pre-binding`);
} catch (e) {
  console.warn(`midnight snapshot skipped (${e instanceof Error ? e.message : e}); keeping the committed snapshot`);
}

/*
 * policy-cover v2 (M-of-3 committee voteClaim). The relay writes
 * contracts/midnight/deployments/preprod-v2.json; copy it into the site so the
 * committee panel never drifts from the record, then bake the v2 contract's
 * action history and decoded policy records (6-field v2 records, with claim
 * round) for the live committee strip's offline fallback.
 */
const V2_RECORD = new URL("../../../contracts/midnight/deployments/preprod-v2.json", import.meta.url);
const V2_COPY = new URL("../src/data/midnight-preprod-v2.json", import.meta.url);
const V2_OUT = new URL("../src/data/midnight-preprod-v2-activity.json", import.meta.url);
try {
  const raw = readFileSync(V2_RECORD, "utf8");
  if (readFileSync(V2_COPY, "utf8") !== raw) {
    writeFileSync(V2_COPY, raw);
    console.log("midnight v2: synced src/data/midnight-preprod-v2.json from the Preprod record");
  }
  const v2 = JSON.parse(raw);
  if (!v2.contractAddress) throw new Error("v2 not deployed yet");
  const { watchContractActions, policyRecordsFromState } = await import("../src/lib/midnightIndexer.ts");
  const ids = [...new Set([...(v2.registrations ?? []).map((r) => r.policyId), ...(v2.claims ?? []).map((c) => c.policyId)])];
  const actions = [];
  const latest = await new Promise((resolve, reject) => {
    const stop = watchContractActions(v2.contractAddress, v2.blockHeight, {
      onAction: (a) => actions.push(a),
      onCaughtUp: (l) => (stop(), resolve(l)),
      onError: reject,
    }, { timeoutMs: 60_000, knownPolicyIds: ids });
  });
  const policyRecords = policyRecordsFromState(latest.state, ids);
  writeFileSync(V2_OUT, JSON.stringify({ takenAt: new Date().toISOString(), address: v2.contractAddress, fromHeight: v2.blockHeight, actions, policyRecords }, null, 1) + "\n");
  const votes = actions.filter((a) => a.entryPoint === "voteClaim" && a.status === "SUCCESS").length;
  console.log(`midnight v2 snapshot: ${actions.length} actions (${votes} committee votes), ${policyRecords.length} policies (${policyRecords.map((r) => r.status).join(", ")})`);
} catch (e) {
  console.warn(`midnight v2 snapshot skipped (${e instanceof Error ? e.message : e}); keeping the committed snapshot`);
}
process.exit(0);
