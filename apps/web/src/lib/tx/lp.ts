/**
 * LP transactions for the live Preview pool: Deposit and Withdraw.
 *
 * Environment-neutral on purpose. The browser runs it with a CIP-30 wallet
 * (Lace, Eternl, Typhon) and contracts/cardano/deploy/scripts/web-lp.ts runs
 * the exact same code with a local key against Preview, so what ships in the
 * site is what we test on-chain. Only *types* come from Lucid here; the caller
 * passes a ready LucidEvolution instance.
 *
 * Next state comes from @plutusshield/sdk (the same share math the Aiken
 * validator enforces), so a tx this builds either matches the script or fails
 * before it reaches the wallet.
 */
import type { LucidEvolution, Script, UTxO } from "@lucid-evolution/lucid";
import {
  coverDatumData,
  lpTokenName,
  mintActionData,
  poolActionData,
  toCborHex,
  type AssetClass,
  type PoolDatum,
} from "@plutusshield/sdk/cardano";
import { decodeCoverDatum } from "@plutusshield/sdk/chain";
import { deposit as depositStep, maxWithdrawableShares, withdraw as withdrawStep, type PoolLedger } from "@plutusshield/sdk/pool";

export interface PoolScript {
  scriptHash: string;
  address: string;
  poolNftUnit: string;
  maxUtilizationBps: bigint;
  /** Tranche assets in CoverParams order. */
  assets: AssetClass[];
  script: Script;
}

/** Revive the JSON artifact written by `pnpm web-artifacts`. */
export function poolScriptFrom(j: {
  scriptHash: string;
  address: string;
  poolNftUnit: string;
  maxUtilizationBps: string | number;
  assets: AssetClass[];
  script: { type: string; script: string };
}): PoolScript {
  return {
    scriptHash: j.scriptHash,
    address: j.address,
    poolNftUnit: j.poolNftUnit,
    maxUtilizationBps: BigInt(j.maxUtilizationBps),
    assets: j.assets,
    script: j.script as Script,
  };
}

export const unitOf = (a: AssetClass) => (a.policyId === "" ? "lovelace" : a.policyId + a.assetName);
export const lpUnit = (p: PoolScript, tranche: number) => p.scriptHash + lpTokenName(tranche);

export interface LivePool {
  utxo: UTxO;
  datum: PoolDatum;
  ledgers: PoolLedger[];
}

export async function readLivePool(lucid: LucidEvolution, p: PoolScript): Promise<LivePool> {
  const [utxo] = await lucid.utxosAtWithUnit(p.address, p.poolNftUnit);
  if (!utxo?.datum) throw new Error("Couldn't find the pool UTxO on Preview");
  const d = decodeCoverDatum(utxo.datum);
  if (d.kind !== "Pool") throw new Error("Pool NFT sits on a non-pool datum");
  const ledgers = p.assets.map((a, i) => ({
    capital: utxo.assets[unitOf(a)] ?? 0n,
    totalShares: d.pool.tranches[i].totalShares,
    activeCover: d.pool.tranches[i].activeCover,
  }));
  return { utxo, datum: d.pool, ledgers };
}

const inline = (cbor: string) => ({ kind: "inline" as const, value: cbor });
const VIA_POOL = toCborHex(mintActionData("ViaPool"));

function nextPool(pool: LivePool, t: number, ledger: PoolLedger): PoolDatum {
  return { tranches: pool.datum.tranches.map((x, i) => (i === t ? { totalShares: ledger.totalShares, activeCover: x.activeCover } : x)) };
}

function nextValue(p: PoolScript, pool: LivePool, t: number, capital: bigint) {
  const assets = { ...pool.utxo.assets };
  assets[unitOf(p.assets[t])] = capital;
  return assets;
}

/** Preview of a deposit without touching a wallet. */
export function quoteDeposit(ledger: PoolLedger, amount: bigint) {
  return depositStep(ledger, amount);
}

/** Preview of a withdrawal, plus the most the capital lock allows for `held` shares. */
export function quoteWithdraw(ledger: PoolLedger, shares: bigint, maxUtilizationBps: bigint, held: bigint) {
  return { step: withdrawStep(ledger, shares, maxUtilizationBps), maxShares: maxWithdrawableShares(ledger, maxUtilizationBps, held) };
}

/** Unsigned Deposit: pool UTxO in, pool UTxO out with +amount capital, LP shares minted to the wallet. */
export async function buildDeposit(lucid: LucidEvolution, p: PoolScript, tranche: number, amount: bigint) {
  const pool = await readLivePool(lucid, p);
  const step = depositStep(pool.ledgers[tranche], amount);
  if (!step.ok) throw new Error(step.reason);
  const tx = await lucid
    .newTx()
    .collectFrom([pool.utxo], toCborHex(poolActionData({ kind: "Deposit", tranche })))
    .mintAssets({ [lpUnit(p, tranche)]: step.shares }, VIA_POOL)
    .attach.SpendingValidator(p.script)
    .pay.ToContract(p.address, inline(toCborHex(coverDatumData({ kind: "Pool", pool: nextPool(pool, tranche, step.pool) }))), nextValue(p, pool, tranche, step.pool.capital))
    .complete();
  return { tx, shares: step.shares, before: pool.ledgers[tranche], after: step.pool };
}

/** Unsigned Withdraw: burns `shares` LP tokens and pays their pro-rata capital to the wallet. */
export async function buildWithdraw(lucid: LucidEvolution, p: PoolScript, tranche: number, shares: bigint) {
  const pool = await readLivePool(lucid, p);
  const step = withdrawStep(pool.ledgers[tranche], shares, p.maxUtilizationBps);
  if (!step.ok) throw new Error(step.reason);
  const tx = await lucid
    .newTx()
    .collectFrom([pool.utxo], toCborHex(poolActionData({ kind: "Withdraw", tranche, shares })))
    .mintAssets({ [lpUnit(p, tranche)]: -shares }, VIA_POOL)
    .attach.SpendingValidator(p.script)
    .pay.ToContract(p.address, inline(toCborHex(coverDatumData({ kind: "Pool", pool: nextPool(pool, tranche, step.pool) }))), nextValue(p, pool, tranche, step.pool.capital))
    .complete();
  return { tx, payout: step.payout, before: pool.ledgers[tranche], after: step.pool };
}
