/**
 * Preview oracle publisher: keeps the sale circuit-breaker fed with REAL USDM
 * market data instead of a hand-typed peg.
 *
 *   pnpm oracle                one cycle: read live venues, publish if the on-chain readings expire soon
 *   pnpm oracle --dry-run      read venues and decide, sign nothing
 *   pnpm oracle --force        publish even if the current readings are still fresh
 *   pnpm oracle --loop [--every=20] [--margin=50]   run forever, a cycle every N minutes
 *
 * Each cycle pulls CoinGecko (optional COINGECKO_DEMO_API_KEY), Minswap ADA/USDM
 * on-chain x Kraken ADA/USD, and Minswap USDCx/USDM on-chain (services/oracle-relay/src/venues.ts), takes the cross-venue
 * median, and computes the 24h TWAP with the same SDK math the validator
 * mirrors. Then:
 *
 *   healthy (TWAP >= trigger threshold)  publish it to every allowlisted feed,
 *                                        recycling stale healthy-peg UTxOs
 *   unhealthy                            publish nothing; sales pause on their own
 *                                        once the last readings age out (fail closed)
 *   too few venues                       publish nothing (needs --min-venues, default 2)
 *
 * Preview runs one operator for all three feeds, signed by .keys/oracle.sk.
 * On mainnet every feed is an independent operator running this relay, which
 * is what makes the validator's every-feed sale check and 2-of-3 claim quorum
 * meaningful. Depeg attestations are reported but never auto-published here.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { UTxO } from "@lucid-evolution/lucid";
import { textHex } from "../../../../packages/sdk/src/cardano.ts";
import { evaluate } from "../../../../services/oracle-relay/src/relay.ts";
import { liveInput } from "../../../../services/oracle-relay/src/venues.ts";
import { loadConfig } from "../lib/cover.ts";
import { loadKey, sigPolicy } from "../lib/keys.ts";
import { previewLucid, readDeploymentFile, writeDeploymentFile } from "../lib/chain.ts";
import { DEPLOY_DIR } from "../lib/keys.ts";
import * as act from "../lib/actions.ts";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string, d: number) => Number(argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d);
const DRY = flag("dry-run");
const EVERY_MIN = opt("every", 20);
const MARGIN_MIN = opt("margin", 50);
const MIN_VENUES = opt("min-venues", 2);
const MAX_RECYCLE = 12;
const STATUS_FILE = join(DEPLOY_DIR, "deployments", "oracle-status.json");
const LOG_FILE = process.env.PLUTUSSHIELD_ORACLE_LOG;

const cfg = loadConfig();
const deployer = loadKey("deployer", "Preview");
const oracle = loadKey("oracle", "Preview");
const oraclePolicy = sigPolicy(oracle.keyHash);
const threshold = 9500n;
const maxAgeMs = BigInt(cfg.saleGuard.maxPriceAgeMinutes) * 60_000n;
const covered = textHex(cfg.product.coveredAsset);

const log = (msg: string) => {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  if (LOG_FILE) appendFileSync(LOG_FILE, line + "\n");
};

type Feed = { utxo: UTxO; name: string; priceBps: bigint; windowEnd: bigint };
const feedsOf = (utxos: UTxO[]): Feed[] =>
  utxos.flatMap((u) => {
    const unit = Object.keys(u.assets).find((k) => k.startsWith(oraclePolicy.policyId));
    const d = act.readOracleDatum(u);
    if (!unit || !d || d.coveredAsset.toLowerCase() !== covered.toLowerCase()) return [];
    const name = Buffer.from(unit.slice(56), "hex").toString("utf8");
    return [{ utxo: u, name, priceBps: d.priceBps, windowEnd: d.windowEnd }];
  });

async function cycle() {
  const now = Date.now();
  const snap = await liveInput({ now, maxPriceAgeMs: Number(maxAgeMs) });
  const ok = snap.venues.filter((v) => v.ok);
  for (const v of snap.venues) log(`venue ${v.name}: ${v.ok ? `${v.samples} samples, last ${(v.lastBps! / 100).toFixed(2)}%` : `FAILED ${v.error}`}`);
  const status: Record<string, unknown> = { at: new Date(now).toISOString(), venues: snap.venues };
  const finish = (decision: string, extra: Record<string, unknown> = {}) => {
    log(`decision: ${decision}`);
    writeFileSync(STATUS_FILE, JSON.stringify({ ...status, decision, ...extra }, null, 2) + "\n");
  };
  if (ok.length < MIN_VENUES) return finish(`skip: only ${ok.length}/${snap.venues.length} venues answered (need ${MIN_VENUES})`);

  const report = evaluate(snap.input);
  for (const n of report.notes) log(`relay: ${n}`);
  status.report = { peg: report.peg, depeg: report.depeg };
  if (report.depeg) log(`DEPEG ATTESTABLE: ${report.depeg.cborHex} (not auto-published; review, then \`pnpm preview feeds\`)`);
  if (!report.peg) return finish("skip: no complete 24h reading (data gap); sales pause when current readings age out");
  if (!report.peg.healthy) return finish(`skip: peg ${report.peg.datum.priceBps} bps is below ${threshold}; circuit-breaker should pause sales`);

  const lucid = await previewLucid();
  lucid.selectWallet.fromPrivateKey(deployer.privateKey);
  const onChain = feedsOf(await lucid.utxosAt(oracle.address));
  const freshest = new Map<string, bigint>();
  for (const f of onChain) if (f.priceBps >= threshold && f.windowEnd > (freshest.get(f.name) ?? 0n)) freshest.set(f.name, f.windowEnd);
  const expiresIn = (name: string) => Number((freshest.get(name) ?? 0n) + maxAgeMs - BigInt(now)) / 60_000;
  const soonest = Math.min(...cfg.oracle.feeds.map(expiresIn));
  status.onChain = Object.fromEntries(cfg.oracle.feeds.map((n) => [n, { freshForMin: Math.round(expiresIn(n)) }]));
  if (soonest > MARGIN_MIN && !flag("force"))
    return finish(`hold: on-chain readings stay fresh for ${Math.round(soonest)} more min (refresh at < ${MARGIN_MIN})`);

  // Recycle only healthy-peg readings that no Buy can use any more; depeg attestations are untouchable.
  const recycle = onChain
    .filter((f) => f.priceBps >= threshold && f.windowEnd + maxAgeMs < BigInt(now))
    .sort((a, b) => (a.windowEnd < b.windowEnd ? -1 : 1))
    .slice(0, MAX_RECYCLE)
    .map((f) => f.utxo);
  const d = report.peg.datum;
  const datum = { coveredAsset: d.coveredAsset, priceBps: BigInt(d.priceBps), windowStart: BigInt(d.windowStart), windowEnd: BigInt(d.windowEnd) };
  if (DRY) return finish(`dry-run: would publish ${d.priceBps} bps to ${cfg.oracle.feeds.join(",")}, recycling ${recycle.length} stale UTxOs`);

  const tx = await act.refreshFeeds(lucid, { ...oraclePolicy, keyHash: oracle.keyHash }, oracle.address,
    cfg.oracle.feeds.map((name) => ({ name, datum })), recycle);
  const hash = await (await tx.sign.withWallet().sign.withPrivateKey(oracle.privateKey).complete()).submit();
  log(`published ${d.priceBps} bps (24h TWAP, ${ok.length} venues) to ${cfg.oracle.feeds.join(",")}; recycled ${recycle.length}: https://preview.cexplorer.io/tx/${hash}`);
  // Koios Preview sometimes returns a datum shape Lucid rejects after the tx is on chain; that is not a failure.
  await lucid.awaitTx(hash).catch((e) => log(`awaitTx: ${String((e as Error).message).split("\n")[0].slice(0, 120)} (tx was submitted)`));
  const file = readDeploymentFile();
  file.txs = { ...(file.txs ?? {}), [`${new Date().toISOString()} oracle live peg ${d.priceBps}bps`]: hash };
  writeDeploymentFile(file);
  finish(`published ${d.priceBps} bps`, { tx: hash });
}

if (flag("loop")) {
  log(`oracle publisher loop: every ${EVERY_MIN} min, refresh when < ${MARGIN_MIN} min of freshness remain`);
  for (;;) {
    await cycle().catch((e) => log(`cycle failed: ${(e as Error).stack ?? e}`));
    await new Promise((r) => setTimeout(r, EVERY_MIN * 60_000));
  }
} else {
  await cycle();
}
