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
  coverDatumData,
  initialPoolDatum,
  lpTokenName,
  mintActionData,
  oracleDatumData,
  poolActionData,
  refTokenName,
  textHex,
  toCborHex,
  trancheOf,
  userTokenName,
  type AssetClass,
  type OracleDatum,
  type PoolAction,
  type PoolDatum,
} from "../../../../packages/sdk/src/cardano.ts";
import { deposit as depositStep, withdraw as withdrawStep } from "../../../../packages/sdk/src/pool.ts";
import { bech32Address, capitalsOf, decodeCoverDatum, unitOf, type Deployment } from "./cover.ts";
import { PREVIEW_MOCK_USDC_ASSET_NAME } from "../../../../packages/sdk/src/assets.ts";
import { decodeOracleDatum } from "../../../../packages/sdk/src/chain.ts";
import { buildBuy, saleFeeds as webSaleFeeds, slotAligned, type CoverScript } from "../../../../apps/web/src/lib/tx/cover.ts";

const inline = (cbor: string) => ({ kind: "inline" as const, value: cbor });
const poolDatumCbor = (pool: PoolDatum) => toCborHex(coverDatumData({ kind: "Pool", pool }));
const redeemer = (a: PoolAction) => toCborHex(poolActionData(a));
const VIA_POOL = toCborHex(mintActionData("ViaPool"));

/** A time the ledger can represent exactly as a slot boundary. */
export { slotAligned };

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
export const readOracleDatum = (u: UTxO): OracleDatum | undefined => decodeOracleDatum(u.datum);

/** The website's view of a deployment (apps/web/src/lib/tx/cover.ts). */
export const coverScriptOf = (d: Deployment): CoverScript => ({
  scriptHash: d.policyId,
  address: d.address,
  poolNftUnit: d.poolNftUnit,
  maxUtilizationBps: d.params.product.maxUtilizationBps,
  assets: d.params.assets.map((a) => a.asset),
  script: d.script,
  params: d.params,
});

/**
 * Feed UTxOs for the Buy circuit-breaker, for a tx landing by `saleBy`: the
 * newest reading per allowlisted feed when every one passes, and the names of
 * the feeds that are missing, stale, or depegged. Same check the website runs.
 */
export const saleFeeds = (d: Deployment, candidates: UTxO[], saleBy: number) => webSaleFeeds(d.params, candidates, saleBy);

/**
 * Buy. One builder for every caller: this delegates to the website's
 * buildBuy (apps/web/src/lib/tx/cover.ts), so the emulator run, `pnpm preview
 * buy`, `pnpm web-buy` and the /cover page all submit the same transaction.
 */
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
  const { asset, ...rest } = args;
  return buildBuy(lucid, coverScriptOf(d), { ...rest, tranche: trancheOf(d.params.assets, asset) });
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

/**
 * Live publisher: write a fresh reading for every feed while recycling
 * `recycle` (superseded healthy-peg feed UTxOs at the oracle address). Their
 * feed tokens move into the new outputs and their 2 ada comes back as change,
 * so a long-running relay doesn't leak min-ada on every refresh. Tokens are
 * minted only for feeds with nothing to recycle and surplus ones are burned.
 * Callers must never pass depeg attestations: claims settle against them.
 */
export function refreshFeeds(
  lucid: LucidEvolution,
  oracle: { script: Script; policyId: string; keyHash: string },
  to: string,
  feeds: { name: string; datum: OracleDatum }[],
  recycle: UTxO[],
) {
  const have: Record<string, bigint> = {};
  for (const u of recycle)
    for (const [unit, q] of Object.entries(u.assets)) if (unit.startsWith(oracle.policyId)) have[unit] = (have[unit] ?? 0n) + q;
  const need: Record<string, bigint> = {};
  let tx = lucid.newTx();
  if (recycle.length) tx = tx.collectFrom(recycle);
  for (const f of feeds) {
    const unit = oracle.policyId + textHex(f.name);
    need[unit] = (need[unit] ?? 0n) + 1n;
    tx = tx.pay.ToContract(to, inline(toCborHex(oracleDatumData(f.datum))), { lovelace: 2_000_000n, [unit]: 1n });
  }
  const mint: Record<string, bigint> = {};
  for (const unit of new Set([...Object.keys(have), ...Object.keys(need)])) {
    const delta = (need[unit] ?? 0n) - (have[unit] ?? 0n);
    if (delta !== 0n) mint[unit] = delta;
  }
  if (Object.keys(mint).length) tx = tx.mintAssets(mint).attach.MintingPolicy(oracle.script);
  return tx.addSignerKey(oracle.keyHash).complete();
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
