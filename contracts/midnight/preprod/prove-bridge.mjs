#!/usr/bin/env node
/**
 * PlutusShield holder prove bridge — the browser Compact prover for Lace.
 *
 * Lace (DApp Connector v4) balances and submits a proven, unsealed Midnight
 * transaction, but it does not build Compact calls: that needs midnight-js,
 * the compiled policy-cover-v2 contract, its witnesses and ~3 MB prover keys
 * per circuit, which a static Pages bundle should not ship. This bridge runs
 * on the holder's own machine (next to their proof server) and does exactly
 * that one step:
 *
 *   browser (/claim/evidence)              this bridge (127.0.0.1:6310)
 *   ─────────────────────────              ────────────────────────────
 *   prepareFileClaimCall / ProveCover  ──▶ POST /prove
 *     + Lace shielded coin/enc keys        createUnprovenCallTx (indexer state +
 *                                          holder private state as witnesses)
 *                                          proofProvider.proveTx (:6300)
 *   Lace balanceUnsealedTransaction   ◀──  { unsealedTx: hex }
 *   Lace submitTransaction
 *
 * The bridge holds no wallet, no seed and no funds; it never submits. The
 * holder private state (secret + coverage opening) arrives over loopback only
 * and is kept in memory for the single call. Requests from origins outside
 * PLUTUSSHIELD_BRIDGE_ORIGINS are refused.
 *
 *   GET  /health  -> { ok, contractAddress, circuits, proofServer, network }
 *   POST /prove   -> { circuit, policyId, evidenceCommitment? | minCoverage?,
 *                      contractAddress?, privateState, coinPublicKey,
 *                      encryptionPublicKey }
 *                 <- { ok, circuit, unsealedTx, bytes, provedMs }
 *
 * Runtime: same as policy-cover-preprod.mjs (midnight-js 4.1.1, ledger-v8,
 * proof server 8.1.0). Run a copy from a workspace with those packages:
 *   POLICY_COVER_OUT=…/policy-cover-v2 BLOCKFROST_MIDNIGHT_PREPROD_ID=… \
 *     node prove-bridge.mjs
 * `--self-test <policy-key.json>` proves proveCover for that key once (no
 * server, no submit) and prints the unsealed tx size.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createUnprovenCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { parseEncPublicKeyToHex } from '@midnight-ntwrk/midnight-js-utils';

const env = (k, d) => process.env[k] ?? d;
const OUT = env('POLICY_COVER_OUT', '');
if (!OUT) throw new Error('POLICY_COVER_OUT (compiled managed/policy-cover-v2 with keys/ and zkir/) is required');
const PORT = Number(env('PLUTUSSHIELD_BRIDGE_PORT', '6310'));
const HOST = '127.0.0.1';
const CONTRACT = env('MIDNIGHT_POLICY_COVER_ADDRESS', '5430b803b6b3df6e6ee1d498bb02e2f2d06cb46661e72af1e6208d864feb8110');
const ORIGINS = env('PLUTUSSHIELD_BRIDGE_ORIGINS', 'https://kshot3000.github.io,http://localhost:3000,http://127.0.0.1:3000').split(',').map((s) => s.trim()).filter(Boolean);
const BF_ID = env('BLOCKFROST_MIDNIGHT_PREPROD_ID', '').trim();
const BF_Q = BF_ID ? `?project_id=${encodeURIComponent(BF_ID)}` : '';
const INDEXER = env('MIDNIGHT_INDEXER_URL', '') || (BF_ID ? `https://midnight-preprod.blockfrost.io/api/v0${BF_Q}` : '');
const INDEXER_WS = env('MIDNIGHT_INDEXER_WS_URL', '') || (BF_ID ? `wss://midnight-preprod.blockfrost.io/api/v0/ws${BF_Q}` : '');
if (!INDEXER) throw new Error('set BLOCKFROST_MIDNIGHT_PREPROD_ID or MIDNIGHT_INDEXER_URL (Preprod indexer)');
const PROOF_SERVER = env('MIDNIGHT_PROOF_SERVER', 'http://127.0.0.1:6300');
const CIRCUITS = ['proveCover', 'fileClaim'];
const HEX32 = /^[0-9a-f]{64}$/;

const log = (...a) => console.log(new Date().toISOString(), '[prove-bridge]', ...a.map((x) => String(x).replace(/(project_id=)[^&\s"]+/g, '$1…')));
const hex = (u) => Buffer.from(u).toString('hex');
const u8 = (h) => Uint8Array.from(Buffer.from(h, 'hex'));

// Same witnesses as policy-cover-preprod.mjs. Private state is JSON-safe.
const witnesses = {
  localSecretKey: ({ privateState }) => [privateState, u8(privateState.sk)],
  coverageAmount: ({ privateState }, id) => [privateState, BigInt(privateState.openings?.[hex(id)]?.amount ?? '0')],
  coverageSalt: ({ privateState }, id) => [privateState, privateState.openings?.[hex(id)] ? u8(privateState.openings[hex(id)].salt) : new Uint8Array(32)],
};

/** Validate + normalize a holder private state from the browser (hex / decimal strings only). */
export function normalizePrivateState(ps) {
  if (!ps || typeof ps !== 'object') throw new BridgeError(400, 'privateState is required');
  const sk = String(ps.sk ?? '').toLowerCase().replace(/^0x/, '');
  if (!HEX32.test(sk)) throw new BridgeError(400, 'privateState.sk must be 32 bytes of hex');
  const openings = {};
  for (const [id, o] of Object.entries(ps.openings ?? {})) {
    const pid = id.toLowerCase();
    const salt = String(o?.salt ?? '').toLowerCase().replace(/^0x/, '');
    const amount = String(o?.amount ?? '');
    if (!HEX32.test(pid) || !HEX32.test(salt) || !/^\d+$/.test(amount)) throw new BridgeError(400, `privateState.openings[${id.slice(0, 16)}…] must be { amount: decimal, salt: hex32 }`);
    openings[pid] = { amount, salt };
  }
  return { sk, openings };
}

class BridgeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** One-shot in-memory private state provider (nothing touches disk). */
function memoryPrivateState() {
  const states = new Map();
  const keys = new Map();
  return {
    setContractAddress() {},
    async set(id, s) { states.set(id, s); },
    async get(id) { return states.get(id) ?? null; },
    async remove(id) { states.delete(id); },
    async clear() { states.clear(); },
    async setSigningKey(a, k) { keys.set(a, k); },
    async getSigningKey(a) { return keys.get(a) ?? null; },
    async removeSigningKey(a) { keys.delete(a); },
    async clearSigningKeys() { keys.clear(); },
  };
}

async function main() {
  setNetworkId('preprod');
  const { Contract } = await import(pathToFileURL(path.join(OUT, 'contract/index.js')).href);
  const compiled = CompiledContract.withCompiledFileAssets(
    CompiledContract.withWitnesses(CompiledContract.make('plutusshield-policy-cover-v2', Contract), witnesses),
    OUT,
  );
  const zkConfigProvider = new NodeZkConfigProvider(OUT);
  const publicDataProvider = indexerPublicDataProvider(INDEXER, INDEXER_WS);
  const proofProvider = httpClientProofProvider(PROOF_SERVER, zkConfigProvider);

  async function prove(req) {
    const circuit = String(req.circuit ?? '');
    if (!CIRCUITS.includes(circuit)) throw new BridgeError(400, `circuit must be one of ${CIRCUITS.join(', ')}`);
    const policyId = String(req.policyId ?? '').toLowerCase().replace(/^0x/, '');
    if (!HEX32.test(policyId)) throw new BridgeError(400, 'policyId must be 32 bytes of hex');
    const contractAddress = String(req.contractAddress ?? CONTRACT).toLowerCase().replace(/^0x/, '');
    if (contractAddress !== CONTRACT) throw new BridgeError(400, `this bridge proves for ${CONTRACT.slice(0, 16)}… only`);
    const privateState = normalizePrivateState(req.privateState);
    let args;
    if (circuit === 'fileClaim') {
      const ec = String(req.evidenceCommitment ?? '').toLowerCase().replace(/^0x/, '');
      if (!HEX32.test(ec)) throw new BridgeError(400, 'evidenceCommitment must be 32 bytes of hex');
      args = [u8(policyId), u8(ec)];
    } else {
      const min = String(req.minCoverage ?? '');
      if (!/^\d+$/.test(min)) throw new BridgeError(400, 'minCoverage must be a decimal string');
      args = [u8(policyId), BigInt(min)];
    }
    const coin = String(req.coinPublicKey ?? '');
    const enc = String(req.encryptionPublicKey ?? '');
    if (!coin || !enc) throw new BridgeError(400, 'coinPublicKey and encryptionPublicKey (Lace getShieldedAddresses) are required');
    const encHex = parseEncPublicKeyToHex(enc, 'preprod');
    const privateStateProvider = memoryPrivateState();
    const privateStateId = `bridge-${policyId.slice(0, 16)}-${Date.now()}`;
    await privateStateProvider.set(privateStateId, privateState);
    const walletProvider = {
      getCoinPublicKey: () => coin,
      getEncryptionPublicKey: () => encHex,
      balanceTx: async () => { throw new Error('the bridge never balances; Lace does'); },
    };
    const t0 = Date.now();
    const unproven = await createUnprovenCallTx(
      { zkConfigProvider, publicDataProvider, walletProvider, privateStateProvider },
      { compiledContract: compiled, contractAddress, circuitId: circuit, args, privateStateId },
    );
    const proven = await proofProvider.proveTx(unproven.private.unprovenTx);
    const bytes = proven.serialize();
    return { ok: true, circuit, policyId, unsealedTx: hex(bytes), bytes: bytes.length, provedMs: Date.now() - t0 };
  }

  const selfTest = process.argv.indexOf('--self-test');
  if (selfTest !== -1) {
    const key = JSON.parse(fs.readFileSync(process.argv[selfTest + 1], 'utf8'));
    // Throwaway shielded keys stand in for Lace's (the proof does not depend on them).
    const { ZswapSecretKeys } = await import('@midnight-ntwrk/ledger-v8');
    const tmp = ZswapSecretKeys.fromSeed(globalThis.crypto.getRandomValues(new Uint8Array(32)));
    const coin = env('BRIDGE_TEST_COIN_PK', '') || String(tmp.coinPublicKey);
    const enc = env('BRIDGE_TEST_ENC_PK', '') || String(tmp.encryptionPublicKey);
    const res = await prove({
      circuit: 'proveCover',
      policyId: key.policyId,
      minCoverage: key.coverage,
      privateState: { sk: key.holderSecret, openings: { [key.policyId]: { amount: key.coverage, salt: key.coverageSalt } } },
      coinPublicKey: coin,
      encryptionPublicKey: enc,
    });
    log(`self-test proveCover ${key.policyId.slice(0, 16)}…: unsealed tx ${res.bytes} bytes in ${res.provedMs} ms (not submitted)`);
    console.log(JSON.stringify({ ok: true, circuit: res.circuit, policyId: res.policyId, bytes: res.bytes, provedMs: res.provedMs, unsealedTxPrefix: res.unsealedTx.slice(0, 32) }));
    return;
  }

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin ?? '';
    const allowed = !origin || ORIGINS.includes(origin);
    const headers = { 'content-type': 'application/json', vary: 'Origin' };
    if (origin && allowed) {
      headers['access-control-allow-origin'] = origin;
      headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
      headers['access-control-allow-headers'] = 'content-type';
      headers['access-control-allow-private-network'] = 'true';
    }
    const send = (status, body) => { res.writeHead(status, headers); res.end(JSON.stringify(body)); };
    if (!allowed) return send(403, { ok: false, error: `origin ${origin} not allowed` });
    if (req.method === 'OPTIONS') return send(204, {});
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
      return send(200, { ok: true, service: 'plutusshield-prove-bridge', network: 'preprod', contractAddress: CONTRACT, circuits: CIRCUITS, proofServer: PROOF_SERVER });
    }
    if (req.method === 'POST' && req.url === '/prove') {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 64_000) return send(413, { ok: false, error: 'request too large' });
      }
      try {
        const out = await prove(JSON.parse(raw || '{}'));
        log(`proved ${out.circuit} ${out.policyId.slice(0, 16)}… (${out.bytes} bytes, ${out.provedMs} ms)`);
        return send(200, out);
      } catch (e) {
        const status = e instanceof BridgeError ? e.status : /^failed assert/.test(String(e?.message)) ? 422 : 500;
        log(`prove failed (${status}): ${e?.message ?? e}`);
        return send(status, { ok: false, error: String(e?.message ?? e) });
      }
    }
    return send(404, { ok: false, error: 'not found' });
  });
  server.listen(PORT, HOST, () => log(`listening on http://${HOST}:${PORT} for ${CONTRACT.slice(0, 16)}… (origins: ${ORIGINS.join(', ')})`));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('[prove-bridge]', e?.message ?? e);
    process.exit(1);
  });
}
