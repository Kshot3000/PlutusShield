/**
 * Run the website's cover builder (apps/web/src/lib/tx/cover.ts) against
 * Preview with the local deployer key: the same Buy the /cover page signs
 * with a CIP-30 wallet, so this proves the shipped code lands on-chain.
 *
 *   pnpm web-buy buy <ada|usdc> <coverage> [days=14]   whole units; premium = validator floor
 *   pnpm web-buy policies                              this wallet's policies (the /cover "My policies" view)
 *   pnpm web-buy oracle                                sale circuit-breaker status of every feed
 *
 * If the oracle readings are too old for a sale, `buy` first publishes fresh
 * healthy-peg readings with the Preview test-oracle key (the operator's job;
 * the website can't do it). It never papers over a feed that reports a depeg.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LucidEvolution } from "@lucid-evolution/lucid";
import { DAY_MS, textHex } from "../../../../packages/sdk/src/cardano.ts";
import {
  BUY_WINDOW_MS,
  buildBuy,
  coverScriptFrom,
  listWalletPolicies,
  placeholderCommitment,
  saleCheck,
  feedOfUtxo,
} from "../../../../apps/web/src/lib/tx/cover.ts";
import { publishFeeds } from "../lib/actions.ts";
import { loadConfig } from "../lib/cover.ts";
import { previewLucid, readDeploymentFile, toJson, writeDeploymentFile } from "../lib/chain.ts";
import { DEPLOY_DIR, loadKey, sigPolicy } from "../lib/keys.ts";

const [cmd = "policies", which, amt, daysArg = "14"] = process.argv.slice(2);
const art = JSON.parse(readFileSync(join(DEPLOY_DIR, "..", "..", "..", "apps", "web", "src", "data", "preview-deployment.json"), "utf8"));
const c = coverScriptFrom(art);
const deployer = loadKey("deployer", "Preview");
const lucid: LucidEvolution = await previewLucid();
lucid.selectWallet.fromPrivateKey(deployer.privateKey);

const koios = process.env.KOIOS_URL ?? "https://preview.koios.rest/api/v1";
async function confirm(hash: string) {
  // Lucid's Koios awaitTx chokes on Koios' collateral_output shape, so poll tx_status directly.
  for (let i = 0; ; i++) {
    const r = await fetch(`${koios}/tx_status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ _tx_hashes: [hash] }) });
    const [s] = (await r.json()) as { num_confirmations: number | null }[];
    if (s?.num_confirmations) return;
    if (i > 72) throw new Error(`${hash} not confirmed after 6 minutes`);
    await new Promise((res) => setTimeout(res, 5000));
  }
}
function record(label: string, hash: string) {
  const file = readDeploymentFile();
  file.txs = { ...file.txs, [`${new Date().toISOString()} ${label}`]: hash };
  writeDeploymentFile(file);
}

const feedUtxos = async () => {
  if (!c.oracleAddress) throw new Error("artifact has no oracle address; run `pnpm web-artifacts`");
  return lucid.utxosAt(c.oracleAddress);
};
const check = async (at = Date.now()) => saleCheck(c.params, (await feedUtxos()).map((u) => feedOfUtxo(u, c.params.oracle.policyId)), at + BUY_WINDOW_MS);
const show = (s: Awaited<ReturnType<typeof check>>) =>
  s.feeds.map((f) => `${f.feed}: ${f.state}${"reading" in f ? ` (${f.reading.priceBps} bps, window end ${new Date(Number(f.reading.windowEnd)).toISOString()})` : ""}`).join("\n");

switch (cmd) {
  case "oracle": {
    const s = await check();
    console.log(show(s));
    console.log(s.ok ? `sale open; readings fresh until ${new Date(s.freshUntil!).toISOString()}` : `sale blocked by ${s.blocked.join(", ")}`);
    break;
  }
  case "policies": {
    const mine = await listWalletPolicies(lucid, c);
    console.log(toJson(mine.map((p) => ({ ref: p.ref, status: p.status, holder: p.holder, buyer: p.buyer, tranche: p.tranche, coverage: p.policy.coverage, premium: p.policy.premium, start: new Date(Number(p.policy.start)).toISOString(), expiry: new Date(Number(p.policy.expiry)).toISOString(), policyId: p.policy.policyId }))));
    break;
  }
  case "buy": {
    if (!["ada", "usdc"].includes(which ?? "") || !amt) {
      console.error("usage: pnpm web-buy buy <ada|usdc> <coverage> [days]");
      process.exit(1);
    }
    let s = await check();
    if (!s.ok) {
      console.log(show(s));
      if (s.feeds.some((f) => f.state === "depeg")) throw new Error(`a feed reports a depeg (${s.blocked.join(", ")}); sales stay closed`);
      // Stale or missing readings: publish fresh healthy-peg readings as the Preview test oracle.
      const oracle = loadKey("oracle", "Preview");
      if (oracle.address !== c.oracleAddress) throw new Error("oracle key doesn't match the artifact's oracle address");
      const cfg = loadConfig();
      const now = BigInt(Date.now());
      const feeds = cfg.oracle.feeds.map((name) => ({ name, datum: { coveredAsset: textHex(cfg.product.coveredAsset), priceBps: 10_000n, windowStart: now - DAY_MS, windowEnd: now } }));
      const tx = await publishFeeds(lucid, { ...sigPolicy(oracle.keyHash), keyHash: oracle.keyHash }, oracle.address, feeds);
      const hash = await (await tx.sign.withWallet().sign.withPrivateKey(oracle.privateKey).complete()).submit();
      console.log(`oracle peg 10000bps ${cfg.oracle.feeds.join(",")}: ${hash}; waiting…`);
      await confirm(hash);
      record(`oracle peg 10000bps ${cfg.oracle.feeds.join(",")} (web-buy refresh)`, hash);
      s = await check();
      if (!s.ok) throw new Error(`still blocked after publishing: ${s.blocked.join(", ")}`);
    }
    const tranche = which === "ada" ? 0 : 1;
    const coverage = BigInt(Math.round(Number(amt) * 1e6));
    const built = await buildBuy(lucid, c, {
      tranche,
      coverage,
      days: BigInt(daysArg),
      // Placeholder until Midnight registration is wired into the Buy flow.
      midnightCommitment: placeholderCommitment(),
      now: Date.now(),
      feeds: s.use.map((f) => f.utxo),
    });
    console.log(toJson({ policyId: built.policy.policyId, tranche, premium: built.premium, start: new Date(Number(built.policy.start)).toISOString(), expiry: new Date(Number(built.policy.expiry)).toISOString() }));
    const hash = await (await built.tx.sign.withWallet().complete()).submit();
    console.log(`Buy ${amt} ${which} cover (${daysArg}d): ${hash}; waiting…`);
    await confirm(hash);
    console.log("confirmed", { before: built.before, after: built.after });
    record(`web-buy Buy ${amt} ${which} cover ${daysArg}d (website builder, premium ${built.premium})`, hash);
    break;
  }
  default:
    console.log("usage: pnpm web-buy <buy|policies|oracle> …");
}
