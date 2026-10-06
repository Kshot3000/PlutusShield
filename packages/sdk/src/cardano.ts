/**
 * Cardano on-chain shapes for PlutusShield (contracts/cardano, Aiken).
 *
 * - TypeScript mirrors of every datum, redeemer, and validator parameter
 * - Plutus Data builders + a CBOR encoder matching Plutus `serialiseData`
 * - Policy id / token name derivation identical to the validator
 * - An integer mirror of the on-chain premium floor and capacity rules
 *
 * Amounts are bigint base units (lovelace or a stablecoin's smallest unit),
 * times are POSIX milliseconds, rates are basis points. Byte strings are hex.
 *
 * Multi-asset: a pool holds one tranche per accepted asset (`CoverParams.assets`,
 * e.g. [ada, USDCx]). A policy is denominated in one tranche asset; its premium,
 * capacity, utilization pricing, and payout all use that tranche only.
 */
import { blake2b256 } from "./blake2b.ts";
import { PRODUCTS, RISK_MULTIPLIER, type ProductId, type RiskTier } from "./products.ts";
import { MAX_SINGLE_POLICY_SHARE, MAX_UTILIZATION, MIN_PREMIUM, UTILIZATION_KINK } from "./quote.ts";

// ------------------------------------------------------------- plutus data

export type PlutusData =
  | { constructor: number; fields: PlutusData[] }
  | { int: bigint }
  | { bytes: string }
  | { list: PlutusData[] }
  | { map: { k: PlutusData; v: PlutusData }[] };

const constr = (index: number, fields: PlutusData[] = []): PlutusData => ({ constructor: index, fields });
const int = (n: bigint | number): PlutusData => ({ int: BigInt(n) });
const bytes = (hex: string): PlutusData => {
  if (!/^([0-9a-f]{2})*$/i.test(hex)) throw new Error(`not hex: ${hex}`);
  return { bytes: hex.toLowerCase() };
};
const utf8Hex = (s: string) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");

/** Encode a UTF-8 label ("depeg", "USDM", "feed-a") to hex, as Aiken string literals in ByteArray position do. */
export const textHex = utf8Hex;

// ------------------------------------------------------------- types

export const BPS = 10_000n;
export const DAY_MS = 86_400_000n;

export interface AssetClass { policyId: string; assetName: string }
export const ADA: AssetClass = { policyId: "", assetName: "" };
export const isAda = (a: AssetClass) => a.policyId === "";
export const sameAsset = (a: AssetClass, b: AssetClass) =>
  a.policyId.toLowerCase() === b.policyId.toLowerCase() && a.assetName.toLowerCase() === b.assetName.toLowerCase();

/** One accepted pool currency (Aiken `AssetTerms`). Index in `CoverParams.assets` = tranche index. */
export interface AssetTerms { asset: AssetClass; minPremium: bigint }

export interface OutputReference { txHash: string; outputIndex: number }

export interface Trigger { coveredAsset: string; thresholdBps: bigint; windowMs: bigint }

export interface ProductTerms {
  productId: string;
  trigger: Trigger;
  baseRateBps: bigint;
  riskMultBps: bigint;
  minDays: bigint;
  maxDays: bigint;
  maxSinglePolicyBps: bigint;
  maxUtilizationBps: bigint;
}

export interface OracleConfig { policyId: string; feeds: string[]; quorum: bigint }

/**
 * Sale circuit-breaker (Aiken `SaleGuard`). Every Buy must land at least
 * `waitingPeriodMs` before the policy starts, and must reference a healthy-peg
 * reading (price >= trigger threshold) no older than `maxPriceAgeMs` from
 * EVERY allowlisted feed, not just a quorum.
 */
export interface SaleGuard { waitingPeriodMs: bigint; maxPriceAgeMs: bigint }

export interface CoverParams {
  seed: OutputReference;
  /** One tranche per entry, in order. Distinct, 1..=256 entries. */
  assets: AssetTerms[];
  product: ProductTerms;
  oracle: OracleConfig;
  claimGraceMs: bigint;
  saleGuard: SaleGuard;
}

/** A payment or stake credential (Aiken `VerificationKey(hash)` / `Script(hash)`). */
export interface Credential { type: "Key" | "Script"; hash: string }
/** A Cardano address as Plutus sees it. Stake pointers are not supported. */
export interface Address { payment: Credential; stake?: Credential }

/** One tranche's ledger (Aiken `Tranche`). Its capital is the pool UTxO's quantity of the tranche asset. */
export interface Tranche { totalShares: bigint; activeCover: bigint }
/** `tranches[i]` belongs to `CoverParams.assets[i]`. */
export interface PoolDatum { tranches: Tranche[] }

export interface PolicyDatum {
  policyId: string;
  productId: string;
  /** Currency of coverage, premium and payout; selects the tranche. */
  asset: AssetClass;
  coverage: bigint;
  premium: bigint;
  start: bigint;
  expiry: bigint;
  trigger: Trigger;
  midnightCommitment: string;
  /** Receives the reference UTxO's min-ada when the policy is expired. */
  refundTo: Address;
}

export interface OracleDatum { coveredAsset: string; priceBps: bigint; windowStart: bigint; windowEnd: bigint }

export type CoverDatum = { kind: "Pool"; pool: PoolDatum } | { kind: "Policy"; policy: PolicyDatum };
export type MintAction = "InitPool" | "ViaPool" | "BurnUserTokens";
export type PoolAction =
  | { kind: "Deposit"; tranche: number }
  | { kind: "Withdraw"; tranche: number; shares: bigint }
  | { kind: "Buy" }
  | { kind: "Settle" }
  | { kind: "Expire" };

// ------------------------------------------------------------- to data

export const outputReferenceData = (o: OutputReference) => constr(0, [bytes(o.txHash), int(o.outputIndex)]);
export const assetClassData = (a: AssetClass) => constr(0, [bytes(a.policyId), bytes(a.assetName)]);
export const triggerData = (t: Trigger) =>
  constr(0, [bytes(t.coveredAsset), int(t.thresholdBps), int(t.windowMs)]);

export const productTermsData = (p: ProductTerms) =>
  constr(0, [
    bytes(p.productId),
    triggerData(p.trigger),
    int(p.baseRateBps),
    int(p.riskMultBps),
    int(p.minDays),
    int(p.maxDays),
    int(p.maxSinglePolicyBps),
    int(p.maxUtilizationBps),
  ]);

export const oracleConfigData = (o: OracleConfig) =>
  constr(0, [bytes(o.policyId), { list: o.feeds.map(bytes) }, int(o.quorum)]);

export const assetTermsData = (a: AssetTerms) => constr(0, [assetClassData(a.asset), int(a.minPremium)]);

export const saleGuardData = (g: SaleGuard) => constr(0, [int(g.waitingPeriodMs), int(g.maxPriceAgeMs)]);

export const credentialData = (c: Credential) => constr(c.type === "Key" ? 0 : 1, [bytes(c.hash)]);
/** Plutus `Address { payment_credential, stake_credential: Option<Inline(cred)> }`. */
export const addressData = (a: Address) =>
  constr(0, [credentialData(a.payment), a.stake ? constr(0, [constr(0, [credentialData(a.stake)])]) : constr(1)]);

export const coverParamsData = (c: CoverParams) =>
  constr(0, [
    outputReferenceData(c.seed),
    { list: c.assets.map(assetTermsData) },
    productTermsData(c.product),
    oracleConfigData(c.oracle),
    int(c.claimGraceMs),
    saleGuardData(c.saleGuard),
  ]);

export const trancheData = (t: Tranche) => constr(0, [int(t.totalShares), int(t.activeCover)]);
export const poolDatumData = (d: PoolDatum) => constr(0, [{ list: d.tranches.map(trancheData) }]);

export const policyDatumData = (d: PolicyDatum) =>
  constr(0, [
    bytes(d.policyId),
    bytes(d.productId),
    assetClassData(d.asset),
    int(d.coverage),
    int(d.premium),
    int(d.start),
    int(d.expiry),
    triggerData(d.trigger),
    bytes(d.midnightCommitment),
    addressData(d.refundTo),
  ]);

export const coverDatumData = (d: CoverDatum) =>
  d.kind === "Pool" ? constr(0, [poolDatumData(d.pool)]) : constr(1, [policyDatumData(d.policy)]);

export const oracleDatumData = (d: OracleDatum) =>
  constr(0, [bytes(d.coveredAsset), int(d.priceBps), int(d.windowStart), int(d.windowEnd)]);

export const mintActionData = (a: MintAction) => constr(["InitPool", "ViaPool", "BurnUserTokens"].indexOf(a));

export const poolActionData = (a: PoolAction): PlutusData => {
  switch (a.kind) {
    case "Deposit": return constr(0, [int(a.tranche)]);
    case "Withdraw": return constr(1, [int(a.tranche), int(a.shares)]);
    case "Buy": return constr(2);
    case "Settle": return constr(3);
    case "Expire": return constr(4);
  }
};

// ------------------------------------------------------------- CBOR

/** CBOR encoding identical to the Plutus `serialiseData` builtin (and Aiken `cbor.serialise`). */
export function encodePlutusData(d: PlutusData): Uint8Array {
  const out: number[] = [];
  const head = (major: number, n: bigint): void => {
    const m = major << 5;
    if (n < 24n) out.push(m | Number(n));
    else if (n < 0x100n) out.push(m | 24, Number(n));
    else if (n < 0x10000n) out.push(m | 25, ...be(n, 2));
    else if (n < 0x100000000n) out.push(m | 26, ...be(n, 4));
    else out.push(m | 27, ...be(n, 8));
  };
  const be = (n: bigint, len: number) => {
    const b: number[] = [];
    for (let i = len - 1; i >= 0; i--) b.push(Number((n >> BigInt(8 * i)) & 0xffn));
    return b;
  };
  const rawBytes = (b: Uint8Array) => {
    if (b.length <= 64) {
      head(2, BigInt(b.length));
      out.push(...b);
    } else {
      out.push(0x5f);
      for (let i = 0; i < b.length; i += 64) {
        const c = b.subarray(i, i + 64);
        head(2, BigInt(c.length));
        out.push(...c);
      }
      out.push(0xff);
    }
  };
  const list = (xs: PlutusData[]): void => {
    if (xs.length === 0) {
      out.push(0x80);
      return;
    }
    out.push(0x9f);
    xs.forEach(go);
    out.push(0xff);
  };
  const go = (x: PlutusData): void => {
    if ("fields" in x) {
      const i = x.constructor;
      if (i < 7) head(6, BigInt(121 + i));
      else if (i < 128) head(6, BigInt(1280 + i - 7));
      else {
        head(6, 102n);
        out.push(0x82);
        go(int(i));
        return list(x.fields);
      }
      return list(x.fields);
    }
    if ("int" in x) {
      const n = x.int;
      const limit = 1n << 64n;
      if (n >= 0n && n < limit) return head(0, n);
      if (n < 0n && -1n - n < limit) return head(1, -1n - n);
      const mag = n >= 0n ? n : -1n - n;
      head(6, n >= 0n ? 2n : 3n);
      let hex = mag.toString(16);
      if (hex.length % 2) hex = "0" + hex;
      return rawBytes(hexToBytes(hex));
    }
    if ("bytes" in x) return rawBytes(hexToBytes(x.bytes));
    if ("list" in x) return list(x.list);
    head(5, BigInt(x.map.length));
    for (const { k, v } of x.map) {
      go(k);
      go(v);
    }
  };
  go(d);
  return Uint8Array.from(out);
}

export function hexToBytes(hex: string): Uint8Array {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return b;
}

export const bytesToHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export const toCborHex = (d: PlutusData) => bytesToHex(encodePlutusData(d));

// ------------------------------------------------------------- names

export const POOL_NFT = utf8Hex("pool");
/** LP share prefix. Tranche `i` mints `lpTokenName(i)` = "lp" ‖ one byte i (Aiken `names.lp_name`). */
export const LP_PREFIX = utf8Hex("lp");
export function lpTokenName(tranche: number): string {
  if (!Number.isInteger(tranche) || tranche < 0 || tranche > 255) throw new Error(`tranche out of range: ${tranche}`);
  return LP_PREFIX + tranche.toString(16).padStart(2, "0");
}

/** Tranche index of `asset` in the deployment, as the validator resolves `PolicyDatum.asset`. */
export function trancheOf(assets: AssetTerms[], asset: AssetClass): number {
  const i = assets.findIndex((a) => sameAsset(a.asset, asset));
  if (i < 0) throw new Error(`asset ${asset.policyId}.${asset.assetName} is not accepted by this pool`);
  return i;
}

/** The all-zero pool datum `InitPool` requires: one empty tranche per accepted asset. */
export const initialPoolDatum = (assets: AssetTerms[]): PoolDatum => ({
  tranches: assets.map(() => ({ totalShares: 0n, activeCover: 0n })),
});
/** CIP-67 (100) reference token label. */
export const REF_LABEL = "000643b0";
/** CIP-67 (222) user token label. */
export const USER_LABEL = "000de140";

/** Policy id = blake2b_256(cbor(pool output reference spent by the purchase)). */
export const policyIdFrom = (poolRef: OutputReference) =>
  bytesToHex(blake2b256(encodePlutusData(outputReferenceData(poolRef))));

export const refTokenName = (policyId: string) => REF_LABEL + policyId.slice(0, 56);
export const userTokenName = (policyId: string) => USER_LABEL + policyId.slice(0, 56);

// ------------------------------------------------------------- pricing mirror

const KINK_BPS = BigInt(Math.round(UTILIZATION_KINK * 10_000));

/** Integer mirror of `utilizationMultiplier`, in bps (10_000 = 1.0x). */
export function utilizationMultiplierBps(uBps: bigint): bigint {
  const u = uBps < 0n ? 0n : uBps > BPS ? BPS : uBps;
  if (u <= KINK_BPS) return BPS + (2_500n * u) / KINK_BPS;
  return 12_500n + (15_000n * (u - KINK_BPS)) / (BPS - KINK_BPS);
}

/** Product rates + the tranche asset's premium floor: everything the premium formula needs. */
export type PremiumTerms = Pick<ProductTerms, "baseRateBps" | "riskMultBps"> & { minPremium: bigint };

/** Combine product terms with the policy's tranche asset (its `minPremium`). */
export const premiumTerms = (product: ProductTerms, asset: AssetTerms): PremiumTerms => ({
  baseRateBps: product.baseRateBps,
  riskMultBps: product.riskMultBps,
  minPremium: asset.minPremium,
});

/**
 * Exactly the validator's minimum premium. `capital` / `activeCover` are the
 * policy's own tranche before the purchase, in that asset's base units.
 */
export function requiredPremium(
  terms: PremiumTerms,
  coverage: bigint,
  days: bigint,
  capital: bigint,
  activeCover: bigint,
): bigint {
  const uBefore = (activeCover * BPS) / capital;
  const uAfter = ((activeCover + coverage) * BPS) / capital;
  const mSum = utilizationMultiplierBps(uBefore) + utilizationMultiplierBps(uAfter);
  const priced = (coverage * terms.baseRateBps * terms.riskMultBps * mSum * days) / (BPS * BPS * 2n * BPS * 365n);
  return priced > terms.minPremium ? priced : terms.minPremium;
}

export function withinCapacity(
  terms: Pick<ProductTerms, "maxSinglePolicyBps" | "maxUtilizationBps">,
  coverage: bigint,
  capital: bigint,
  activeCover: bigint,
): boolean {
  return (
    capital > 0n &&
    coverage * BPS <= capital * terms.maxSinglePolicyBps &&
    (activeCover + coverage) * BPS <= capital * terms.maxUtilizationBps
  );
}

/**
 * Premium to actually pay on-chain for a quote. The quote engine rounds to
 * cents, which can land a fraction of a cent under the validator's integer
 * floor; this never pays less than the floor and never less than the quote.
 */
export function chainPremium(
  quotedPremium: number,
  terms: PremiumTerms,
  coverage: bigint,
  days: bigint,
  capital: bigint,
  activeCover: bigint,
  unit = 1_000_000n,
): bigint {
  const quoted = BigInt(Math.ceil(quotedPremium * Number(unit)));
  const floor = requiredPremium(terms, coverage, days, capital, activeCover);
  return quoted > floor ? quoted : floor;
}

/**
 * Default sale guard: cover starts at least 24h after the purchase lands, and
 * the healthy-peg readings a Buy references are at most 2h old. A deployment
 * can pick shorter values (Preview uses a 1h wait so drills stay quick).
 */
export const DEFAULT_SALE_GUARD: SaleGuard = { waitingPeriodMs: DAY_MS, maxPriceAgeMs: 2n * 3_600_000n };

export const saleGuard = (waitingPeriodMs: bigint = DEFAULT_SALE_GUARD.waitingPeriodMs, maxPriceAgeMs: bigint = DEFAULT_SALE_GUARD.maxPriceAgeMs): SaleGuard => {
  if (waitingPeriodMs < 0n) throw new Error("waiting period cannot be negative");
  if (maxPriceAgeMs <= 0n) throw new Error("max price age must be positive: the healthy-peg check is mandatory");
  return { waitingPeriodMs, maxPriceAgeMs };
};

/** Off-chain mirror of `oracle.attests_peg`: would this reading let a Buy landing by `saleBy` through? */
export const isHealthyReading = (d: OracleDatum, trigger: Trigger, guard: SaleGuard, saleBy: bigint) =>
  d.coveredAsset.toLowerCase() === trigger.coveredAsset.toLowerCase() &&
  d.priceBps >= trigger.thresholdBps &&
  d.windowEnd >= saleBy - guard.maxPriceAgeMs;

/** Earliest policy start for a Buy whose validity upper bound is `saleBy`. */
export const earliestStart = (guard: SaleGuard, saleBy: bigint) => saleBy + guard.waitingPeriodMs;

/** Default depeg trigger, matching PRODUCTS.depeg ("TWAP below 0.95 for 24h"). */
export const depegTrigger = (coveredAssetHex: string): Trigger => ({
  coveredAsset: coveredAssetHex,
  thresholdBps: 9_500n,
  windowMs: DAY_MS,
});

/**
 * On-chain ProductTerms for one product line, derived from the same model
 * parameters the quote engine uses. Asset-specific settings (the premium
 * floor) live in `AssetTerms`, one per tranche; see `assetTerms`.
 */
export function productTerms(id: ProductId, tier: RiskTier, trigger: Trigger): ProductTerms {
  const p = PRODUCTS[id];
  return {
    productId: utf8Hex(id),
    trigger,
    baseRateBps: BigInt(Math.round(p.baseAnnualRate * 10_000)),
    riskMultBps: BigInt(Math.round(RISK_MULTIPLIER[tier] * 10_000)),
    minDays: BigInt(p.minDays),
    maxDays: BigInt(p.maxDays),
    maxSinglePolicyBps: BigInt(Math.round(MAX_SINGLE_POLICY_SHARE * 10_000)),
    maxUtilizationBps: BigInt(Math.round(MAX_UTILIZATION * 10_000)),
  };
}

/**
 * On-chain `AssetTerms` for one accepted currency. `unit` = base units per
 * quote unit (1_000_000 for ada and for 6-decimal USDC / USDCx), so the
 * premium floor is `minPremium` whole units of that asset (default 5).
 */
export function assetTerms(asset: AssetClass, unit = 1_000_000n, minPremium = MIN_PREMIUM): AssetTerms {
  return { asset, minPremium: BigInt(minPremium) * unit };
}

/** Build the PolicyDatum a Buy transaction must lock with the reference token. */
export function buildPolicyDatum(args: {
  poolRef: OutputReference;
  terms: ProductTerms;
  /** Premium/coverage/payout currency; must be one of the pool's assets. */
  asset: AssetClass;
  coverage: bigint;
  premium: bigint;
  start: bigint;
  days: bigint;
  midnightCommitment: string;
  /** Where Expire returns the reference UTxO's min-ada (normally the buyer's own address). */
  refundTo: Address;
}): PolicyDatum {
  if (!/^[0-9a-f]{64}$/i.test(args.midnightCommitment)) throw new Error("midnightCommitment must be 32 bytes hex");
  return {
    policyId: policyIdFrom(args.poolRef),
    productId: args.terms.productId,
    asset: { policyId: args.asset.policyId.toLowerCase(), assetName: args.asset.assetName.toLowerCase() },
    coverage: args.coverage,
    premium: args.premium,
    start: args.start,
    expiry: args.start + args.days * DAY_MS,
    trigger: args.terms.trigger,
    midnightCommitment: args.midnightCommitment.toLowerCase(),
    refundTo: args.refundTo,
  };
}
