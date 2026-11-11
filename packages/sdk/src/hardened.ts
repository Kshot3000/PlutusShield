/**
 * Encoders and on-chain mirrors for the hardened PlutusShield validators
 * (contracts/cardano/plutus.json after the fix/hardening branch).
 *
 * The Preview deployments and the web app run the pre-hardening ("v1")
 * build, frozen at contracts/cardano/deploy/deployments/plutus.v1.json and
 * encoded by `cardano.ts` / `oracle.ts`. Nothing here changes those. What the
 * hardened build changes:
 *
 *  - Oracle: each allowlisted feed has its own token policy and its own
 *    operator key, and a reading only counts when it sits at that operator's
 *    key address. Feeds are counted by operator, so one key can never stand
 *    in for two feeds. The config needs >= 3 feeds with distinct operators
 *    and policies and a strict-majority quorum (2-of-3, 3-of-5, ...).
 *  - Readings dated in the future are rejected: `windowEnd` must be at or
 *    before the tx validity lower bound (`now`).
 *  - Exploit cover: the assessor committee lives in an NFT-threaded registry
 *    UTxO (validators/committee.ak) read as a reference input. Changes go
 *    propose (current committee signs) -> wait `delay_ms` -> apply, in the
 *    ContractsLibrary Settings style; the current committee can cancel.
 *  - `AssetTerms.minDeposit`: LP deposits below it are rejected (no dust
 *    deposits jamming the single pool UTxO).
 *  - Expire can retire several policies in one tx; each refund output is
 *    tagged with its policy id (inline datum) so one output can't pay two.
 *  - `CoverParams.poolMinLovelace` stays in the pool UTxO and is never ada
 *    capital, so the last LP can withdraw 100% of the tranche.
 *
 * Golden vectors: cover.ak `sdk_golden_vectors` (params) and committee.ak
 * `sdk_committee_golden_vectors`, pinned in test/hardened.test.ts.
 */
import {
  assetClassData,
  outputReferenceData,
  productTermsData,
  saleGuardData,
  committeeData,
  committeeProblem,
  type AssetClass,
  type Committee,
  type OracleDatum,
  type OutputReference,
  type PlutusData,
  type PolicyDatum,
  type ProductTerms,
  type SaleGuard,
  type Trigger,
} from "./cardano.ts";

const constr = (index: number, fields: PlutusData[] = []): PlutusData => ({ constructor: index, fields });
const int = (n: bigint | number): PlutusData => ({ int: BigInt(n) });
const bytes = (hex: string): PlutusData => {
  if (!/^([0-9a-f]{2})*$/i.test(hex)) throw new Error(`not hex: ${hex}`);
  return { bytes: hex.toLowerCase() };
};
const isHex = (x: string, len: number) => new RegExp(`^[0-9a-fA-F]{${len}}$`).test(x);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// ------------------------------------------------------------- types

/** Aiken `Feed`: token `policyId.name`, published from the `operator` key address. */
export interface Feed { name: string; policyId: string; operator: string }
/** Aiken `OracleConfig` (hardened). */
export interface OracleConfig { feeds: Feed[]; quorum: bigint }
/** Aiken `AssetTerms` (hardened): adds the LP deposit floor. */
export interface AssetTerms { asset: AssetClass; minPremium: bigint; minDeposit: bigint }
/** Aiken `CoverParams` (hardened). */
export interface CoverParams {
  seed: OutputReference;
  assets: AssetTerms[];
  product: ProductTerms;
  oracle: OracleConfig;
  claimGraceMs: bigint;
  saleGuard: SaleGuard;
  /** Lovelace kept in the pool UTxO as min-UTxO; never ada-tranche capital. */
  poolMinLovelace: bigint;
}

/** A queued committee change (Aiken `PendingChange`). */
export interface PendingChange { next: Committee; effectiveAt: bigint }
/** Datum of the committee registry UTxO (Aiken `CommitteeState`). */
export interface CommitteeState { current: Committee; pending?: PendingChange }
export type CommitteeAction = { kind: "Propose"; next: Committee } | { kind: "Apply" } | { kind: "Cancel" };

/** Hex of "committee": the registry NFT's token name. */
export const COMMITTEE_NFT = "636f6d6d6974746565";

/** Default LP deposit floor in whole units of the tranche asset. */
export const MIN_DEPOSIT = 10n;

// ------------------------------------------------------------- validation

/** The rules `oracle.config_ok` enforces. Returns the first problem, or null. */
export function oracleConfigProblem(o: OracleConfig): string | null {
  const n = o.feeds.length;
  if (n < 3) return "the oracle needs at least 3 feeds";
  if (n > 32) return "the oracle can list at most 32 feeds";
  for (const f of o.feeds) {
    if (!isHex(f.operator, 56)) return `feed ${f.name}: operator is not a 28-byte key hash`;
    if (!isHex(f.policyId, 56)) return `feed ${f.name}: policy id is not 28 bytes`;
  }
  if (new Set(o.feeds.map((f) => f.operator.toLowerCase())).size !== n) return "two feeds share an operator key";
  if (new Set(o.feeds.map((f) => f.policyId.toLowerCase())).size !== n) return "two feeds share a token policy";
  if (o.quorum > BigInt(n)) return `quorum ${o.quorum} is above the feed count ${n}`;
  if (o.quorum * 2n <= BigInt(n)) return `quorum ${o.quorum} is not a strict majority of ${n} feeds`;
  return null;
}

// ------------------------------------------------------------- to data

export const feedData = (f: Feed) => constr(0, [bytes(f.name), bytes(f.policyId), bytes(f.operator)]);
export const oracleConfigData = (o: OracleConfig) => constr(0, [{ list: o.feeds.map(feedData) }, int(o.quorum)]);
export const assetTermsData = (a: AssetTerms) =>
  constr(0, [assetClassData(a.asset), int(a.minPremium), int(a.minDeposit)]);

export const coverParamsData = (c: CoverParams) =>
  constr(0, [
    outputReferenceData(c.seed),
    { list: c.assets.map(assetTermsData) },
    productTermsData(c.product),
    oracleConfigData(c.oracle),
    int(c.claimGraceMs),
    saleGuardData(c.saleGuard),
    int(c.poolMinLovelace),
  ]);

export const committeeStateData = (s: CommitteeState) =>
  constr(0, [
    committeeData(s.current),
    s.pending ? constr(0, [constr(0, [committeeData(s.pending.next), int(s.pending.effectiveAt)])]) : constr(1),
  ]);

export const committeeActionData = (a: CommitteeAction) =>
  a.kind === "Propose" ? constr(0, [committeeData(a.next)]) : constr(a.kind === "Apply" ? 1 : 2);

/** Mint redeemer `InitCommittee`. */
export const initCommitteeData = () => constr(0);

/** Inline datum an Expire refund output must carry: the policy id it refunds. */
export const refundTagData = (policyId: string) => bytes(policyId);

/** Hardened `AssetTerms` from whole-unit floors (`unit` = base units per whole unit). */
export function assetTerms(asset: AssetClass, unit = 1_000_000n, minPremium = 5n, minDeposit = MIN_DEPOSIT): AssetTerms {
  if (minDeposit < 1n) throw new Error("minDeposit must be >= 1 whole unit");
  return { asset, minPremium: minPremium * unit, minDeposit: minDeposit * unit };
}

// ------------------------------------------------------------- pool accounting

/** Ada-tranche capital as the validator counts it: pool lovelace minus `poolMinLovelace` (never negative). */
export const adaCapital = (lovelace: bigint, poolMinLovelace: bigint) =>
  lovelace > poolMinLovelace ? lovelace - poolMinLovelace : 0n;

/** Would a Deposit of `amount` pass the floor? */
export const depositAllowed = (terms: AssetTerms, amount: bigint) => amount >= terms.minDeposit;

// ------------------------------------------------------------- committee

/**
 * Mirror of committee.ak `Propose`: the change is signed by the current
 * committee's quorum, the proposed committee is well formed, and it takes
 * effect no earlier than `txUpperBound + delayMs`.
 */
export function proposeProblem(
  state: CommitteeState,
  next: Committee,
  effectiveAt: bigint,
  signers: string[],
  txUpperBound: bigint,
  delayMs: bigint,
): string | null {
  const p = committeeProblem(next);
  if (p) return `proposed committee: ${p}`;
  const s = new Set(signers.map((k) => k.toLowerCase()));
  const have = state.current.assessors.filter((k) => s.has(k.toLowerCase())).length;
  if (BigInt(have) < state.current.threshold) return `${have} of ${state.current.threshold} current assessors signed`;
  if (effectiveAt < txUpperBound + delayMs) return "effectiveAt is earlier than the tx upper bound + delay";
  return null;
}

/** Mirror of committee.ak `Apply`: allowed once the tx lower bound reaches `effectiveAt`. */
export const canApply = (state: CommitteeState, txLowerBound: bigint) =>
  state.pending !== undefined && txLowerBound >= state.pending.effectiveAt;

/** The committee `exploit_cover` uses at Settle: always `current`, never `pending`. */
export const activeCommittee = (state: CommitteeState) => state.current;

// ------------------------------------------------------------- oracle mirrors

/** A candidate oracle UTxO, as it would appear as a reference input. */
export interface FeedUtxo {
  /** Token names (hex) and quantities held under `policyId`. */
  tokens: { name: string; quantity: bigint }[];
  policyId: string;
  /** Payment key hash of the UTxO address; undefined for a script address. */
  paymentKeyHash?: string;
  datum?: OracleDatum;
}

/** Mirror of `oracle.feed_of`: returns the feed's operator when the UTxO is a valid reading of an allowlisted feed. */
export function feedOf(u: FeedUtxo, config: OracleConfig): string | undefined {
  if (u.tokens.length !== 1 || u.tokens[0].quantity !== 1n) return undefined;
  const f = config.feeds.find((x) => same(x.policyId, u.policyId) && same(x.name, u.tokens[0].name));
  if (!f || !u.paymentKeyHash || !same(u.paymentKeyHash, f.operator)) return undefined;
  return f.operator.toLowerCase();
}

/** Mirror of `oracle.attests`: trigger proven inside [start, expiry], window closed by `now`. */
export const attests = (d: OracleDatum, trigger: Trigger, start: bigint, expiry: bigint, now: bigint) =>
  same(d.coveredAsset, trigger.coveredAsset) &&
  d.priceBps < trigger.thresholdBps &&
  d.windowStart < d.windowEnd &&
  d.windowEnd - d.windowStart >= trigger.windowMs &&
  d.windowStart >= start &&
  d.windowEnd <= expiry &&
  d.windowEnd <= now;

/** Mirror of `oracle.attests_peg`: healthy, fresh (>= freshAfter) and not dated after `now`. */
export const attestsPeg = (d: OracleDatum, trigger: Trigger, freshAfter: bigint, now: bigint) =>
  same(d.coveredAsset, trigger.coveredAsset) &&
  d.priceBps >= trigger.thresholdBps &&
  d.windowStart <= d.windowEnd &&
  d.windowEnd >= freshAfter &&
  d.windowEnd <= now;

/** Distinct operators whose readings pass `pred`, plus one UTxO per operator to attach. */
export function agreeing<T extends FeedUtxo>(utxos: T[], config: OracleConfig, pred: (d: OracleDatum) => boolean) {
  const operators: string[] = [];
  const use: T[] = [];
  for (const u of utxos) {
    const op = feedOf(u, config);
    if (op === undefined || operators.includes(op) || !u.datum || !pred(u.datum)) continue;
    operators.push(op);
    use.push(u);
  }
  return { operators, use };
}

/** Mirror of `oracle.triggered` (now = tx validity lower bound). */
export function triggered<T extends FeedUtxo>(
  utxos: T[],
  config: OracleConfig,
  policy: Pick<PolicyDatum, "trigger" | "start" | "expiry">,
  now: bigint,
) {
  const a = agreeing(utxos, config, (d) => attests(d, policy.trigger, policy.start, policy.expiry, now));
  return { ok: oracleConfigProblem(config) === null && BigInt(a.operators.length) >= config.quorum, ...a };
}

/** Mirror of `oracle.healthy`: every allowlisted operator has a fresh healthy reading. */
export function healthy<T extends FeedUtxo>(
  utxos: T[],
  config: OracleConfig,
  trigger: Trigger,
  freshAfter: bigint,
  now: bigint,
) {
  const a = agreeing(utxos, config, (d) => attestsPeg(d, trigger, freshAfter, now));
  const missing = config.feeds.filter((f) => !a.operators.includes(f.operator.toLowerCase())).map((f) => f.name);
  return { ok: oracleConfigProblem(config) === null && missing.length === 0, missing, ...a };
}
