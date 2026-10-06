/**
 * Transaction builders for every PlutusShield pool action. Each one reads the
 * pool UTxO, computes the exact next state with @plutusshield/sdk (the same
 * rules the validator enforces), and returns an unsigned tx builder result.
 * Network-agnostic: the same code runs against the Lucid Emulator and Preview.
 */
import {
  Data,
  type LucidEvolution,
  type Script,
  type UTxO,
} from "@lucid-evolution/lucid";
import {
  buildPolicyDatum,
  earliestStart,
  isHealthyReading,
  coverDatumData,
  initialPoolDatum,
  lpTokenName,
  mintActionData,
  oracleDatumData,
  poolActionData,
  premiumTerms,
  refTokenName,
  requiredPremium,
  textHex,
  toCborHex,
  trancheOf,
  userTokenName,
  type AssetClass,
  type OracleDatum,
  type PoolAction,
  type PoolDatum,
  type PolicyDatum,
} from "../../../../packages/sdk/src/cardano.ts";
import { deposit as depositStep, withdraw as withdrawStep } from "../../../../packages/sdk/src/pool.ts";
import { bech32Address, capitalsOf, decodeCoverDatum, plutusAddress, unitOf, type Deployment } from "./cover.ts";
import { PREVIEW_MOCK_USDC_ASSET_NAME } from "../../../../packages/sdk/src/assets.ts";

const inline = (cbor: string) => ({ kind: "inline" as const, value: cbor });
const poolDatumCbor = (pool: PoolDatum) => toCborHex(coverDatumData({ kind: "Pool", pool }));
const policyDatumCbor = (policy: PolicyDatum) => toCborHex(coverDatumData({ kind: "Policy", policy }));
const redeemer = (a: PoolAction) => toCborHex(poolActionData(a));
const VIA_POOL = toCborHex(mintActionData("ViaPool"));
const POLICY_REF_LOVELACE = 2_500_000n;

/** A time the ledger can represent exactly as a slot boundary. */
export function slotAligned(lucid: LucidEvolution, t: number): number {
  return lucid.slotToUnixTime(lucid.unixTimeToSlot(t));
}

export interface PoolState {
  utxo: UTxO;
  datum: PoolDatum;
  capitals: bigint[];
}

export async function readPool(lucid: LucidEvolution, d: Deployment): Promise<PoolState> {
  const [utxo] = await lucid.utxosAtWithUnit(d.address, d.poolNftUnit);
  if (!utxo) throw new Error(`no pool UTxO with ${d.poolNftUnit} at ${d.address}`);
  const decoded = decodeCoverDatum(utxo.datum!);
  if (decoded.kind !== "Pool") throw new Error("pool UTxO has a policy datum");
  return { utxo, datum: decoded.pool, capitals: capitalsOf(utxo, d.params.assets) };
}

export async function readPolicy(lucid: LucidEvolution, d: Deployment, policyId: string) {
  const [utxo] = await lucid.utxosAtWithUnit(d.address, d.policyId + refTokenName(policyId));
  if (!utxo) throw new Error(`no live policy ${policyId}`);
  const decoded = decodeCoverDatum(utxo.datum!);
  if (decoded.kind !== "Policy") throw new Error("not a policy UTxO");
  return { utxo, policy: decoded.policy };
}

/** Next pool value: same UTxO value with tranche `t` capital set to `capital`, ada optionally topped up. */
function nextValue(d: Deployment, pool: PoolState, t: number, capital: bigint, minLovelace = 0n) {
  const assets = { ...pool.utxo.assets };
  const unit = unitOf(d.params.assets[t].asset);
  if (unit === "lovelace") assets.lovelace = capital;
  else assets[unit] = capital;
  if (assets.lovelace < minLovelace) assets.lovelace = minLovelace; // only when ada isn't the target
  return assets;
}

const setTranche = (pool: PoolDatum, t: number, totalShares: bigint, activeCover: bigint): PoolDatum => ({
  tranches: pool.tranches.map((x, i) => (i === t ? { totalShares, activeCover } : x)),
});

// ---------------------------------------------------------------- setup

/** Mint Preview-only mock tUSDCx under the deployer's native-script policy. */
export function mintMockUsdc(lucid: LucidEvolution, policy: { script: Script; policyId: string }, amount: bigint, to: string) {
  const unit = policy.policyId + PREVIEW_MOCK_USDC_ASSET_NAME;
  return lucid.newTx().mintAssets({ [unit]: amount }).attach.MintingPolicy(policy.script).pay.ToAddress(to, { [unit]: amount }).complete();
}

/** InitPool: consume the seed UTxO, mint the pool NFT, lock it with one empty tranche per asset. */
export async function initPool(lucid: LucidEvolution, d: Deployment, poolMinLovelace: bigint) {
  const [seed] = await lucid.utxosByOutRef([{ txHash: d.params.seed.txHash, outputIndex: d.params.seed.outputIndex }]);
  if (!seed) throw new Error("seed UTxO is already spent or unknown");
  return lucid
    .newTx()
    .collectFrom([seed])
    .mintAssets({ [d.poolNftUnit]: 1n }, toCborHex(mintActionData("InitPool")))
    .attach.MintingPolicy(d.script)
    .pay.ToContract(d.address, inline(poolDatumCbor(initialPoolDatum(d.params.assets))), {
      lovelace: poolMinLovelace,
      [d.poolNftUnit]: 1n,
    })
    .complete();
}

// ---------------------------------------------------------------- LP

export async function deposit(lucid: LucidEvolution, d: Deployment, asset: AssetClass, amount: bigint) {
  const pool = await readPool(lucid, d);
  const t = trancheOf(d.params.assets, asset);
  const tr = pool.datum.tranches[t];
  const step = depositStep({ capital: pool.capitals[t], ...tr }, amount);
  if (!step.ok) throw new Error(step.reason);
  // The pool's initial min-UTxO ada (poolMinLovelace) already covers the
  // extra token a first USDC deposit adds; the validator would also accept
  // an ada top-up here (it only ever grows the ada tranche).
  const value = nextValue(d, pool, t, step.pool.capital);
  const tx = await lucid
    .newTx()
    .collectFrom([pool.utxo], redeemer({ kind: "Deposit", tranche: t }))
    .mintAssets({ [d.policyId + lpTokenName(t)]: step.shares }, VIA_POOL)
    .attach.SpendingValidator(d.script)
    .pay.ToContract(d.address, inline(poolDatumCbor(setTranche(pool.datum, t, step.pool.totalShares, tr.activeCover))), value)
    .complete();
  return { tx, shares: step.shares, tranche: t };
}

export async function withdraw(lucid: LucidEvolution, d: Deployment, asset: AssetClass, shares: bigint) {
  const pool = await readPool(lucid, d);
  const t = trancheOf(d.params.assets, asset);
  const tr = pool.datum.tranches[t];
  const step = withdrawStep({ capital: pool.capitals[t], ...tr }, shares, d.params.product.maxUtilizationBps);
  if (!step.ok) throw new Error(step.reason);
  const tx = await lucid
    .newTx()
    .collectFrom([pool.utxo], redeemer({ kind: "Withdraw", tranche: t, shares }))
    .mintAssets({ [d.policyId + lpTokenName(t)]: -shares }, VIA_POOL)
    .attach.SpendingValidator(d.script)
    .pay.ToContract(d.address, inline(poolDatumCbor(setTranche(pool.datum, t, step.pool.totalShares, tr.activeCover))), nextValue(d, pool, t, step.pool.capital))
    .complete();
  return { tx, payout: step.payout };
}

// ---------------------------------------------------------------- policies

/** Decode an oracle feed UTxO's inline datum, if it has the `OracleDatum` shape. */
export function readOracleDatum(u: UTxO): OracleDatum | undefined {
  try {
    const c = Data.from(u.datum!) as unknown as { index: number; fields: unknown[] };
    const [coveredAsset, priceBps, windowStart, windowEnd] = c.fields as [string, bigint, bigint, bigint];
    if (c.index !== 0 || typeof priceBps !== "bigint") return undefined;
    return { coveredAsset, priceBps, windowStart, windowEnd };
  } catch {
    return undefined;
  }
}

/**
 * Feed UTxOs for the Buy circuit-breaker, for a tx landing by `saleBy`.
 *
 * The validator needs a fresh healthy-peg reading from EVERY allowlisted feed.
 * An honest client also uses only the newest reading per feed (by
 * `window_end`): an older healthy reading may still be within the max age
 * while a newer one already reports a depeg. Returns the newest reading per
 * feed when it passes, and the names of the feeds that are missing, stale, or
 * depegged.
 */
export function saleFeeds(d: Deployment, candidates: UTxO[], saleBy: number): { ok: UTxO[]; blocked: string[] } {
  const o = d.params.oracle;
  const latest = new Map<string, { u: UTxO; datum: OracleDatum }>();
  for (const u of candidates) {
    const names = Object.entries(u.assets).filter(([k]) => k.startsWith(o.policyId));
    if (names.length !== 1 || names[0][1] !== 1n) continue;
    const name = names[0][0].slice(o.policyId.length);
    if (!o.feeds.includes(name)) continue;
    const datum = readOracleDatum(u);
    if (!datum) continue;
    const prev = latest.get(name);
    if (!prev || datum.windowEnd > prev.datum.windowEnd) latest.set(name, { u, datum });
  }
  const ok: UTxO[] = [];
  const blocked: string[] = [];
  for (const name of o.feeds) {
    const r = latest.get(name);
    if (r && isHealthyReading(r.datum, d.params.product.trigger, d.params.saleGuard, BigInt(saleBy))) ok.push(r.u);
    else blocked.push(Buffer.from(name, "hex").toString("utf8"));
  }
  return { ok, blocked };
}

export async function buy(
  lucid: LucidEvolution,
  d: Deployment,
  args: {
    asset: AssetClass;
    coverage: bigint;
    days: bigint;
    midnightCommitment: string;
    now: number;
    /** Candidate oracle feed UTxOs; the healthy, fresh ones become reference inputs. */
    feeds: UTxO[];
    /** Expire refund address; defaults to the buying wallet. */
    refundTo?: string;
  },
) {
  const pool = await readPool(lucid, d);
  const t = trancheOf(d.params.assets, args.asset);
  const tr = pool.datum.tranches[t];
  const capital = pool.capitals[t];
  const premium = requiredPremium(premiumTerms(d.params.product, d.params.assets[t]), args.coverage, args.days, capital, tr.activeCover);
  // The tx must land by `upper`; cover starts after the waiting period.
  const upper = slotAligned(lucid, args.now + 10 * 60_000);
  const { ok: peg, blocked } = saleFeeds(d, args.feeds, upper);
  if (blocked.length) {
    throw new Error(
      `sale circuit-breaker: every allowlisted feed needs a fresh healthy-peg reading (price >= ${d.params.product.trigger.thresholdBps} bps, ` +
        `window_end within ${Number(d.params.saleGuard.maxPriceAgeMs) / 60_000} min). Blocked: ${blocked.join(", ")}. ` +
        `Publish fresh readings (Preview: \`pnpm preview peg\`) or wait for the depeg to clear.`,
    );
  }
  const start = slotAligned(lucid, Number(earliestStart(d.params.saleGuard, BigInt(upper))));
  const policy = buildPolicyDatum({
    poolRef: { txHash: pool.utxo.txHash, outputIndex: pool.utxo.outputIndex },
    terms: d.params.product,
    asset: args.asset,
    coverage: args.coverage,
    premium,
    start: BigInt(start),
    days: args.days,
    midnightCommitment: args.midnightCommitment,
    refundTo: plutusAddress(args.refundTo ?? (await lucid.wallet().address())),
  });
  const ref = d.policyId + refTokenName(policy.policyId);
  const user = d.policyId + userTokenName(policy.policyId);
  const tx = await lucid
    .newTx()
    .collectFrom([pool.utxo], redeemer({ kind: "Buy" }))
    .mintAssets({ [ref]: 1n, [user]: 1n }, VIA_POOL)
    .attach.SpendingValidator(d.script)
    .pay.ToContract(d.address, inline(poolDatumCbor(setTranche(pool.datum, t, tr.totalShares, tr.activeCover + args.coverage))), nextValue(d, pool, t, capital + premium))
    .pay.ToContract(d.address, inline(policyDatumCbor(policy)), { lovelace: POLICY_REF_LOVELACE, [ref]: 1n })
    .readFrom(peg)
    .validFrom(args.now - 60_000)
    .validTo(upper)
    .complete();
  return { tx, policy, premium, tranche: t };
}

/** Preview test oracle: publish one feed UTxO per name, each holding exactly one feed token. */
export function publishFeeds(
  lucid: LucidEvolution,
  oracle: { script: Script; policyId: string; keyHash: string },
  to: string,
  feeds: { name: string; datum: OracleDatum }[],
) {
  let tx = lucid.newTx();
  const mint: Record<string, bigint> = {};
  for (const f of feeds) {
    const unit = oracle.policyId + textHex(f.name);
    mint[unit] = (mint[unit] ?? 0n) + 1n;
    tx = tx.pay.ToContract(to, inline(toCborHex(oracleDatumData(f.datum))), { lovelace: 2_000_000n, [unit]: 1n });
  }
  return tx.mintAssets(mint).attach.MintingPolicy(oracle.script).addSignerKey(oracle.keyHash).complete();
}

export async function settle(lucid: LucidEvolution, d: Deployment, policyId: string, feedUtxos: UTxO[], now: number) {
  const pool = await readPool(lucid, d);
  const { utxo: policyUtxo, policy } = await readPolicy(lucid, d, policyId);
  const t = trancheOf(d.params.assets, policy.asset);
  const tr = pool.datum.tranches[t];
  const holder = (await lucid.wallet().getUtxos()).filter((u) => (u.assets[d.policyId + userTokenName(policyId)] ?? 0n) === 1n);
  if (!holder.length) throw new Error("this wallet does not hold the policy's user token");
  const tx = await lucid
    .newTx()
    .collectFrom([pool.utxo], redeemer({ kind: "Settle" }))
    .collectFrom([policyUtxo], redeemer({ kind: "Settle" }))
    .collectFrom(holder)
    .readFrom(feedUtxos)
    .mintAssets({ [d.policyId + refTokenName(policyId)]: -1n, [d.policyId + userTokenName(policyId)]: -1n }, VIA_POOL)
    .attach.SpendingValidator(d.script)
    .pay.ToContract(d.address, inline(poolDatumCbor(setTranche(pool.datum, t, tr.totalShares, tr.activeCover - policy.coverage))), nextValue(d, pool, t, pool.capitals[t] - policy.coverage))
    .validFrom(now - 60_000)
    .validTo(slotAligned(lucid, now + 10 * 60_000))
    .complete();
  return { tx, payout: policy.coverage, asset: policy.asset };
}

export async function expire(lucid: LucidEvolution, d: Deployment, policyId: string, now: number) {
  const pool = await readPool(lucid, d);
  const { utxo: policyUtxo, policy } = await readPolicy(lucid, d, policyId);
  const t = trancheOf(d.params.assets, policy.asset);
  const tr = pool.datum.tranches[t];
  const tx = await lucid
    .newTx()
    .collectFrom([pool.utxo], redeemer({ kind: "Expire" }))
    .collectFrom([policyUtxo], redeemer({ kind: "Expire" }))
    .mintAssets({ [d.policyId + refTokenName(policyId)]: -1n }, VIA_POOL)
    .attach.SpendingValidator(d.script)
    .pay.ToContract(d.address, inline(poolDatumCbor(setTranche(pool.datum, t, tr.totalShares, tr.activeCover - policy.coverage))), pool.utxo.assets)
    // The reference UTxO's min-ada goes back to the buyer's refund address,
    // whoever submits this.
    .pay.ToAddress(bech32Address(d.network, policy.refundTo), { lovelace: policyUtxo.assets.lovelace })
    .validFrom(now)
    .validTo(now + 10 * 60_000)
    .complete();
  return { tx, refundTo: bech32Address(d.network, policy.refundTo), refund: policyUtxo.assets.lovelace };
}

export { Data };
