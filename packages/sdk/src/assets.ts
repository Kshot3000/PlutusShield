/**
 * Pool currencies PlutusShield accepts on Cardano, per network.
 *
 * PlutusShield's "USDC" on Cardano is **USDCx**: Circle's USDC-backed native
 * asset, issued through Circle xReserve (live on mainnet since 2026-02-27).
 * It is a plain Cardano native asset with 6 decimals, so a pool tranche just
 * holds it like any other token.
 *
 *   mainnet  1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34 . 5553444378 ("USDCx")
 *            fingerprint asset1e7eewpjw8ua3f2gpfx7y34ww9vjl63hayn80kl
 *   preprod  31dde3db98ad05feb688d4dbb146b3b6054e1246cbcef98c79b0bf66 . 5553444378 ("USDCx")
 *            fingerprint asset1ejelsh8crza8dyghxzsjhkjqutzr7q3dnregng
 *   preview  no Circle deployment. PlutusShield mints its own mock **tUSDCx**
 *            under a deployer-key native script (see contracts/cardano/deploy).
 *            Its policy id is only known once the deployer key exists, so it
 *            is read from the deployment file / env, never hard-coded.
 *
 * Sources: developers.circle.com/xreserve/references/supported-blockchains-and-domains,
 * cardano-foundation/cardano-token-registry (decimals = 6).
 */
import { ADA, type AssetClass } from "./cardano.ts";

export type CardanoNetwork = "mainnet" | "preprod" | "preview";
export type Currency = "ADA" | "USDC";

export interface CurrencyInfo {
  id: Currency;
  /** What the user sees. */
  symbol: string;
  /** Token ticker on-chain. */
  ticker: string;
  decimals: number;
  /** Base units per whole unit (10 ** decimals). */
  unit: bigint;
}

export const CURRENCIES: Record<Currency, CurrencyInfo> = {
  ADA: { id: "ADA", symbol: "ADA", ticker: "ADA", decimals: 6, unit: 1_000_000n },
  USDC: { id: "USDC", symbol: "USDC", ticker: "USDCx", decimals: 6, unit: 1_000_000n },
};

/** hex("USDCx") */
export const USDCX_ASSET_NAME = "5553444378";
/** hex("tUSDCx"), the Preview mock minted by the deploy scripts. */
export const PREVIEW_MOCK_USDC_ASSET_NAME = "745553444378";

export const USDCX_MAINNET: AssetClass = {
  policyId: "1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34",
  assetName: USDCX_ASSET_NAME,
};

export const USDCX_PREPROD: AssetClass = {
  policyId: "31dde3db98ad05feb688d4dbb146b3b6054e1246cbcef98c79b0bf66",
  assetName: USDCX_ASSET_NAME,
};

/**
 * Asset class for a currency on a network. On Preview, pass the mock
 * tUSDCx policy id produced by `deploy/scripts/keygen.ts`
 * (NEXT_PUBLIC_PREVIEW_USDC_POLICY_ID in the web app).
 */
export function currencyAsset(c: Currency, network: CardanoNetwork, previewUsdcPolicyId?: string): AssetClass {
  if (c === "ADA") return ADA;
  if (network === "mainnet") return USDCX_MAINNET;
  if (network === "preprod") return USDCX_PREPROD;
  if (!previewUsdcPolicyId || !/^[0-9a-f]{56}$/i.test(previewUsdcPolicyId))
    throw new Error("Preview has no Circle USDCx: pass the mock tUSDCx policy id from the deployment");
  return { policyId: previewUsdcPolicyId.toLowerCase(), assetName: PREVIEW_MOCK_USDC_ASSET_NAME };
}

/** "<policy>.<name>" with ada as "lovelace", for display and env files. */
export const assetId = (a: AssetClass) => (a.policyId === "" ? "lovelace" : `${a.policyId}.${a.assetName}`);
