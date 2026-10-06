/** Preview chain access: Koios by default (no API key), Blockfrost if BLOCKFROST_PROJECT_ID is set. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Blockfrost, Koios, Lucid, type LucidEvolution } from "@lucid-evolution/lucid";
import type { CoverParams } from "../../../../packages/sdk/src/cardano.ts";
import { DEPLOY_DIR } from "./keys.ts";

export async function previewLucid(): Promise<LucidEvolution> {
  const bf = process.env.BLOCKFROST_PROJECT_ID;
  const provider = bf
    ? new Blockfrost("https://cardano-preview.blockfrost.io/api/v0", bf)
    : new Koios(process.env.KOIOS_URL ?? "https://preview.koios.rest/api/v1");
  return Lucid(provider, "Preview");
}

export const DEPLOYMENT_FILE = join(DEPLOY_DIR, "deployments", "preview.json");

/** JSON with bigints as strings. */
export const toJson = (x: unknown) => JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n";

export interface DeploymentFile {
  network: "Preview";
  status: "awaiting-funding" | "planned" | "initialised";
  generatedAt: string;
  deployer: { address: string; keyHash: string };
  oracle: { keyHash: string; policyId: string; feeds: string[]; quorum: number };
  mockUsdc: { policyId: string; assetName: string; unit: string; ticker: string; decimals: number };
  assets: { tranche: number; asset: string; lpToken: string; minPremium: string }[];
  script?: { hash: string; address: string; poolNft: string; paramsCbor: string; seed: string; aikenApplyMatches?: boolean };
  txs?: Record<string, string>;
  params?: CoverParams;
}

export function readDeploymentFile(): DeploymentFile {
  if (!existsSync(DEPLOYMENT_FILE)) throw new Error("no deployments/preview.json; run `pnpm keygen` then `pnpm plan`");
  return JSON.parse(readFileSync(DEPLOYMENT_FILE, "utf8"));
}

export const writeDeploymentFile = (f: DeploymentFile) => writeFileSync(DEPLOYMENT_FILE, toJson(f));

/** Revive bigint fields of CoverParams after a JSON round-trip. */
export function reviveParams(p: CoverParams): CoverParams {
  const b = (x: unknown) => BigInt(x as string);
  return {
    seed: p.seed,
    assets: p.assets.map((a) => ({ asset: a.asset, minPremium: b(a.minPremium) })),
    product: {
      ...p.product,
      trigger: { ...p.product.trigger, thresholdBps: b(p.product.trigger.thresholdBps), windowMs: b(p.product.trigger.windowMs) },
      baseRateBps: b(p.product.baseRateBps),
      riskMultBps: b(p.product.riskMultBps),
      minDays: b(p.product.minDays),
      maxDays: b(p.product.maxDays),
      maxSinglePolicyBps: b(p.product.maxSinglePolicyBps),
      maxUtilizationBps: b(p.product.maxUtilizationBps),
    },
    oracle: { ...p.oracle, quorum: b(p.oracle.quorum) },
    claimGraceMs: b(p.claimGraceMs),
  };
}
