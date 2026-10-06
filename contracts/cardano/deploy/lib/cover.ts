/**
 * PlutusShield cover script: parameters, application, addresses, and chain
 * state decoding. All datum/redeemer bytes come from @plutusshield/sdk, the
 * same encoders the SDK tests pin to the Aiken golden vectors.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyDoubleCborEncoding,
  applyParamsToScript,
  Data,
  mintingPolicyToId,
  validatorToAddress,
  type Network,
  type Script,
  type UTxO,
} from "@lucid-evolution/lucid";
import {
  ADA,
  DAY_MS,
  POOL_NFT,
  assetTerms,
  coverParamsData,
  depegTrigger,
  productTerms,
  textHex,
  toCborHex,
  type AssetClass,
  type AssetTerms,
  type CoverParams,
  type OutputReference,
  type PoolDatum,
  type PolicyDatum,
} from "../../../../packages/sdk/src/cardano.ts";
import { PREVIEW_MOCK_USDC_ASSET_NAME, USDCX_MAINNET, USDCX_PREPROD } from "../../../../packages/sdk/src/assets.ts";
import type { ProductId, RiskTier } from "../../../../packages/sdk/src/products.ts";
import { DEPLOY_DIR } from "./keys.ts";

export interface DeployConfig {
  network: "Preview" | "Preprod" | "Mainnet";
  product: { id: ProductId; tier: RiskTier; coveredAsset: string };
  assets: { kind: "ada" | "preview-mock-usdc" | "usdcx"; minPremium: number }[];
  oracle: { policy?: string; policyId?: string; feeds: string[]; quorum: number };
  claimGraceDays: number;
  poolMinLovelace: number;
}

export const loadConfig = (file = join(DEPLOY_DIR, "preview.config.json")): DeployConfig =>
  JSON.parse(readFileSync(file, "utf8"));

/** Which "USDC" a config entry means, per network. See packages/sdk/src/assets.ts. */
export function resolveAsset(kind: DeployConfig["assets"][number]["kind"], network: DeployConfig["network"], mockUsdcPolicyId?: string): AssetClass {
  if (kind === "ada") return ADA;
  if (kind === "usdcx") {
    if (network === "Mainnet") return USDCX_MAINNET;
    if (network === "Preprod") return USDCX_PREPROD;
    throw new Error("Circle USDCx does not exist on Preview; use kind 'preview-mock-usdc'");
  }
  if (!mockUsdcPolicyId) throw new Error("preview-mock-usdc needs the deployer's mock tUSDCx policy id");
  return { policyId: mockUsdcPolicyId, assetName: PREVIEW_MOCK_USDC_ASSET_NAME };
}

export function buildParams(cfg: DeployConfig, seed: OutputReference, oraclePolicyId: string, mockUsdcPolicyId?: string): CoverParams {
  const assets: AssetTerms[] = cfg.assets.map((a) =>
    assetTerms(resolveAsset(a.kind, cfg.network, mockUsdcPolicyId), 1_000_000n, a.minPremium),
  );
  return {
    seed,
    assets,
    product: productTerms(cfg.product.id, cfg.product.tier, depegTrigger(textHex(cfg.product.coveredAsset))),
    oracle: { policyId: oraclePolicyId, feeds: cfg.oracle.feeds.map(textHex), quorum: BigInt(cfg.oracle.quorum) },
    claimGraceMs: BigInt(cfg.claimGraceDays) * DAY_MS,
  };
}

export function unappliedCode(blueprintPath = join(DEPLOY_DIR, "..", "plutus.json")): string {
  const bp = JSON.parse(readFileSync(blueprintPath, "utf8"));
  const v = bp.validators.find((x: { title: string }) => x.title === "cover.cover.mint");
  if (!v) throw new Error("cover.cover.mint not in plutus.json; run `aiken build`");
  return v.compiledCode;
}

export interface Deployment {
  network: Network;
  params: CoverParams;
  paramsCbor: string;
  script: Script;
  /** Script hash = minting policy id of every PlutusShield token. */
  policyId: string;
  address: string;
  poolNftUnit: string;
}

export function deployment(network: Network, params: CoverParams): Deployment {
  const paramsCbor = toCborHex(coverParamsData(params));
  const code = applyParamsToScript(applyDoubleCborEncoding(unappliedCode()), [Data.from(paramsCbor)]);
  const script: Script = { type: "PlutusV3", script: code };
  const policyId = mintingPolicyToId(script);
  return {
    network,
    params,
    paramsCbor,
    script,
    policyId,
    address: validatorToAddress(network, script),
    poolNftUnit: policyId + POOL_NFT,
  };
}

/** Lucid unit for an asset class ("lovelace" for ada). */
export const unitOf = (a: AssetClass) => (a.policyId === "" ? "lovelace" : a.policyId + a.assetName);

/** Tranche capitals of a pool UTxO, in params.assets order. */
export const capitalsOf = (utxo: UTxO, assets: AssetTerms[]) => assets.map((a) => utxo.assets[unitOf(a.asset)] ?? 0n);

// ---------------------------------------------------------------- decoding

type D = ReturnType<typeof Data.from>;
const constrOf = (d: D, index?: number) => {
  const c = d as unknown as { index: number; fields: D[] };
  if (typeof c?.index !== "number" || (index !== undefined && c.index !== index)) throw new Error("unexpected datum shape");
  return c.fields;
};

export function decodeCoverDatum(cbor: string): { kind: "Pool"; pool: PoolDatum } | { kind: "Policy"; policy: PolicyDatum } {
  const outer = Data.from(cbor) as unknown as { index: number; fields: D[] };
  if (outer.index === 0) {
    const [pool] = constrOf(outer as unknown as D, 0);
    const [tranches] = constrOf(pool, 0);
    return {
      kind: "Pool",
      pool: {
        tranches: (tranches as unknown as D[]).map((t) => {
          const [s, a] = constrOf(t, 0) as unknown as bigint[];
          return { totalShares: s, activeCover: a };
        }),
      },
    };
  }
  const [p] = constrOf(outer as unknown as D, 1);
  const [policyId, productId, asset, coverage, premium, start, expiry, trigger, midnightCommitment] = constrOf(p, 0);
  const [ap, an] = constrOf(asset, 0) as unknown as string[];
  const [ca, th, w] = constrOf(trigger, 0) as unknown as [string, bigint, bigint];
  return {
    kind: "Policy",
    policy: {
      policyId: policyId as unknown as string,
      productId: productId as unknown as string,
      asset: { policyId: ap, assetName: an },
      coverage: coverage as unknown as bigint,
      premium: premium as unknown as bigint,
      start: start as unknown as bigint,
      expiry: expiry as unknown as bigint,
      trigger: { coveredAsset: ca, thresholdBps: th, windowMs: w },
      midnightCommitment: midnightCommitment as unknown as string,
    },
  };
}
