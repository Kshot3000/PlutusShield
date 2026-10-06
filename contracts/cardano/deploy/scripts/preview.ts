/**
 * Live Preview commands (step 2 and 4+ of the runbook). Signs with .keys/.
 *
 *   pnpm preview status
 *   pnpm preview mint-usdc [amount=1000000]           mock tUSDCx to the deployer
 *   pnpm preview init                                  InitPool with the planned seed
 *   pnpm preview deposit <ada|usdc> <amount>           whole units
 *   pnpm preview withdraw <ada|usdc> <shares>          whole share units
 *   pnpm preview peg [priceBps=10000] [feeds=all]      test oracle: fresh healthy-peg readings from every feed (needed before buy)
 *   pnpm preview buy <ada|usdc> <coverage> <days>      premium = validator floor; refund address = deployer
 *   pnpm preview feeds <priceBps> <startMs> <endMs> [feed-a,feed-b]
 *   pnpm preview settle <policyId>
 *   pnpm preview expire <policyId>
 */
import { randomBytes } from "node:crypto";
import { ADA, DAY_MS, textHex, type AssetClass } from "../../../../packages/sdk/src/cardano.ts";
import { deployment, loadConfig, unitOf } from "../lib/cover.ts";
import { loadKey, sigPolicy } from "../lib/keys.ts";
import { previewLucid, readDeploymentFile, reviveParams, toJson, writeDeploymentFile } from "../lib/chain.ts";
import * as act from "../lib/actions.ts";
import type { TxSignBuilder } from "@lucid-evolution/lucid";

const [cmd, ...args] = process.argv.slice(2);
const U = 1_000_000n;
const cfg = loadConfig();
const file = readDeploymentFile();
const deployer = loadKey("deployer", "Preview");
const oracle = loadKey("oracle", "Preview");
const usdcPolicy = sigPolicy(deployer.keyHash);
const oraclePolicy = sigPolicy(oracle.keyHash);
const lucid = await previewLucid();
lucid.selectWallet.fromPrivateKey(deployer.privateKey);

const needPlan = () => {
  if (!file.params || file.status === "awaiting-funding") throw new Error("not planned yet: fund the deployer, then `pnpm plan`");
  return deployment("Preview", reviveParams(file.params));
};
const assetArg = (s: string): AssetClass =>
  s === "ada" ? ADA : s === "usdc" ? { policyId: usdcPolicy.policyId, assetName: file.mockUsdc.assetName } : (() => { throw new Error("asset must be ada|usdc"); })();

// Feed UTxOs live at the oracle key's address, never in the deployer wallet,
// so coin selection can't merge or spend them by accident.
const oracleFeeds = async () =>
  (await lucid.utxosAt(oracle.address)).filter((u) => Object.keys(u.assets).some((k) => k.startsWith(oraclePolicy.policyId)));

async function submit(label: string, tx: TxSignBuilder, ...extra: string[]) {
  let s = tx.sign.withWallet();
  for (const k of extra) s = s.sign.withPrivateKey(k);
  const hash = await (await s.complete()).submit();
  console.log(`${label}: submitted ${hash}; waiting for confirmation…`);
  await lucid.awaitTx(hash);
  console.log(`confirmed https://preview.cexplorer.io/tx/${hash}`);
  file.txs = { ...(file.txs ?? {}), [`${new Date().toISOString()} ${label}`]: hash };
  writeDeploymentFile(file);
  return hash;
}

switch (cmd) {
  case "status": {
    const utxos = await lucid.wallet().getUtxos();
    const total: Record<string, bigint> = {};
    for (const u of utxos) for (const [k, v] of Object.entries(u.assets)) total[k] = (total[k] ?? 0n) + v;
    console.log(toJson({ status: file.status, deployer: deployer.address, utxos: utxos.length, balance: total }));
    if (file.params && file.status !== "awaiting-funding") {
      const d = needPlan();
      try {
        const pool = await act.readPool(lucid, d);
        console.log(toJson({ pool: d.address, capitals: pool.capitals, tranches: pool.datum.tranches }));
      } catch (e) {
        console.log(`pool: ${(e as Error).message}`);
      }
    }
    if (!utxos.length) console.log(`\nFund ${deployer.address} at https://docs.cardano.org/cardano-testnets/tools/faucet (Preview).`);
    break;
  }
  case "mint-usdc": {
    const amount = BigInt(args[0] ?? "1000000") * U;
    await submit("mint tUSDCx", await act.mintMockUsdc(lucid, usdcPolicy, amount, deployer.address));
    break;
  }
  case "init": {
    const d = needPlan();
    if (file.status === "initialised") throw new Error("already initialised");
    await submit("InitPool", await act.initPool(lucid, d, BigInt(cfg.poolMinLovelace)));
    file.status = "initialised";
    writeDeploymentFile(file);
    break;
  }
  case "deposit": {
    const r = await act.deposit(lucid, needPlan(), assetArg(args[0]), BigInt(args[1]) * U);
    await submit(`Deposit ${args[1]} ${args[0]} (+${r.shares} lp${r.tranche})`, r.tx);
    break;
  }
  case "withdraw": {
    const r = await act.withdraw(lucid, needPlan(), assetArg(args[0]), BigInt(args[1]) * U);
    await submit(`Withdraw ${args[1]} ${args[0]} shares (-> ${r.payout})`, r.tx);
    break;
  }
  case "buy": {
    const asset = assetArg(args[0]);
    // Placeholder Midnight commitment until the Midnight registration step is wired in.
    const r = await act.buy(lucid, needPlan(), {
      asset,
      coverage: BigInt(args[1]) * U,
      days: BigInt(args[2] ?? "14"),
      midnightCommitment: randomBytes(32).toString("hex"),
      now: Date.now(),
      feeds: await oracleFeeds(),
    });
    console.log(toJson({ policyId: r.policy.policyId, premium: r.premium, asset: unitOf(asset), start: r.policy.start, expiry: r.policy.expiry }));
    await submit(`Buy ${args[1]} ${args[0]} cover`, r.tx);
    break;
  }
  case "peg": {
    // Buy needs a fresh healthy reading from EVERY allowlisted feed.
    const [price = "10000", names = cfg.oracle.feeds.join(",")] = args;
    const now = BigInt(Date.now());
    const feeds = names.split(",").map((name) => ({
      name,
      datum: { coveredAsset: textHex(cfg.product.coveredAsset), priceBps: BigInt(price), windowStart: now - DAY_MS, windowEnd: now },
    }));
    await submit(`oracle peg ${price}bps ${names}`, await act.publishFeeds(lucid, { ...oraclePolicy, keyHash: oracle.keyHash }, oracle.address, feeds), oracle.privateKey);
    console.log(`fresh for ${cfg.saleGuard.maxPriceAgeMinutes} min: run \`pnpm preview buy …\` now`);
    break;
  }
  case "feeds": {
    const [price, start, end, names = "feed-a,feed-b"] = args;
    const feeds = names.split(",").map((name) => ({
      name,
      datum: { coveredAsset: textHex(cfg.product.coveredAsset), priceBps: BigInt(price), windowStart: BigInt(start), windowEnd: BigInt(end) },
    }));
    await submit(`oracle feeds ${names}`, await act.publishFeeds(lucid, { ...oraclePolicy, keyHash: oracle.keyHash }, oracle.address, feeds), oracle.privateKey);
    break;
  }
  case "settle": {
    const d = needPlan();
    const r = await act.settle(lucid, d, args[0], await oracleFeeds(), Date.now());
    await submit(`Settle ${args[0].slice(0, 12)}`, r.tx);
    break;
  }
  case "expire": {
    const r = await act.expire(lucid, needPlan(), args[0], Date.now());
    console.log(`refunding ${r.refund} lovelace deposit to ${r.refundTo}`);
    await submit(`Expire ${args[0].slice(0, 12)}`, r.tx);
    break;
  }
  default:
    console.log("usage: pnpm preview <status|mint-usdc|init|deposit|withdraw|peg|buy|feeds|settle|expire> …");
}
