/**
 * End-to-end run of the real applied validator in the Lucid Emulator: the
 * exact transactions the Preview runbook submits, with no keys or funds.
 *
 *   1  mint mock tUSDCx            (deployer native script)
 *   2  InitPool                     [ada, tUSDCx] tranches, pool NFT
 *   3  Deposit ada, Deposit tUSDCx  separate LP tokens lp00 / lp01
 *   4  oracle attests a healthy peg on all 3 feeds, then Buy USDC + Buy ada
 *      (premium paid in the policy's asset, cover starts after the waiting period)
 *   4b one feed turns depegged: a new Buy is refused even with a healthy 2-of-3
 *   5  oracle publishes 2-of-3 depeg feeds; a new Buy is refused (circuit-breaker)
 *   6  Settle the USDC policy       payout in tUSDCx from the USDC tranche
 *   7  Expire the ada policy        submitted by a third party, deposit refunded to the buyer
 *   8  Withdraw part of each tranche
 *
 * Every step asserts the on-chain pool state against @plutusshield/sdk.
 */
import assert from "node:assert/strict";
import { Emulator, Lucid, generateEmulatorAccountFromPrivateKey, type LucidEvolution, type TxSignBuilder } from "@lucid-evolution/lucid";
import { ADA, DAY_MS, lpTokenName, textHex } from "../../../../packages/sdk/src/cardano.ts";
import { PREVIEW_MOCK_USDC_ASSET_NAME } from "../../../../packages/sdk/src/assets.ts";
import { buildParams, deployment, loadConfig, unitOf } from "../lib/cover.ts";
import { keyInfo, sigPolicy } from "../lib/keys.ts";
import * as act from "../lib/actions.ts";
import { listWalletPolicies } from "../../../../apps/web/src/lib/tx/cover.ts";
import { checkPolicyKey } from "../../../../packages/sdk/src/midnight.ts";

const log = (...a: unknown[]) => console.log("  ", ...a);
const U = 1_000_000n;

const deployerAcct = generateEmulatorAccountFromPrivateKey({ lovelace: 200_000_000_000n });
const oracleAcct = generateEmulatorAccountFromPrivateKey({ lovelace: 50_000_000n });
const buyerAcct = generateEmulatorAccountFromPrivateKey({ lovelace: 50_000_000_000n });
const emulator = new Emulator([deployerAcct, oracleAcct, buyerAcct]);
const lucid: LucidEvolution = await Lucid(emulator, "Custom");
const network = "Custom" as const;

const deployer = keyInfo("deployer", deployerAcct.privateKey, network);
const oracle = keyInfo("oracle", oracleAcct.privateKey, network);
const usdcPolicy = sigPolicy(deployer.keyHash);
const oraclePolicy = sigPolicy(oracle.keyHash);
const usdcUnit = usdcPolicy.policyId + PREVIEW_MOCK_USDC_ASSET_NAME;
const USDC = { policyId: usdcPolicy.policyId, assetName: PREVIEW_MOCK_USDC_ASSET_NAME };

async function submit(label: string, tx: TxSignBuilder, ...extraKeys: string[]) {
  let s = tx.sign.withWallet();
  for (const k of extraKeys) s = s.sign.withPrivateKey(k);
  const signed = await s.complete();
  const hash = await signed.submit();
  emulator.awaitBlock(1);
  log(`✓ ${label.padEnd(34)} ${hash.slice(0, 16)}…  fee ${tx.toTransaction().body().fee()} lovelace`);
  return hash;
}
const as = (acct: { privateKey: string }) => lucid.selectWallet.fromPrivateKey(acct.privateKey);

console.log("PlutusShield emulator run (applied cover validator, Plutus V3)");

// 1. mock tUSDCx to deployer (LP) and buyer
as(deployerAcct);
await submit("mint 2,000,000 tUSDCx", await act.mintMockUsdc(lucid, usdcPolicy, 2_000_000n * U, deployer.address));
await submit("send 50,000 tUSDCx to buyer", await lucid.newTx().pay.ToAddress(buyerAcct.address, { [usdcUnit]: 50_000n * U }).complete());

// 2. parameterise with a real seed UTxO and init the pool
const cfg = loadConfig();
const [seedUtxo] = await lucid.wallet().getUtxos();
const params = buildParams(cfg, { txHash: seedUtxo.txHash, outputIndex: seedUtxo.outputIndex }, oraclePolicy.policyId, usdcPolicy.policyId);
const d = deployment(network, params);
log(`script hash ${d.policyId}`);
await submit("InitPool (mint pool NFT)", await act.initPool(lucid, d, BigInt(cfg.poolMinLovelace)));
let pool = await act.readPool(lucid, d);
assert.equal(pool.datum.tranches.length, 2);

// 3. LP deposits, one per tranche
const dAda = await act.deposit(lucid, d, ADA, 100_000n * U);
await submit("Deposit 100,000 ADA (tranche 0)", dAda.tx);
const dUsd = await act.deposit(lucid, d, USDC, 500_000n * U);
await submit("Deposit 500,000 tUSDCx (tranche 1)", dUsd.tx);
pool = await act.readPool(lucid, d);
assert.equal(pool.capitals[1], 500_000n * U);
assert.equal(pool.datum.tranches[1].totalShares, 500_000n * U);
const lp = await lucid.wallet().getUtxos();
const held = (unit: string, utxos = lp) => utxos.reduce((n, u) => n + (u.assets[unit] ?? 0n), 0n);
assert.equal(held(d.policyId + lpTokenName(1)), 500_000n * U);
assert.ok(held(d.policyId + lpTokenName(0)) > 0n);

// 4. oracle attests a healthy peg (all 3 feeds at ~1.00 over the last 24h),
//    then the buyer buys a USDC policy and an ada policy
const oracleFeeds = async () =>
  (await lucid.utxosAt(oracle.address)).filter((u) => Object.keys(u.assets).some((k) => k.startsWith(oraclePolicy.policyId)));
const covered = textHex(cfg.product.coveredAsset);
as(oracleAcct);
const pegNow = BigInt(emulator.now());
await submit("oracle attests healthy peg", await act.publishFeeds(lucid, { ...oraclePolicy, keyHash: oracle.keyHash }, oracle.address, [
  { name: "feed-a", datum: { coveredAsset: covered, priceBps: 9_990n, windowStart: pegNow - DAY_MS, windowEnd: pegNow } },
  { name: "feed-b", datum: { coveredAsset: covered, priceBps: 10_005n, windowStart: pegNow - DAY_MS, windowEnd: pegNow } },
  { name: "feed-c", datum: { coveredAsset: covered, priceBps: 9_995n, windowStart: pegNow - DAY_MS, windowEnd: pegNow } },
]), oracle.privateKey);
as(buyerAcct);
// Fixed holder secrets so the emulator run is reproducible; the browser generates fresh ones per Buy.
const holder = { holderSecret: "c0441700".repeat(8), coverageSalt: "5a17".repeat(16) };
const usdBefore = held(usdcUnit, await lucid.wallet().getUtxos());
const bUsd = await act.buy(lucid, d, { asset: USDC, coverage: 10_000n * U, days: 30n, holder, now: emulator.now(), feeds: await oracleFeeds() });
await submit(`Buy 10k tUSDCx cover, premium ${bUsd.premium}`, bUsd.tx);
assert.equal(held(usdcUnit, await lucid.wallet().getUtxos()), usdBefore - bUsd.premium, "premium paid in tUSDCx");
assert.ok(bUsd.policy.start >= BigInt(emulator.now()) + params.saleGuard.waitingPeriodMs - 60_000n, "cover starts after the waiting period");
const bAda = await act.buy(lucid, d, { asset: ADA, coverage: 5_000n * U, days: 14n, holder, now: emulator.now(), feeds: await oracleFeeds() });
await submit(`Buy 5k ADA cover, premium ${bAda.premium}`, bAda.tx);
pool = await act.readPool(lucid, d);
assert.equal(pool.datum.tranches[1].activeCover, 10_000n * U);
assert.equal(pool.datum.tranches[0].activeCover, 5_000n * U);
assert.equal(pool.capitals[1], 500_000n * U + bUsd.premium);
// The website's "My policies" reader (apps/web/src/lib/tx/cover.ts) finds both, held and bought by this wallet.
const mine = await listWalletPolicies(lucid, act.coverScriptOf(d), emulator.now());
assert.deepEqual(new Set(mine.map((p) => p.policy.policyId)), new Set([bUsd.policy.policyId, bAda.policy.policyId]));
assert.ok(mine.every((p) => p.holder && p.buyer && p.status === "waiting"), "fresh policies sit in their waiting period");
// Midnight binding: each on-chain datum carries the registration commitment of the buyer's policy key.
for (const b of [bUsd, bAda]) {
  const onChain = mine.find((p) => p.policy.policyId === b.policy.policyId)!;
  assert.equal(onChain.policy.midnightCommitment, b.policyKey.registrationCommitment, "datum midnight_commitment = policy key registration commitment");
  assert.equal(b.policyKey.coverage, onChain.policy.coverage.toString());
  assert.equal(b.policyKey.expiry, onChain.policy.expiry.toString());
  assert.ok((await checkPolicyKey(b.policyKey, onChain.policy.midnightCommitment)).ok, "policy key opens the on-chain commitment");
  assert.ok(!(await checkPolicyKey({ ...b.policyKey, holderSecret: "11".repeat(32) }, onChain.policy.midnightCommitment)).ok, "a different holder secret does not");
}
assert.notEqual(bUsd.policy.midnightCommitment, bAda.policy.midnightCommitment, "same secrets, different policy id -> different commitment");
as(deployerAcct);
assert.equal((await listWalletPolicies(lucid, act.coverScriptOf(d), emulator.now())).length, 0, "other wallets see none");
as(buyerAcct);
log("✓ listWalletPolicies: buyer sees its 2 policies (waiting period), the LP wallet sees none");

// 4b. feed-c now reports 0.93. feed-a and feed-b are still a fresh healthy
//     quorum, but sales need every feed, using its newest reading.
emulator.awaitSlot(60);
as(oracleAcct);
const cNow = BigInt(emulator.now());
await submit("oracle: feed-c reports 0.93", await act.publishFeeds(lucid, { ...oraclePolicy, keyHash: oracle.keyHash }, oracle.address, [
  { name: "feed-c", datum: { coveredAsset: covered, priceBps: 9_300n, windowStart: cNow - 3_600_000n, windowEnd: cNow } },
]), oracle.privateKey);
as(buyerAcct);
await assert.rejects(
  act.buy(lucid, d, { asset: ADA, coverage: 1_000n * U, days: 14n, holder, now: emulator.now(), feeds: await oracleFeeds() }),
  /circuit-breaker.*Blocked: feed-c/s,
);
log("✓ Buy refused while one feed reports a depeg (healthy 2-of-3 is not enough)");

// 5. depeg: 2 of 3 feeds report 0.91 for 26h inside the USDC policy's term
const start = Number(bUsd.policy.start) + 3_600_000;
const end = start + 26 * 3_600_000;
emulator.awaitSlot(Math.ceil((end - emulator.now()) / 1000) + 600);
as(oracleAcct);
const feedDatum = (price: bigint) => ({ coveredAsset: textHex(cfg.product.coveredAsset), priceBps: price, windowStart: BigInt(start), windowEnd: BigInt(end) });
await submit("oracle publishes feed-a, feed-b", await act.publishFeeds(lucid, { ...oraclePolicy, keyHash: oracle.keyHash }, oracle.address, [
  { name: "feed-a", datum: feedDatum(9_100n) },
  { name: "feed-b", datum: feedDatum(9_150n) },
]), oracle.privateKey);
const feeds = (await oracleFeeds()).filter((u) => act.readOracleDatum(u)?.windowStart === BigInt(start));
assert.equal(feeds.length, 2);

// 5b. circuit-breaker: with the depeg on record (and the peg readings stale),
//     nobody can buy new cover
as(buyerAcct);
await assert.rejects(
  act.buy(lucid, d, { asset: USDC, coverage: 1_000n * U, days: 14n, holder, now: emulator.now(), feeds: await oracleFeeds() }),
  /circuit-breaker/,
);
log("✓ Buy during the depeg refused (feeds no longer report a fresh healthy peg)");

// 6. settle the USDC policy: payout in tUSDCx, ada tranche untouched
as(deployerAcct);
await assert.rejects(act.settle(lucid, d, bUsd.policy.policyId, feeds, emulator.now()), /claim token/);
log("✓ Settle refused for a wallet without the policy's claim token");
as(buyerAcct);
await assert.rejects(act.settle(lucid, d, bUsd.policy.policyId, feeds.slice(0, 1), emulator.now()), /1 of 2 required oracle feeds/);
log("✓ Settle refused with only 1 of 2 required depeg attestations");
await assert.rejects(act.expire(lucid, d, bAda.policy.policyId, emulator.now()), /can be released after/);
log("✓ Expire refused before expiry + claim grace");
const before = await act.readPool(lucid, d);
const usdHeld = held(usdcUnit, await lucid.wallet().getUtxos());
const s = await act.settle(lucid, d, bUsd.policy.policyId, feeds, emulator.now());
await submit("Settle USDC policy (oracle 2-of-3)", s.tx);
pool = await act.readPool(lucid, d);
assert.equal(pool.capitals[1], before.capitals[1] - 10_000n * U);
assert.equal(pool.capitals[0], before.capitals[0]);
assert.equal(pool.datum.tranches[1].activeCover, 0n);
assert.equal(held(usdcUnit, await lucid.wallet().getUtxos()), usdHeld + 10_000n * U, "holder paid 10,000 tUSDCx");

// 7. the ada policy expires unclaimed; anyone can release its capacity, and
//    the reference UTxO's min-ada goes back to the buyer, not the submitter
emulator.awaitSlot(Math.ceil((Number(bAda.policy.expiry + BigInt(cfg.claimGraceDays) * DAY_MS) - emulator.now()) / 1000) + 60);
const buyerAda = async () => (await lucid.utxosAt(buyerAcct.address)).reduce((n, u) => n + u.assets.lovelace, 0n);
const buyerAdaBefore = await buyerAda();
as(deployerAcct);
const ex = await act.expire(lucid, d, bAda.policy.policyId, emulator.now());
assert.equal(ex.refundTo, buyerAcct.address);
await submit(`Expire ada policy (refund ${ex.refund} to buyer)`, ex.tx);
pool = await act.readPool(lucid, d);
assert.equal(pool.datum.tranches[0].activeCover, 0n);
assert.equal(await buyerAda(), buyerAdaBefore + ex.refund, "deposit refunded to the buyer");

// 8. LPs withdraw from each tranche at the current share price
const wUsd = await act.withdraw(lucid, d, USDC, 100_000n * U);
await submit(`Withdraw 100k lp01 -> ${wUsd.payout} tUSDCx`, wUsd.tx);
const wAda = await act.withdraw(lucid, d, ADA, 50_000n * U);
await submit(`Withdraw 50k lp00 -> ${wAda.payout} lovelace`, wAda.tx);
assert.ok(wUsd.payout > 100_000n * U - 10_000n * U / 5n, "USDC LPs absorbed the claim pro rata");

pool = await act.readPool(lucid, d);
console.log("\nfinal pool:", {
  ada: { capital: pool.capitals[0], ...pool.datum.tranches[0] },
  usdc: { capital: pool.capitals[1], ...pool.datum.tranches[1] },
  unit: unitOf(USDC),
});
console.log("emulator run passed");
