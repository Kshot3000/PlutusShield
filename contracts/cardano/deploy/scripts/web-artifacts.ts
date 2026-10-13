/**
 * Export the public pieces of the Preview deployment the browser needs to
 * build transactions: the parameter-applied cover script (Lucid-ready CBOR),
 * its hash/address, the pool NFT unit, the tranche assets, the full
 * CoverParams (product terms, premium floors, oracle allowlist, sale guard)
 * and the address the Preview test oracle publishes its feed UTxOs to.
 *
 *   pnpm web-artifacts   -> apps/web/src/data/preview-deployment.json
 *                           apps/web/src/data/preview-exploit-v2-deployment.json
 *
 * The second file is the exploit-cover v2 pool (2-of-3 assessor committee):
 * the same shape, so the /cover exploit Buy runs the same buildBuy. It has
 * no oracle (exploit cover is assessed, not oracle-triggered).
 *
 * Everything written is public on-chain data. No keys.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { credentialToAddress, validatorToScriptHash } from "@lucid-evolution/lucid";
import { readFileSync } from "node:fs";
import { deployment, exploitDeployment } from "../lib/cover.ts";
import { committeeFromJson } from "../../../../packages/sdk/src/cardano.ts";
import { readDeploymentFile, reviveParams, toJson } from "../lib/chain.ts";
import { DEPLOY_DIR } from "../lib/keys.ts";

const file = readDeploymentFile();
if (!file.params || !file.script) throw new Error("Preview deployment isn't planned yet");
const d = deployment("Preview", reviveParams(file.params));
if (validatorToScriptHash(d.script) !== file.script.hash) throw new Error("applied script hash doesn't match deployments/preview.json");

const out = {
  network: "Preview",
  generatedAt: new Date().toISOString(),
  scriptHash: d.policyId,
  address: d.address,
  poolNftUnit: d.poolNftUnit,
  maxUtilizationBps: d.params.product.maxUtilizationBps,
  assets: d.params.assets.map((a) => ({ policyId: a.asset.policyId, assetName: a.asset.assetName })),
  params: d.params,
  oracle: {
    policyId: d.params.oracle.policyId,
    feeds: file.oracle.feeds,
    // Feed UTxOs sit at the oracle key's enterprise address (see scripts/preview.ts `peg`).
    address: credentialToAddress("Preview", { type: "Key", hash: file.oracle.keyHash }),
  },
  script: d.script,
};
const target = join(DEPLOY_DIR, "..", "..", "..", "apps", "web", "src", "data", "preview-deployment.json");
writeFileSync(target, toJson(out));
console.log(`wrote ${target} (script ${d.script.script.length / 2} bytes, hash ${d.policyId})`);

// ---------------------------------------------------------------- exploit cover v2
const exploitFile = join(DEPLOY_DIR, "deployments", "preview-exploit-v2.json");
const ex = JSON.parse(readFileSync(exploitFile, "utf8"));
const committee = committeeFromJson({ assessors: ex.committee.assessors.map((a: { keyHash: string }) => a.keyHash), threshold: ex.committee.threshold });
const e = exploitDeployment("Preview", reviveParams(ex.params), committee);
if (validatorToScriptHash(e.script) !== ex.script.hash) throw new Error("applied exploit v2 script hash doesn't match deployments/preview-exploit-v2.json");
const exploitOut = {
  network: "Preview",
  product: "exploit",
  version: ex.version ?? "v2",
  generatedAt: new Date().toISOString(),
  scriptHash: e.policyId,
  address: e.address,
  poolNftUnit: e.poolNftUnit,
  maxUtilizationBps: e.params.product.maxUtilizationBps,
  assets: e.params.assets.map((a) => ({ policyId: a.asset.policyId, assetName: a.asset.assetName })),
  params: e.params,
  committee: { threshold: committee.threshold, assessors: committee.assessors },
  script: e.script,
};
const exploitTarget = join(DEPLOY_DIR, "..", "..", "..", "apps", "web", "src", "data", "preview-exploit-v2-deployment.json");
writeFileSync(exploitTarget, toJson(exploitOut));
console.log(`wrote ${exploitTarget} (script ${e.script.script.length / 2} bytes, hash ${e.policyId})`);
