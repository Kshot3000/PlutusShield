/**
 * Run the website's LP transaction builder (apps/web/src/lib/tx/lp.ts) against
 * Preview with the local deployer key. Same code the /pool page runs with a
 * CIP-30 wallet; this proves it lands on-chain.
 *
 *   pnpm web-lp deposit <ada|usdc> <amount>     whole units
 *   pnpm web-lp withdraw <ada|usdc> <shares>    whole share units
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDeposit, buildWithdraw, poolScriptFrom } from "../../../../apps/web/src/lib/tx/lp.ts";
import { previewLucid, readDeploymentFile, writeDeploymentFile } from "../lib/chain.ts";
import { loadKey, DEPLOY_DIR } from "../lib/keys.ts";

const [cmd, which, amt] = process.argv.slice(2);
if (!["deposit", "withdraw"].includes(cmd) || !["ada", "usdc"].includes(which) || !amt) {
  console.error("usage: pnpm web-lp <deposit|withdraw> <ada|usdc> <amount>");
  process.exit(1);
}
const art = JSON.parse(readFileSync(join(DEPLOY_DIR, "..", "..", "..", "apps", "web", "src", "data", "preview-deployment.json"), "utf8"));
const p = poolScriptFrom(art);
const tranche = which === "ada" ? 0 : 1;
const units = BigInt(Math.round(Number(amt) * 1e6));
const lucid = await previewLucid();
lucid.selectWallet.fromPrivateKey(loadKey("deployer", "Preview").privateKey);

const built = cmd === "deposit" ? await buildDeposit(lucid, p, tranche, units) : await buildWithdraw(lucid, p, tranche, units);
const signed = await built.tx.sign.withWallet().complete();
const hash = await signed.submit();
console.log(`${cmd} ${amt} ${which}: ${hash}`);
// Lucid's Koios awaitTx chokes on Koios' collateral_output shape, so poll tx_status directly.
const koios = process.env.KOIOS_URL ?? "https://preview.koios.rest/api/v1";
for (let i = 0; ; i++) {
  const r = await fetch(`${koios}/tx_status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ _tx_hashes: [hash] }) });
  const [s] = (await r.json()) as { num_confirmations: number | null }[];
  if (s?.num_confirmations) break;
  if (i > 60) throw new Error(`${hash} not confirmed after 5 minutes`);
  await new Promise((res) => setTimeout(res, 5000));
}
console.log("confirmed", { before: built.before, after: built.after });
const file = readDeploymentFile();
const label = cmd === "deposit" ? `web-lp Deposit ${amt} ${which} (+${(built as { shares: bigint }).shares} lp${tranche})` : `web-lp Withdraw ${amt} ${which} shares`;
file.txs = { ...file.txs, [`${new Date().toISOString()} ${label}`]: hash };
writeDeploymentFile(file);
