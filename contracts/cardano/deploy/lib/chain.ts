/** Preview chain access: Koios by default (no API key), Blockfrost if BLOCKFROST_PROJECT_ID is set. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Blockfrost, Koios, Lucid, type LucidEvolution } from "@lucid-evolution/lucid";
import { coverParamsFromJson, type CoverParams, type CoverParamsJson } from "../../../../packages/sdk/src/cardano.ts";
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

/** Revive bigint fields of CoverParams after a JSON round-trip (same reviver the website uses). */
export const reviveParams = (p: CoverParams): CoverParams => coverParamsFromJson(p as unknown as CoverParamsJson);
