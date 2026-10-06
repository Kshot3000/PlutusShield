/**
 * Cover purchases on the live Preview pool: Buy, the oracle sale check it
 * depends on, and reading back a wallet's policies.
 *
 * Environment-neutral, like lp.ts: the /cover page runs it with a CIP-30
 * wallet, contracts/cardano/deploy/scripts/web-buy.ts runs the exact same code
 * with a local key against Preview, and deploy/lib/actions.ts `buy` (used by
 * the emulator run and `pnpm preview buy`) delegates here too, so there is one
 * Buy builder. Only *types* come from Lucid; callers pass a LucidEvolution.
 *
 * Every rule comes from @plutusshield/sdk, the integer mirror of the Aiken
 * validator: premium floor + capacity caps (pool.buy), the policy datum and
 * token names (cardano.ts), and the sale circuit-breaker (oracle.healthy over
 * each feed's newest reading).
 */
import type { LucidEvolution, UTxO } from "@lucid-evolution/lucid";
import {
  BPS,
  buildPolicyDatum,
  coverDatumData,
  coverParamsFromJson,
  earliestStart,
  mintActionData,
  poolActionData,
  refTokenName,
  toCborHex,
  userTokenName,
  type Address,
  type CoverParams,
  type CoverParamsJson,
  type OracleDatum,
  type PolicyDatum,
  type PoolDatum,
} from "@plutusshield/sdk/cardano";
import { decodeOracleDatum, readPoolState, type ChainUtxo, type LivePolicy } from "@plutusshield/sdk/chain";
import { healthy, latestPerFeed, type FeedUtxo } from "@plutusshield/sdk/oracle";
import { buy as buyStep, type PoolLedger } from "@plutusshield/sdk/pool";
import { plutusAddressOf } from "@plutusshield/sdk/cip30";
import { poolScriptFrom, readLivePool, unitOf, type PoolScript } from "./lp.ts";

/** The pool script plus everything a Buy needs to know about the deployment. */
export interface CoverScript extends PoolScript {
  params: CoverParams;
  /** Where the oracle publishes feed UTxOs (Preview: the test oracle key's address). */
  oracleAddress?: string;
}

/** Revive the JSON artifact written by `pnpm web-artifacts`. */
export function coverScriptFrom(j: Parameters<typeof poolScriptFrom>[0] & { params: CoverParamsJson; oracle?: { address: string } }): CoverScript {
  return { ...poolScriptFrom(j), params: coverParamsFromJson(j.params), oracleAddress: j.oracle?.address };
}

/** A Buy must land within this long of being built (its validity upper bound). */
export const BUY_WINDOW_MS = 10 * 60_000;
/**
 * How far before `now` the validity interval opens. The validator ignores a
 * Buy's lower bound, so this is pure slack for a skewed client clock or a
 * submit node a little behind the tip (either rejects with
 * OutsideValidityIntervalUTxO when the interval opens "in the future").
 */
export const BUY_LOWER_SLACK_MS = 5 * 60_000;
/** Min-ada locked with the policy reference token; returned to `refundTo` at expiry. */
export const POLICY_REF_LOVELACE = 2_500_000n;

const inline = (cbor: string) => ({ kind: "inline" as const, value: cbor });
const VIA_POOL = toCborHex(mintActionData("ViaPool"));
const hexText = (h: string) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16)));
  } catch {
    return h;
  }
};

/** A time the ledger can represent exactly as a slot boundary. */
export const slotAligned = (lucid: LucidEvolution, t: number) => lucid.slotToUnixTime(lucid.unixTimeToSlot(t));

// ---------------------------------------------------------------- oracle sale check

export type FeedState =
  | { feed: string; state: "ok"; reading: OracleDatum }
  | { feed: string; state: "missing" }
  | { feed: string; state: "stale"; reading: OracleDatum }
  | { feed: string; state: "depeg"; reading: OracleDatum };

export interface SaleCheck<T> {
  /** Every allowlisted feed has a fresh healthy-peg reading for a tx landing by `saleBy`. */
  ok: boolean;
  /** One reference input per feed (its newest reading), when `ok`. */
  use: T[];
  /** UTF-8 names of the feeds that block the sale. */
  blocked: string[];
  feeds: FeedState[];
  /** Latest validity upper bound the current readings still allow (ms), when every feed is healthy. */
  freshUntil: number | null;
}

/**
 * The validator's sale circuit-breaker, off-chain: EVERY allowlisted feed
 * needs a healthy-peg reading (price >= trigger threshold) whose window ended
 * no more than `maxPriceAgeMs` before the Buy's upper bound. Like an honest
 * client must, it only ever uses each feed's newest reading, so an older
 * healthy one can't hide a newer depeg.
 */
export function saleCheck<T extends FeedUtxo>(params: CoverParams, candidates: T[], saleBy: number): SaleCheck<T> {
  const latest = latestPerFeed(candidates, params.oracle);
  const freshAfter = BigInt(saleBy) - params.saleGuard.maxPriceAgeMs;
  const h = healthy(latest, params.oracle, params.product.trigger, freshAfter);
  const byName = new Map(latest.map((u) => [u.tokens[0].name.toLowerCase(), u.datum!]));
  const feeds: FeedState[] = params.oracle.feeds.map((hex) => {
    const feed = hexText(hex);
    const reading = byName.get(hex.toLowerCase());
    if (!reading) return { feed, state: "missing" };
    if (reading.priceBps < params.product.trigger.thresholdBps || reading.coveredAsset.toLowerCase() !== params.product.trigger.coveredAsset.toLowerCase())
      return { feed, state: "depeg", reading };
    if (reading.windowEnd < freshAfter) return { feed, state: "stale", reading };
    return { feed, state: "ok", reading };
  });
  const freshUntil = h.ok
    ? Math.min(...feeds.map((f) => ("reading" in f ? Number(f.reading.windowEnd + params.saleGuard.maxPriceAgeMs) : 0)))
    : null;
  return { ok: h.ok, use: h.ok ? h.use : [], blocked: h.missing.map(hexText), feeds, freshUntil };
}

/** A Lucid UTxO as the SDK's oracle mirror sees it. */
export const feedOfUtxo = (u: UTxO, oraclePolicyId: string): FeedUtxo & { utxo: UTxO } => ({
  utxo: u,
  policyId: oraclePolicyId,
  tokens: Object.entries(u.assets)
    .filter(([k]) => k !== "lovelace" && k.startsWith(oraclePolicyId))
    .map(([k, quantity]) => ({ name: k.slice(oraclePolicyId.length), quantity })),
  datum: decodeOracleDatum(u.datum),
});

/** A Koios/Blockfrost `ChainUtxo` as the SDK's oracle mirror sees it (browser reads, no Lucid). */
export const feedOfChainUtxo = (u: ChainUtxo, oraclePolicyId: string): FeedUtxo & { ref: string } => ({
  ref: `${u.tx_hash}#${u.tx_index}`,
  policyId: oraclePolicyId,
  tokens: (u.asset_list ?? [])
    .filter((a) => a.policy_id === oraclePolicyId)
    .map((a) => ({ name: a.asset_name ?? "", quantity: BigInt(a.quantity) })),
  datum: decodeOracleDatum(u.inline_datum?.bytes),
});

/** Reference inputs for a Buy landing by `saleBy`: the Lucid flavour of `saleCheck`. */
export function saleFeeds(params: CoverParams, candidates: UTxO[], saleBy: number): { ok: UTxO[]; blocked: string[] } {
  const s = saleCheck(params, candidates.map((u) => feedOfUtxo(u, params.oracle.policyId)), saleBy);
  return { ok: s.use.map((f) => f.utxo), blocked: s.blocked };
}

export function circuitBreakerMessage(params: CoverParams, blocked: string[]) {
  return (
    `sale circuit-breaker: every allowlisted feed needs a fresh healthy-peg reading (price >= ${params.product.trigger.thresholdBps} bps, ` +
    `window_end within ${Number(params.saleGuard.maxPriceAgeMs) / 60_000} min). Blocked: ${blocked.join(", ")}. ` +
    "Publish fresh readings (Preview: `pnpm preview peg`) or wait for the depeg to clear."
  );
}

// ---------------------------------------------------------------- quotes

/** Largest coverage one new policy can take from this tranche (single-policy cap and utilization cap). */
export function maxCoverage(params: CoverParams, ledger: PoolLedger): bigint {
  const single = (ledger.capital * params.product.maxSinglePolicyBps) / BPS;
  const util = (ledger.capital * params.product.maxUtilizationBps) / BPS - ledger.activeCover;
  const m = single < util ? single : util;
  return m > 0n ? m : 0n;
}

/** Exactly what the validator will accept for this purchase right now: the premium floor and next tranche state. */
export function quoteBuy(params: CoverParams, ledger: PoolLedger, tranche: number, coverage: bigint, days: bigint) {
  return buyStep(ledger, params.product, params.assets[tranche], coverage, days);
}

// ---------------------------------------------------------------- Buy

export interface BuyArgs {
  /** Tranche index (= premium, coverage and payout currency). */
  tranche: number;
  coverage: bigint;
  days: bigint;
  /** 32-byte hex commitment to the Midnight policy registration. */
  midnightCommitment: string;
  /** Wall-clock ms the tx is built at. */
  now: number;
  /** Candidate oracle feed UTxOs; each feed's newest, healthy, fresh reading becomes a reference input. */
  feeds: UTxO[];
  /** Expire refund address (bech32 or hex); defaults to the buying wallet. */
  refundTo?: string;
  /** Refuse to build if the live premium moved above this (base units), e.g. the price the user reviewed. */
  maxPremium?: bigint;
}

const setCover = (pool: PoolDatum, t: number, activeCover: bigint): PoolDatum => ({
  tranches: pool.tranches.map((x, i) => (i === t ? { totalShares: x.totalShares, activeCover } : x)),
});

/**
 * Unsigned Buy: spends the pool UTxO (redeemer Buy), returns it with
 * capital += premium and activeCover += coverage, mints the CIP-67 (100)
 * reference token onto a policy-datum UTxO at the script and the (222) user
 * token to the buyer, and references one fresh healthy-peg reading per feed.
 */
export async function buildBuy(lucid: LucidEvolution, c: CoverScript, a: BuyArgs) {
  const pool = await readLivePool(lucid, c);
  const t = a.tranche;
  if (!c.params.assets[t]) throw new Error(`tranche ${t} is not part of this pool`);
  const step = quoteBuy(c.params, pool.ledgers[t], t, a.coverage, a.days);
  if (!step.ok) throw new Error(step.reason);
  if (a.maxPremium !== undefined && step.premium > a.maxPremium)
    throw new Error(`The pool moved since your quote: the premium is now ${step.premium} base units. Review it and try again.`);

  // The tx must land by `upper`; cover starts after the waiting period.
  const upper = slotAligned(lucid, a.now + BUY_WINDOW_MS);
  const { ok: peg, blocked } = saleFeeds(c.params, a.feeds, upper);
  if (blocked.length) throw new Error(circuitBreakerMessage(c.params, blocked));

  const start = slotAligned(lucid, Number(earliestStart(c.params.saleGuard, BigInt(upper))));
  const refundTo: Address = plutusAddressOf(a.refundTo ?? (await lucid.wallet().address()));
  const policy = buildPolicyDatum({
    poolRef: { txHash: pool.utxo.txHash, outputIndex: pool.utxo.outputIndex },
    terms: c.params.product,
    asset: c.params.assets[t].asset,
    coverage: a.coverage,
    premium: step.premium,
    start: BigInt(start),
    days: a.days,
    midnightCommitment: a.midnightCommitment,
    refundTo,
  });
  const ref = c.scriptHash + refTokenName(policy.policyId);
  const user = c.scriptHash + userTokenName(policy.policyId);
  const value = { ...pool.utxo.assets, [unitOf(c.params.assets[t].asset)]: step.pool.capital };
  const tx = await lucid
    .newTx()
    .collectFrom([pool.utxo], toCborHex(poolActionData({ kind: "Buy" })))
    .mintAssets({ [ref]: 1n, [user]: 1n }, VIA_POOL)
    .attach.SpendingValidator(c.script)
    .pay.ToContract(c.address, inline(toCborHex(coverDatumData({ kind: "Pool", pool: setCover(pool.datum, t, step.pool.activeCover) }))), value)
    .pay.ToContract(c.address, inline(toCborHex(coverDatumData({ kind: "Policy", policy }))), { lovelace: POLICY_REF_LOVELACE, [ref]: 1n })
    .readFrom(peg)
    .validFrom(Math.max(a.now - BUY_LOWER_SLACK_MS, lucid.slotToUnixTime(0)))
    .validTo(upper)
    .complete();
  return { tx, policy, premium: step.premium, tranche: t, upper, before: pool.ledgers[t], after: step.pool };
}

/** Random 32-byte commitment placeholder until Midnight registration is wired into the Buy flow. */
export function placeholderCommitment(): string {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- policies

export type PolicyStatus = "waiting" | "active" | "claimable" | "expired";

/** Where a policy is in its life, at `now` (ms). `claimable` = past expiry but inside the claim grace window. */
export function policyStatus(p: Pick<PolicyDatum, "start" | "expiry">, now: bigint, claimGraceMs: bigint): PolicyStatus {
  if (now < p.start) return "waiting";
  if (now < p.expiry) return "active";
  if (now <= p.expiry + claimGraceMs) return "claimable";
  return "expired";
}

export interface WalletPolicy extends LivePolicy {
  status: PolicyStatus;
  /** The wallet holds the (222) user token, i.e. the right to claim. */
  holder: boolean;
  /** The policy refunds its deposit to this wallet's payment credential (it bought it). */
  buyer: boolean;
  userUnit: string;
}

/**
 * The live policies (decoded from policy-datum UTxOs at the script) that
 * belong to a wallet: it holds the user token, or it is the refund address.
 * `walletUnits` = Lucid units ("<policy><name>") in the wallet.
 */
export function walletPolicies(
  policies: LivePolicy[],
  scriptHash: string,
  wallet: { units: Iterable<string>; paymentHash?: string },
  now: bigint,
  claimGraceMs: bigint,
): WalletPolicy[] {
  const units = new Set([...wallet.units].map((u) => u.replace(".", "").toLowerCase()));
  const pay = wallet.paymentHash?.toLowerCase();
  const out: WalletPolicy[] = [];
  for (const p of policies) {
    const userUnit = scriptHash + userTokenName(p.policy.policyId);
    const holder = units.has(userUnit);
    const buyer = !!pay && p.policy.refundTo.payment.hash.toLowerCase() === pay;
    if (holder || buyer) out.push({ ...p, status: policyStatus(p.policy, now, claimGraceMs), holder, buyer, userUnit });
  }
  return out;
}

/** Lucid UTxO → the indexer-style shape `readPoolState` folds. */
export const chainUtxoOf = (u: UTxO): ChainUtxo => ({
  tx_hash: u.txHash,
  tx_index: u.outputIndex,
  value: String(u.assets.lovelace ?? 0n),
  asset_list: Object.entries(u.assets)
    .filter(([k]) => k !== "lovelace")
    .map(([k, q]) => ({ policy_id: k.slice(0, 56), asset_name: k.slice(56), quantity: String(q) })),
  inline_datum: u.datum ? { bytes: u.datum } : null,
  block_time: null,
});

/** The connected wallet's policies, read with Lucid (CLI twin of the /cover "My policies" panel). */
export async function listWalletPolicies(lucid: LucidEvolution, c: CoverScript, now = Date.now()): Promise<WalletPolicy[]> {
  const [atScript, mine, address] = await Promise.all([lucid.utxosAt(c.address), lucid.wallet().getUtxos(), lucid.wallet().address()]);
  const state = readPoolState(atScript.map(chainUtxoOf), c.scriptHash, c.assets, c.maxUtilizationBps);
  const units = mine.flatMap((u) => Object.keys(u.assets).filter((k) => k !== "lovelace"));
  return walletPolicies(state.policies, c.scriptHash, { units, paymentHash: plutusAddressOf(address).payment.hash }, BigInt(now), c.params.claimGraceMs);
}
