#!/usr/bin/env node
/**
 * Snapshot the live Midnight Preprod policy-cover contract's activity into
 * src/data/midnight-preprod-activity.json, so the static site has real Midnight
 * state to show even when a browser can't reach the indexer. Runs as part of
 * `pnpm build` (Node 22 type stripping loads src/lib/midnightIndexer.ts).
 * Non-fatal: on any error the committed snapshot is kept.
 */
import { readFileSync, writeFileSync } from "node:fs";

const OUT = new URL("../src/data/midnight-preprod-activity.json", import.meta.url);
const RECORD = new URL("../../../contracts/midnight/deployments/preprod.json", import.meta.url);

try {
  const { watchContractActions, stateHasPolicy } = await import("../src/lib/midnightIndexer.ts");
  const record = JSON.parse(readFileSync(RECORD, "utf8"));
  const actions = [];
  const latest = await new Promise((resolve, reject) => {
    const stop = watchContractActions(record.contractAddress, record.blockHeight, {
      onAction: (a) => actions.push(a),
      onCaughtUp: (l) => (stop(), resolve(l)),
      onError: reject,
    }, { timeoutMs: 30_000 });
  });
  const mirroredPolicyIds = (record.registrations ?? []).map((r) => r.policyId).filter((id) => stateHasPolicy(latest.state, id));
  writeFileSync(
    OUT,
    JSON.stringify({ takenAt: new Date().toISOString(), address: record.contractAddress, fromHeight: record.blockHeight, actions, mirroredPolicyIds }, null, 1) + "\n",
  );
  console.log(`midnight snapshot: ${actions.length} actions, ${mirroredPolicyIds.length} mirrored policies`);
} catch (e) {
  console.warn(`midnight snapshot skipped (${e instanceof Error ? e.message : e}); keeping the committed snapshot`);
}
process.exit(0);
