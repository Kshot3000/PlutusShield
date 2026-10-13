#!/usr/bin/env node
/**
 * PlutusShield bridge submit drill — a bridge-proven tx, balanced and submitted
 * by a wallet, finalized on Midnight Preprod.
 *
 * File with Lace on /claim/evidence is: the holder prove bridge proves the
 * Compact call and returns an unsealed tx; Lace's balanceUnsealedTransaction
 * adds the DUST fee and binds it; Lace's submitTransaction sends it. This drill
 * runs that exact wire path with a headless WalletFacade standing in for Lace:
 *
 *   1. spawn prove-bridge.mjs on a side port, wait for GET /health
 *   2. POST /prove { circuit: proveCover, … } with a browser Origin header and
 *      the wallet's shielded coin/encryption keys (what Lace getShieldedAddresses
 *      gives) once as a fail-fast preflight
 *   3. sync the wallet (seed from env, never printed; waitForSynced may BYPASS once
 *      tDUST balance is already > 0 or dust stalls with highestRelevantIndex=0 — see
 *      Midnight agent wallet-facade waitForSynced), then prove again
 *   4. deserialize the returned unsealed tx (signature, proof, pre-binding)
 *   5. balanceUnboundTransaction + finalizeRecipe   (= Lace balanceUnsealedTransaction)
 *   6. submitTransaction                             (= Lace submitTransaction)
 *   7. watchForTxData: success only on a finalized SucceedEntirely tx
 *
 * proveCover changes no claim state, so the drill is safe to repeat. Public
 * results only go to PLUTUSSHIELD_DRILL_RECORD (no keys, seeds, holder secrets).
 *
 *   node bridge-submit-drill.mjs --key <policy-key.json> [--dry-run]
 * --dry-run stops after step 5 (balanced, not submitted).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { Transaction } from '@midnight-ntwrk/ledger-v8';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = (k, d) => process.env[k] ?? d;
const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const DRY = process.argv.includes('--dry-run');
const KEY_FILE = arg('--key');
if (!KEY_FILE) throw new Error('--key <policy-key.json> is required');
const FACADE = env('MIDNIGHT_WALLET_FACADE', '');
if (!FACADE) throw new Error('MIDNIGHT_WALLET_FACADE is required');
const RECORD = env('PLUTUSSHIELD_DRILL_RECORD', '');
const PORT = Number(env('PLUTUSSHIELD_DRILL_BRIDGE_PORT', '6311'));
const ORIGIN = 'http://localhost:3000';
const CONTRACT = env('MIDNIGHT_POLICY_COVER_ADDRESS', '5430b803b6b3df6e6ee1d498bb02e2f2d06cb46661e72af1e6208d864feb8110');

const redact = (s) => String(s).replace(/(project_id=)[^&\s"]+/g, '$1…').replace(/nightpreprod[A-Za-z0-9]+/g, 'nightpreprod…');
const log = (...a) => console.log(new Date().toISOString(), '[bridge-drill]', ...a.map(redact));
const hex = (u) => Buffer.from(u).toString('hex');

async function startBridge() {
  const child = spawn(process.execPath, ['--no-warnings', path.join(here, 'prove-bridge.mjs')], {
    env: { ...process.env, PLUTUSSHIELD_BRIDGE_PORT: String(PORT), PLUTUSSHIELD_BRIDGE_ORIGINS: ORIGIN },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(redact(d)));
  child.stderr.on('data', (d) => process.stderr.write(redact(d)));
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`, { headers: { origin: ORIGIN } });
      if (r.ok) return { child, health: await r.json() };
    } catch {}
    if (child.exitCode != null) throw new Error(`bridge exited ${child.exitCode}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  child.kill();
  throw new Error('bridge /health never answered');
}

async function main() {
  if (process.env.MIDNIGHT_LOAD_ENV) (await import(pathToFileURL(process.env.MIDNIGHT_LOAD_ENV).href)).loadPreprodEnv();
  setNetworkId('preprod');
  const key = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  const W = await import(pathToFileURL(FACADE).href);
  log(`drill: proveCover ${key.policyId.slice(0, 16)}… via bridge :${PORT}, wallet in Lace's seat${DRY ? ' (dry run, no submit)' : ''}`);

  log('building wallet (seed from env, never printed)…');
  const ctx = await W.buildPreprodWalletFromEnv();
  let bridge;
  try {
    bridge = await startBridge();
    log(`bridge healthy: ${bridge.health.service} for ${String(bridge.health.contractAddress).slice(0, 16)}…`);
    // What the browser sends: Lace getShieldedAddresses keys + holder private state.
    const body = {
      circuit: 'proveCover',
      policyId: key.policyId,
      minCoverage: String(key.coverage),
      contractAddress: CONTRACT,
      privateState: { sk: key.holderSecret, openings: { [key.policyId]: { amount: String(key.coverage), salt: key.coverageSalt } } },
      coinPublicKey: String(ctx.shieldedSecretKeys.coinPublicKey),
      encryptionPublicKey: String(ctx.shieldedSecretKeys.encryptionPublicKey),
    };
    const prove = async (label) => {
      const r = await fetch(`http://127.0.0.1:${PORT}/prove`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(`${label}: bridge /prove ${r.status}: ${j.error}`);
      log(`${label}: bridge proved ${j.circuit}, unsealed tx ${j.bytes} bytes in ${j.provedMs} ms`);
      return j;
    };
    // Fail fast before the long sync: the circuit must accept this key today.
    await prove('preflight');

    await W.waitUntilConnected(ctx.wallet, { timeoutMs: 180_000 });
    await W.waitForNightBalance(ctx.wallet, ctx.unshieldedKeystore, { timeoutMs: 900_000 });
    log('syncing (Preprod dust sync can take ~1 h)…');
    const synced = await W.waitForSynced(ctx.wallet, { timeoutMs: 5_400_000 });
    log('synced; tNIGHT', W.formatNight(W.nightBalanceFromState(synced, ctx.unshieldedKeystore)), 'tDUST', W.formatDust(W.dustBalanceFromState(synced)));
    const dust = await W.ensureDustRegistered(ctx.wallet, ctx.unshieldedKeystore, { dustWaitTimeoutMs: 900_000 });
    if (dust.dustBalance <= 0n) throw new Error('tDUST is 0');

    // Re-prove against current ledger state right before balancing.
    const proved = await prove('submit');

    // Lace balanceUnsealedTransaction: deserialize, add the DUST fee, bind.
    const unsealed = Transaction.deserialize('signature', 'proof', 'pre-binding', Uint8Array.from(Buffer.from(proved.unsealedTx, 'hex')));
    const provider = W.makeWalletMidnightProvider(ctx.wallet, ctx.shieldedSecretKeys, ctx.dustSecretKey);
    const t0 = Date.now();
    const balanced = await provider.balanceTx(unsealed);
    const balancedBytes = balanced.serialize().length;
    log(`balanced + bound by the wallet: ${balancedBytes} bytes in ${Date.now() - t0} ms`);
    if (DRY) { log('dry run: not submitting'); return; }

    // Lace submitTransaction, then wait for finality.
    const txId = String(await provider.submitTx(balanced));
    log(`submitted txId ${txId}; waiting for finalized tx data…`);
    const bfq = `?project_id=${encodeURIComponent(env('BLOCKFROST_MIDNIGHT_PREPROD_ID', '').trim())}`;
    const pdp = indexerPublicDataProvider(
      env('MIDNIGHT_INDEXER_URL', '') || `https://midnight-preprod.blockfrost.io/api/v0${bfq}`,
      env('MIDNIGHT_INDEXER_WS_URL', '') || `wss://midnight-preprod.blockfrost.io/api/v0/ws${bfq}`,
    );
    const f = await pdp.watchForTxData(txId);
    if (f?.blockHeight == null) throw new Error('no blockHeight; not claiming success');
    if (f.status && f.status !== 'SucceedEntirely') throw new Error(`status ${f.status}`);
    const out = {
      drill: 'bridge-submit',
      network: 'preprod',
      contractAddress: CONTRACT,
      circuit: 'proveCover',
      policyId: key.policyId,
      minCoverage: String(key.coverage),
      prover: 'holder prove bridge (contracts/midnight/preprod/prove-bridge.mjs) over HTTP with a browser Origin',
      balancer: 'WalletFacade balanceUnboundTransaction + finalizeRecipe (stand-in for Lace balanceUnsealedTransaction)',
      unsealedBytes: proved.bytes,
      provedMs: proved.provedMs,
      balancedBytes,
      txId,
      txHash: f.txHash ? String(f.txHash) : null,
      blockHeight: f.blockHeight,
      blockHash: f.blockHash ? String(f.blockHash) : null,
      status: f.status ?? null,
      at: new Date().toISOString(),
      _note: 'Public Midnight Preprod data only. No keys, seeds or holder secrets.',
    };
    log(`FINALIZED ${out.status} tx ${txId} hash ${out.txHash} block ${out.blockHeight}`);
    if (RECORD) {
      const prev = fs.existsSync(RECORD) ? JSON.parse(fs.readFileSync(RECORD, 'utf8')) : { runs: [] };
      prev.runs = [...(prev.runs ?? []), out];
      prev.latest = out;
      fs.writeFileSync(RECORD, JSON.stringify(prev, null, 2) + '\n');
      log(`public record -> ${RECORD}`);
    }
    console.log(JSON.stringify({ ok: true, ...out }));
  } finally {
    bridge?.child.kill();
    await ctx.wallet.stop?.().catch?.(() => {});
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('[bridge-drill]', redact(e?.stack ?? e?.message ?? e));
  process.exit(1);
});
