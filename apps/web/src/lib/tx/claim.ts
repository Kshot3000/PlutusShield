/**
 * Claims and expiries on the live Preview pool: Settle (the holder is paid
 * the coverage when a quorum of oracle feeds attests the depeg) and Expire
 * (anyone releases an unclaimed policy's capacity after the claim grace; the
 * reference UTxO's min-ada goes back to the buyer's refund address).
 *
 * Environment-neutral, like cover.ts and lp.ts: the /cover "My policies"
 * panel runs it with a CIP-30 wallet, contracts/cardano/deploy/scripts/
 * web-claim.ts runs the same code with a local key against Preview, and
 * deploy/lib/actions.ts `settle`/`expire` (the emulator run and `pnpm preview
 * settle|expire`) delegate here, so there is one builder per action.
 *
 * The rules come from @plutusshield/sdk, the mirror of cover.ak: the claim
 * window and 2-of-3 quorum (oracle.settlementCheck), token names, and the
 * tranche accounting (capital - coverage on Settle, capital unchanged on
 * Expire, activeCover - coverage on both).
 */
import type { LucidEvolution, UTxO } from "@lucid-evolution/lucid";
import {
  coverDatumData,
  mintActionData,
  poolActionData,
  refTokenName,
  toCborHex,
  userTokenName,
  type PolicyDatum,
  type PoolDatum,
} from "@plutusshield/sdk/cardano";
import { decodeCoverDatum } from "@plutusshield/sdk/chain";
import { settlementCheck, type FeedUtxo, type SettlementBlocker } from "@plutusshield/sdk/oracle";
import { bech32Of } from "@plutusshield/sdk/cip30";
import { readLivePool, unitOf } from "./lp.ts";
import { feedOfUtxo, slotAligned, type CoverScript } from "./cover.ts";

/** A claim or release must land within this long of being built. */
export const CLAIM_WINDOW_MS = 10 * 60_000;

const inline = (cbor: string) => ({ kind: "inline" as const, value: cbor });
const VIA_POOL = toCborHex(mintActionData("ViaPool"));
const SETTLE = toCborHex(poolActionData({ kind: "Settle" }));
const EXPIRE = toCborHex(poolActionData({ kind: "Expire" }));

const releaseCover = (pool: PoolDatum, t: number, coverage: bigint): PoolDatum => ({
  tranches: pool.tranches.map((x, i) => (i === t ? { totalShares: x.totalShares, activeCover: x.activeCover - coverage } : x)),
});

/** The live policy-datum UTxO for `policyId` (it holds the CIP-67 (100) reference token). */
export async function readLivePolicy(lucid: LucidEvolution, c: CoverScript, policyId: string): Promise<{ utxo: UTxO; policy: PolicyDatum; tranche: number }> {
  const [utxo] = await lucid.utxosAtWithUnit(c.address, c.scriptHash + refTokenName(policyId));
  if (!utxo?.datum) throw new Error("This policy is no longer live: it was already settled or released.");
  const d = decodeCoverDatum(utxo.datum);
  if (d.kind !== "Policy") throw new Error("The reference token sits on a non-policy datum");
  const tranche = c.assets.findIndex((a) => a.policyId === d.policy.asset.policyId && a.assetName === d.policy.asset.assetName);
  if (tranche < 0) throw new Error("The policy's asset isn't a tranche of this pool");
  return { utxo, policy: d.policy, tranche };
}

// ---------------------------------------------------------------- checks

export interface ClaimCheck<T> {
  ok: boolean;
  /** Reference inputs (one per agreeing feed) when `ok`. */
  use: T[];
  /** UTF-8 names of the distinct feeds attesting the trigger inside the cover period. */
  feeds: string[];
  blockers: SettlementBlocker[];
  /** Validity upper bound to build with: min(now + window, expiry + grace), slot-aligned by the builder. */
  upper: number;
}

const hexText = (h: string) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16)));
  } catch {
    return h;
  }
};

/**
 * Would a Settle for `policy` built at `now` pass? Uses EVERY candidate
 * reading (a depeg attestation is a permanent record, not "latest only" like
 * the sale check), so an old in-period attestation still pays out.
 */
export function claimCheck<T extends FeedUtxo>(c: CoverScript, policy: Pick<PolicyDatum, "trigger" | "start" | "expiry">, candidates: T[], now: number): ClaimCheck<T> {
  const deadline = Number(policy.expiry + c.params.claimGraceMs);
  const upper = Math.min(now + CLAIM_WINDOW_MS, deadline);
  const s = settlementCheck(policy, candidates, c.params.oracle, c.params.claimGraceMs, BigInt(upper));
  const blockers = now > deadline ? [{ code: "after-grace" as const, detail: `claim window closed ${new Date(deadline).toISOString()}` }] : s.blockers;
  return { ok: blockers.length === 0, use: s.use, feeds: s.feeds.map(hexText), blockers, upper };
}

/** Plain-language reason a claim can't be filed yet. */
export function claimBlockerMessage(c: CoverScript, blockers: SettlementBlocker[], attesting: number): string {
  if (blockers.some((b) => b.code === "after-grace")) return "The claim window for this policy has closed. Its capacity can now be released.";
  return `No payout trigger yet: ${attesting} of ${c.params.oracle.quorum} required oracle feeds attest a depeg inside this policy's cover period.`;
}

/** Expire is allowed once the validity interval opens strictly after expiry + grace. */
export function releasableAt(c: CoverScript, policy: Pick<PolicyDatum, "expiry">): number {
  return Number(policy.expiry + c.params.claimGraceMs) + 1;
}

// ---------------------------------------------------------------- Settle

export interface SettleArgs {
  policyId: string;
  /** Candidate oracle feed UTxOs (everything at the oracle address is fine). */
  feeds: UTxO[];
  now: number;
}

/**
 * Unsigned Settle: spends the pool (Settle) and the policy UTxO (Settle),
 * burns the (100) and (222) tokens (so the wallet must hold the user token),
 * returns the pool with the tranche's capital and active cover both reduced
 * by the coverage, and references a quorum of depeg attestations. The payout
 * lands in the wallet as change.
 */
export async function buildSettle(lucid: LucidEvolution, c: CoverScript, a: SettleArgs) {
  const [pool, live, mine] = await Promise.all([readLivePool(lucid, c), readLivePolicy(lucid, c, a.policyId), lucid.wallet().getUtxos()]);
  const { utxo: policyUtxo, policy, tranche: t } = live;
  const userUnit = c.scriptHash + userTokenName(a.policyId);
  const holder = mine.filter((u) => (u.assets[userUnit] ?? 0n) === 1n);
  if (!holder.length) throw new Error("This wallet doesn't hold the policy's claim token, so it can't file the claim.");

  const check = claimCheck(c, policy, a.feeds.map((u) => feedOfUtxo(u, c.params.oracle.policyId)), a.now);
  if (!check.ok) throw new Error(claimBlockerMessage(c, check.blockers, check.feeds.length));
  // Slot-align downward so rounding never pushes the bound past expiry + grace.
  const upper = lucid.slotToUnixTime(lucid.unixTimeToSlot(check.upper));

  const capital = pool.ledgers[t].capital;
  if (capital < policy.coverage) throw new Error("The tranche holds less capital than this policy's coverage");
  const value = { ...pool.utxo.assets, [unitOf(c.assets[t])]: capital - policy.coverage };
  const tx = await lucid
    .newTx()
    .collectFrom([pool.utxo], SETTLE)
    .collectFrom([policyUtxo], SETTLE)
    .collectFrom(holder)
    .readFrom(check.use.map((f) => f.utxo))
    .mintAssets({ [c.scriptHash + refTokenName(a.policyId)]: -1n, [userUnit]: -1n }, VIA_POOL)
    .attach.SpendingValidator(c.script)
    .pay.ToContract(c.address, inline(toCborHex(coverDatumData({ kind: "Pool", pool: releaseCover(pool.datum, t, policy.coverage) }))), value)
    .validFrom(Math.max(a.now - 60_000, lucid.slotToUnixTime(0)))
    .validTo(upper)
    .complete();
  return { tx, payout: policy.coverage, asset: policy.asset, tranche: t, feeds: check.feeds, policy };
}

// ---------------------------------------------------------------- Expire

export interface ExpireArgs {
  policyId: string;
  now: number;
}

/**
 * Unsigned Expire: anyone can submit it once the claim grace is over. Burns
 * the (100) reference token (and the (222) user token too when this wallet
 * holds it), frees the tranche's active cover with capital unchanged, and
 * pays the reference UTxO's min-ada to the buyer's refund address.
 */
export async function buildExpire(lucid: LucidEvolution, c: CoverScript, a: ExpireArgs) {
  const [pool, live, mine] = await Promise.all([readLivePool(lucid, c), readLivePolicy(lucid, c, a.policyId), lucid.wallet().getUtxos()]);
  const { utxo: policyUtxo, policy, tranche: t } = live;
  const from = releasableAt(c, policy);
  if (a.now < from) throw new Error(`This policy can be released after ${new Date(from).toISOString()} (expiry plus the claim grace).`);
  const userUnit = c.scriptHash + userTokenName(a.policyId);
  const holder = mine.filter((u) => (u.assets[userUnit] ?? 0n) === 1n);
  const burn: Record<string, bigint> = { [c.scriptHash + refTokenName(a.policyId)]: -1n };
  if (holder.length) burn[userUnit] = -1n;
  const refundTo = bech32Of(policy.refundTo, lucid.config().network === "Mainnet" ? 1 : 0);
  // Lower bound strictly after expiry + grace, rounded up to a slot boundary.
  const lower = Math.max(lucid.slotToUnixTime(lucid.unixTimeToSlot(from) + 1), lucid.slotToUnixTime(lucid.unixTimeToSlot(a.now - 60_000)));
  let tx = lucid
    .newTx()
    .collectFrom([pool.utxo], EXPIRE)
    .collectFrom([policyUtxo], EXPIRE);
  if (holder.length) tx = tx.collectFrom(holder);
  const built = await tx
    .mintAssets(burn, VIA_POOL)
    .attach.SpendingValidator(c.script)
    .pay.ToContract(c.address, inline(toCborHex(coverDatumData({ kind: "Pool", pool: releaseCover(pool.datum, t, policy.coverage) }))), pool.utxo.assets)
    .pay.ToAddress(refundTo, { lovelace: policyUtxo.assets.lovelace })
    .validFrom(lower)
    .validTo(slotAligned(lucid, a.now + CLAIM_WINDOW_MS))
    .complete();
  return { tx: built, refundTo, refund: policyUtxo.assets.lovelace, tranche: t, burnedUserToken: holder.length > 0, policy };
}
