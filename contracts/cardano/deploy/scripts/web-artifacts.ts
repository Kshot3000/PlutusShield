/**
 * Export the public pieces of the Preview deployment the browser needs to
 * build transactions: the parameter-applied cover script (Lucid-ready CBOR),
 * its hash/address, the pool NFT unit, the tranche assets, the full
 * CoverParams (product terms, premium floors, oracle allowlist, sale guard)
 * and the address the Preview test oracle publishes its feed UTxOs to.
 *
 *   pnpm web-artifacts   -> apps/web/src/data/preview-deployment.json
 *
 * Everything written is public on-chain data. No keys.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { credentialToAddress, validatorToScriptHash } from "@lucid-evolution/lucid";
import { deployment } from "../lib/cover.ts";
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
