#!/usr/bin/env node
/**
 * Dry run of the Midnight relay: `pnpm --filter @plutusshield/midnight-contracts relay:plan`
 *
 * Lists every live PlutusShield policy on Cardano Preview with its Midnight
 * mirror state (mirrored / ready / awaiting-key / pre-binding), reading
 * Cardano from Koios and Midnight from the public Preprod indexer. No wallet,
 * no proof server, no transactions. Key dirs (comma-separated) come from
 * PLUTUSSHIELD_POLICY_KEY_DIRS; only whether a key exists is printed.
 *   --json   machine-readable output
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { latestContractAction, stateHasPolicy } from "../../../apps/web/src/lib/midnightIndexer.ts";
import { MIRROR_STATE_LABEL, mirrorSummary } from "../../../packages/sdk/src/relay.ts";
import { buildRelayPlan, publicEntry } from "./plan.ts";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const dep = JSON.parse(readFileSync(join(ROOT, "apps/web/src/data/preview-deployment.json"), "utf8"));
const record = JSON.parse(readFileSync(join(ROOT, "contracts/midnight/deployments/preprod.json"), "utf8"));
const keyDirs = (process.env.PLUTUSSHIELD_POLICY_KEY_DIRS ?? join(ROOT, "contracts/cardano/deploy/.keys/policy-keys")).split(",").filter(Boolean);

const latest = await latestContractAction(record.contractAddress);
if (!latest) throw new Error(`policy-cover ${record.contractAddress} not found on the Preprod indexer`);
const plan = await buildRelayPlan({ deployment: dep, keyDirs, isMirrored: (id) => stateHasPolicy(latest.state, id) });
const sum = mirrorSummary(plan);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ contractAddress: record.contractAddress, midnightHeight: latest.action.height, summary: sum, policies: plan.map(publicEntry) }, null, 2));
} else {
  console.log(`policy-cover ${record.contractAddress.slice(0, 16)}… at Preprod block ${latest.action.height}`);
  for (const e of plan) {
    const how = e.state === "ready" ? ` via ${e.source}${e.canProve ? " + proveCover" : ""}` : "";
    console.log(`${e.policyId.slice(0, 16)}…  ${MIRROR_STATE_LABEL[e.state].padEnd(28)}${how}${e.badTicket ? "  (ticket does not open the datum: ignored)" : ""}  buy ${e.buyTx.slice(0, 12)}…`);
  }
  console.log(`\n${sum.mirrored} of ${sum.total} live Preview policies mirrored; ${sum.ready} ready to relay, ${sum["awaiting-key"]} awaiting holder key, ${sum["pre-binding"]} pre-binding`);
}
