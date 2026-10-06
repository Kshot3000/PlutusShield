/**
 * Step 1 of the Preview runbook. Creates (or reuses) the local deployer and
 * oracle keys, derives every id that depends only on them, and writes the
 * public part to deployments/preview.json. Prints the one address to fund.
 */
import { textHex } from "../../../../packages/sdk/src/cardano.ts";
import { PREVIEW_MOCK_USDC_ASSET_NAME } from "../../../../packages/sdk/src/assets.ts";
import { loadConfig } from "../lib/cover.ts";
import { KEYS_DIR, loadKey, sigPolicy } from "../lib/keys.ts";
import { DEPLOYMENT_FILE, toJson, writeDeploymentFile, type DeploymentFile } from "../lib/chain.ts";
import { existsSync, readFileSync } from "node:fs";

const cfg = loadConfig();
const deployer = loadKey("deployer", "Preview", true);
const oracle = loadKey("oracle", "Preview", true);
const usdc = sigPolicy(deployer.keyHash);
const oraclePolicy = cfg.oracle.policyId ?? sigPolicy(oracle.keyHash).policyId;

const prev: Partial<DeploymentFile> = existsSync(DEPLOYMENT_FILE) ? JSON.parse(readFileSync(DEPLOYMENT_FILE, "utf8")) : {};
const file: DeploymentFile = {
  ...prev,
  network: "Preview",
  status: prev.status ?? "awaiting-funding",
  generatedAt: new Date().toISOString(),
  deployer: { address: deployer.address, keyHash: deployer.keyHash },
  oracle: { keyHash: oracle.keyHash, policyId: oraclePolicy, feeds: cfg.oracle.feeds, quorum: cfg.oracle.quorum },
  mockUsdc: {
    policyId: usdc.policyId,
    assetName: PREVIEW_MOCK_USDC_ASSET_NAME,
    unit: usdc.policyId + PREVIEW_MOCK_USDC_ASSET_NAME,
    ticker: "tUSDCx",
    decimals: 6,
  },
  assets: prev.assets ?? [],
};
writeDeploymentFile(file);

console.log(`keys in ${KEYS_DIR} (gitignored, never commit them)`);
console.log(toJson({ deployer: file.deployer, oracle: file.oracle, mockUsdc: file.mockUsdc }));
console.log(`feed token names: ${cfg.oracle.feeds.map((f) => `${f}=${textHex(f)}`).join(", ")}`);
console.log("\nHUMAN STEP: fund the deployer from the Cardano testnet faucet (network: Preview):");
console.log("  https://docs.cardano.org/cardano-testnets/tools/faucet");
console.log(`  address: ${deployer.address}`);
console.log("Then: pnpm preview status");
