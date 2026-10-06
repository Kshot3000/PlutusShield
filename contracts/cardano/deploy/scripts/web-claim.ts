/**
 * Run the website's claim builders (apps/web/src/lib/tx/claim.ts) against
 * Preview with the local deployer key: the same Settle and Expire the /cover
 * "My policies" panel signs with a CIP-30 wallet.
 *
 *   pnpm web-claim status              every live policy: claim check, release time
 *   pnpm web-claim settle <policyId>   file a claim (needs the claim token + a 2-of-3 depeg quorum)
 *   pnpm web-claim expire <policyId>   release an unclaimed policy after expiry + grace (anyone)
 *
 * It never publishes oracle readings: a claim pays only against depeg
 * attestations that are already on-chain.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LucidEvolution } from "@lucid-evolution/lucid";
import { readPoolState } from "../../../../packages/sdk/src/chain.ts";
import { chainUtxoOf, coverScriptFrom, feedOfUtxo, policyStatus } from "../../../../apps/web/src/lib/tx/cover.ts";
import { buildExpire, buildSettle, claimCheck, releasableAt } from "../../../../apps/web/src/lib/tx/claim.ts";
import { previewLucid, readDeploymentFile, toJson, writeDeploymentFile } from "../lib/chain.ts";
import { DEPLOY_DIR, loadKey } from "../lib/keys.ts";

const [cmd = "status", policyId] = process.argv.slice(2);
const art = JSON.parse(readFileSync(join(DEPLOY_DIR, "..", "..", "..", "apps", "web", "src", "data", "preview-deployment.json"), "utf8"));
const c = coverScriptFrom(art);
const deployer = loadKey("deployer", "Preview");
const lucid: LucidEvolution = await previewLucid();
lucid.selectWallet.fromPrivateKey(deployer.privateKey);

const koios = process.env.KOIOS_URL ?? "https://preview.koios.rest/api/v1";
async function confirm(hash: string) {
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
const feedUtxos = async () => (c.oracleAddress ? lucid.utxosAt(c.oracleAddress) : []);
const iso = (ms: number | bigint) => new Date(Number(ms)).toISOString();

switch (cmd) {
  case "status": {
    const now = Date.now();
    const [atScript, feeds] = await Promise.all([lucid.utxosAt(c.address), feedUtxos()]);
    const state = readPoolState(atScript.map(chainUtxoOf), c.scriptHash, c.assets, c.maxUtilizationBps);
    const fs = feeds.map((u) => feedOfUtxo(u, c.params.oracle.policyId));
    console.log(
      toJson(
        state.policies.map((p) => {
          const k = claimCheck(c, p.policy, fs, now);
          return {
            policyId: p.policy.policyId,
            tranche: p.tranche,
            coverage: p.policy.coverage,
            status: policyStatus(p.policy, BigInt(now), c.params.claimGraceMs),
            expiry: iso(p.policy.expiry),
            claim: k.ok ? `payable (feeds ${k.feeds.join(", ")})` : k.blockers.map((b) => b.code).join(", "),
            attesting: k.feeds,
            releasableFrom: iso(releasableAt(c, p.policy)),
          };
        }),
      ),
    );
    console.log(`${state.policies.length} live policies; ${feeds.length} oracle UTxOs read`);
    break;
  }
  case "settle": {
    if (!policyId) throw new Error("usage: pnpm web-claim settle <policyId>");
    const r = await buildSettle(lucid, c, { policyId, feeds: await feedUtxos(), now: Date.now() });
    const hash = await (await r.tx.sign.withWallet().complete()).submit();
    console.log(`Settle ${policyId.slice(0, 12)} (payout ${r.payout}, feeds ${r.feeds.join(",")}): ${hash}; waiting…`);
    await confirm(hash);
    record(`web-claim Settle ${policyId.slice(0, 12)} payout ${r.payout}`, hash);
    console.log("confirmed");
    break;
  }
  case "expire": {
    if (!policyId) throw new Error("usage: pnpm web-claim expire <policyId>");
    const r = await buildExpire(lucid, c, { policyId, now: Date.now() });
    const hash = await (await r.tx.sign.withWallet().complete()).submit();
    console.log(`Expire ${policyId.slice(0, 12)} (refund ${r.refund} to ${r.refundTo}): ${hash}; waiting…`);
    await confirm(hash);
    record(`web-claim Expire ${policyId.slice(0, 12)} refund ${r.refund}`, hash);
    console.log("confirmed");
    break;
  }
  default:
    console.log("usage: pnpm web-claim <status|settle|expire> …");
}
