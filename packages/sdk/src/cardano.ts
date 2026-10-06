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

export interface OutputReference { txHash: string; outputIndex: number }

export interface Trigger { coveredAsset: string; thresholdBps: bigint; windowMs: bigint }

export interface ProductTerms {
  productId: string;
  trigger: Trigger;
  baseRateBps: bigint;
  riskMultBps: bigint;
  minDays: bigint;
  maxDays: bigint;
  minPremium: bigint;
  maxSinglePolicyBps: bigint;
  maxUtilizationBps: bigint;
}

export interface OracleConfig { policyId: string; feeds: string[]; quorum: bigint }

export interface CoverParams {
  seed: OutputReference;
  poolAsset: AssetClass;
  product: ProductTerms;
  oracle: OracleConfig;
  claimGraceMs: bigint;
}

export interface PoolDatum { totalShares: bigint; activeCover: bigint }

export interface PolicyDatum {
  policyId: string;
  productId: string;
  coverage: bigint;
  premium: bigint;
  start: bigint;
  expiry: bigint;
  trigger: Trigger;
  midnightCommitment: string;
}

export interface OracleDatum { coveredAsset: string; priceBps: bigint; windowStart: bigint; windowEnd: bigint }

export type CoverDatum = { kind: "Pool"; pool: PoolDatum } | { kind: "Policy"; policy: PolicyDatum };
export type MintAction = "InitPool" | "ViaPool" | "BurnUserTokens";
export type PoolAction =
  | { kind: "Deposit" }
  | { kind: "Withdraw"; shares: bigint }
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
    int(p.minPremium),
    int(p.maxSinglePolicyBps),
    int(p.maxUtilizationBps),
  ]);

export const oracleConfigData = (o: OracleConfig) =>
  constr(0, [bytes(o.policyId), { list: o.feeds.map(bytes) }, int(o.quorum)]);

export const coverParamsData = (c: CoverParams) =>
  constr(0, [
    outputReferenceData(c.seed),
    assetClassData(c.poolAsset),
    productTermsData(c.product),
    oracleConfigData(c.oracle),
    int(c.claimGraceMs),
  ]);

export const poolDatumData = (d: PoolDatum) => constr(0, [int(d.totalShares), int(d.activeCover)]);

export const policyDatumData = (d: PolicyDatum) =>
  constr(0, [
    bytes(d.policyId),
    bytes(d.productId),
    int(d.coverage),
    int(d.premium),
    int(d.start),
    int(d.expiry),
    triggerData(d.trigger),
    bytes(d.midnightCommitment),
  ]);

export const coverDatumData = (d: CoverDatum) =>
  d.kind === "Pool" ? constr(0, [poolDatumData(d.pool)]) : constr(1, [policyDatumData(d.policy)]);

export const oracleDatumData = (d: OracleDatum) =>
  constr(0, [bytes(d.coveredAsset), int(d.priceBps), int(d.windowStart), int(d.windowEnd)]);

export const mintActionData = (a: MintAction) => constr(["InitPool", "ViaPool", "BurnUserTokens"].indexOf(a));

export const poolActionData = (a: PoolAction): PlutusData => {
  switch (a.kind) {
    case "Deposit": return constr(0);
    case "Withdraw": return constr(1, [int(a.shares)]);
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
export const LP_TOKEN = utf8Hex("lp");
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

/** Exactly the validator's minimum premium (pool capital/active cover before the purchase). */
export function requiredPremium(
  terms: Pick<ProductTerms, "baseRateBps" | "riskMultBps" | "minPremium">,
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
  terms: Pick<ProductTerms, "baseRateBps" | "riskMultBps" | "minPremium">,
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

/** Default depeg trigger, matching PRODUCTS.depeg ("TWAP below 0.95 for 24h"). */
export const depegTrigger = (coveredAssetHex: string): Trigger => ({
  coveredAsset: coveredAssetHex,
  thresholdBps: 9_500n,
  windowMs: DAY_MS,
});

/**
 * On-chain ProductTerms for one product line, derived from the same model
 * parameters the quote engine uses. `unit` = base units per quote unit
 * (1_000_000 for ada or a 6-decimal stablecoin).
 */
export function productTerms(id: ProductId, tier: RiskTier, trigger: Trigger, unit = 1_000_000n): ProductTerms {
  const p = PRODUCTS[id];
  return {
    productId: utf8Hex(id),
    trigger,
    baseRateBps: BigInt(Math.round(p.baseAnnualRate * 10_000)),
    riskMultBps: BigInt(Math.round(RISK_MULTIPLIER[tier] * 10_000)),
    minDays: BigInt(p.minDays),
    maxDays: BigInt(p.maxDays),
    minPremium: BigInt(MIN_PREMIUM) * unit,
    maxSinglePolicyBps: BigInt(Math.round(MAX_SINGLE_POLICY_SHARE * 10_000)),
    maxUtilizationBps: BigInt(Math.round(MAX_UTILIZATION * 10_000)),
  };
}

/** Build the PolicyDatum a Buy transaction must lock with the reference token. */
export function buildPolicyDatum(args: {
  poolRef: OutputReference;
  terms: ProductTerms;
  coverage: bigint;
  premium: bigint;
  start: bigint;
  days: bigint;
  midnightCommitment: string;
}): PolicyDatum {
  if (!/^[0-9a-f]{64}$/i.test(args.midnightCommitment)) throw new Error("midnightCommitment must be 32 bytes hex");
  return {
    policyId: policyIdFrom(args.poolRef),
    productId: args.terms.productId,
    coverage: args.coverage,
    premium: args.premium,
    start: args.start,
    expiry: args.start + args.days * DAY_MS,
    trigger: args.terms.trigger,
    midnightCommitment: args.midnightCommitment.toLowerCase(),
  };
}
