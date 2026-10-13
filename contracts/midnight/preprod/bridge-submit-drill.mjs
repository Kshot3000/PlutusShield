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
import { Transaction, CostModel } from '@midnight-ntwrk/ledger-v8';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';

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

/** Walk Error / Effect TaggedError cause chains without printing seeds or keys. */
function dumpErr(e) {
  const rows = [];
  const seen = new Set();
  let cur = e;
  for (let depth = 0; cur && depth < 10; depth++) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const row = {
      depth,
      tag: cur._tag ?? cur.name ?? typeof cur,
      message: redact(cur.message ?? String(cur)),
    };
    if (cur.status != null) row.status = cur.status;
    if (cur.code != null) row.code = cur.code;
    // Non-secret own props (skip huge buffers / nested objects we already walk)
    try {
      for (const k of Object.getOwnPropertyNames(cur)) {
        if (['message', 'stack', 'cause', 'error', 'name', '_tag'].includes(k)) continue;
        const v = cur[k];
        if (v == null) continue;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          row[k] = typeof v === 'string' ? redact(v).slice(0, 300) : v;
        } else if (v instanceof Error) {
          row[k] = redact(v.message);
        } else if (typeof v === 'object' && v.message) {
          row[k] = redact(String(v.message)).slice(0, 300);
        }
      }
    } catch {}
    rows.push(row);
    cur = cur.cause ?? cur.error ?? cur.originalError ?? null;
  }
  return rows;
}

function previewTx(tx, label) {
  try {
    const s = typeof tx?.toString === 'function' ? tx.toString(true) : String(tx);
    log(`${label}: ${redact(s).slice(0, 600)}`);
  } catch (e) {
    log(`${label}: (toString failed: ${redact(e?.message ?? e)})`);
  }
  try {
    const ids = typeof tx?.identifiers === 'function' ? tx.identifiers() : [];
    log(`${label} ids: ${(ids ?? []).slice(0, 4).map(String).join(', ') || '(none)'}`);
  } catch {}
}

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
    // Partition markers match Lace's UnboundTransaction =
    // Transaction<SignatureEnabled, Proof, PreBinding> (dapp-connector-api).
    const raw = Uint8Array.from(Buffer.from(proved.unsealedTx, 'hex'));
    log(`unsealed raw ${raw.length} bytes; ascii tag ${JSON.stringify(Buffer.from(raw.slice(0, 24)).toString('utf8'))}`);
    const unsealed = Transaction.deserialize('signature', 'proof', 'pre-binding', raw);
    previewTx(unsealed, 'unsealed (deserialized)');
    // Round-trip check: serialize must stay Proof+PreBinding sized.
    try {
      const round = unsealed.serialize();
      log(`unsealed round-trip serialize ${round.length} bytes (bridge sent ${proved.bytes})`);
    } catch (e) {
      log(`unsealed serialize failed: ${redact(e?.message ?? e)}`);
    }

    const proofServer = process.env.MIDNIGHT_PROOF_SERVER_URL || process.env.MIDNIGHT_PROOF_SERVER || 'http://127.0.0.1:6300';
    log(`wallet proving server (fee ZK): ${proofServer}`);
    try {
      const h = await fetch(`${proofServer.replace(/\/$/, '')}/health`);
      log(`proof server /health: ${h.status} ${redact((await h.text()).slice(0, 120))}`);
    } catch (e) {
      log(`proof server /health failed: ${redact(e?.message ?? e)}`);
    }

    const provider = W.makeWalletMidnightProvider(ctx.wallet, ctx.shieldedSecretKeys, ctx.dustSecretKey);
    const t0 = Date.now();
    let balanced;
    try {
      // Step through the same calls makeWalletMidnightProvider.balanceTx makes so a
      // Wallet.Proving failure dumps the real cause (not just the tag).
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        unsealed,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: ttlOneHour() },
      );
      log(`recipe type=${recipe.type} hasBalancing=${!!recipe.balancingTransaction}`);
      if (recipe.balancingTransaction) previewTx(recipe.balancingTransaction, 'balancing (unproven fee)');
      if (recipe.baseTransaction) previewTx(recipe.baseTransaction, 'base (bound candidate)');
      balanced = await ctx.wallet.finalizeRecipe(recipe);
    } catch (e) {
      const chain = dumpErr(e);
      console.error('[bridge-drill] balance/finalize failed; cause chain:');
      console.error(JSON.stringify(chain, null, 2));
      // One recovery probe: dust-only balancing (skip shielded/unshielded). Soft — if it
      // also fails we still throw the original error with its dump above.
      try {
        log('retry: balanceUnboundTransaction with tokenKindsToBalance=[dust] only…');
        const recipe2 = await ctx.wallet.balanceUnboundTransaction(
          unsealed,
          { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
          { ttl: ttlOneHour(), tokenKindsToBalance: ['dust'] },
        );
        log(`dust-only recipe type=${recipe2.type} hasBalancing=${!!recipe2.balancingTransaction}`);
        if (recipe2.balancingTransaction) previewTx(recipe2.balancingTransaction, 'dust-only balancing');
        balanced = await ctx.wallet.finalizeRecipe(recipe2);
        log('dust-only balance+finalize succeeded');
      } catch (e2) {
        console.error('[bridge-drill] dust-only retry also failed; cause chain:');
        console.error(JSON.stringify(dumpErr(e2), null, 2));
        // Last probe: does the balancing tx alone prove against the local proof server?
        try {
          const recipe3 = await ctx.wallet.balanceUnboundTransaction(
            unsealed,
            { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
            { ttl: ttlOneHour(), tokenKindsToBalance: ['dust'] },
          );
          if (recipe3.balancingTransaction) {
            const { HttpProverClient } = await import('@midnight-ntwrk/wallet-sdk-prover-client/effect');
            // Manual prove with logging — mirrors wallet provingService.
            const { Effect } = await import('effect');
            // Fall through: just try transaction.prove with http provider from midnight-js style
            const { httpClientProofProvider } = await import('@midnight-ntwrk/midnight-js-http-client-proof-provider');
            // No zk configs for dust — wallet Http path omits key material. Probe via ledger prove.
            log('probe: calling balancingTransaction.prove via CostModel.initialCostModel…');
            // Re-throw original; probe details from dump above are enough if prove throws again.
            try {
              await recipe3.balancingTransaction.prove(
                {
                  check: async () => { throw new Error('probe check not used'); },
                  prove: async (preimage, keyLocation, overwriteBindingInput) => {
                    log(`probe prove call keyLocation=${keyLocation} preimage=${preimage?.byteLength ?? preimage?.length} overwrite=${overwriteBindingInput ?? 'none'}`);
                    const ledger = await import('@midnight-ntwrk/ledger-v8');
                    const payload = ledger.createProvingPayload(preimage, overwriteBindingInput);
                    log(`probe createProvingPayload ok, payload=${payload?.byteLength ?? payload?.length}`);
                    const r = await fetch(`${proofServer.replace(/\/$/, '')}/prove`, {
                      method: 'POST',
                      headers: { 'content-type': 'application/octet-stream' },
                      body: payload,
                    });
                    const body = new Uint8Array(await r.arrayBuffer());
                    log(`probe /prove -> ${r.status} bytes=${body.byteLength}`);
                    if (!r.ok) throw new Error(`probe /prove ${r.status}`);
                    return body;
                  },
                },
                CostModel.initialCostModel(),
              );
              log('probe: balancingTransaction.prove succeeded (unexpected given finalize failure)');
            } catch (e3) {
              console.error('[bridge-drill] probe prove failed; cause chain:');
              console.error(JSON.stringify(dumpErr(e3), null, 2));
            }
          }
        } catch (eProbeSetup) {
          console.error('[bridge-drill] probe setup failed:', redact(eProbeSetup?.message ?? eProbeSetup));
        }
        throw e;
      }
    }
    const balancedBytes = balanced.serialize().length;
    log(`balanced + bound by the wallet: ${balancedBytes} bytes in ${Date.now() - t0} ms`);
    if (DRY) { log('dry run: not submitting'); return; }

    // Lace submitTransaction, then wait for finality.
    // Bounded: a submit that never returns must fail loudly, not hold the wallet lock.
    const SUBMIT_MS = Number(process.env.PLUTUSSHIELD_DRILL_SUBMIT_MS || 10 * 60_000);
    let balancedIds = [];
    try { balancedIds = (balanced.identifiers?.() ?? []).map(String); } catch {}
    log(`submitting; balanced tx ids ${balancedIds.slice(0, 4).join(', ') || '(none)'}; timeout ${Math.round(SUBMIT_MS / 1000)} s`);
    let submitTimer;
    const txId = String(await Promise.race([
      provider.submitTx(balanced),
      new Promise((_, reject) => {
        submitTimer = setTimeout(
          () => reject(new Error(`submitTransaction did not return within ${Math.round(SUBMIT_MS / 1000)} s; not claiming success (check the indexer for ${balancedIds[0] ?? 'the tx ids above'})`)),
          SUBMIT_MS,
        );
      }),
    ]).finally(() => clearTimeout(submitTimer)));
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
  try {
    console.error('[bridge-drill] cause chain:', JSON.stringify(dumpErr(e), null, 2));
  } catch {}
  process.exit(1);
});
