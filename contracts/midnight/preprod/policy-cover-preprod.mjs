#!/usr/bin/env node
/**
 * policy-cover on Midnight Preprod: deploy (once), then mirror a real Cardano
 * Preview policy into the private registry and prove cover as its holder.
 *
 *   1. Sync the issuer wallet (tNIGHT + tDUST) and deploy policy-cover.compact,
 *      unless MIDNIGHT_POLICY_COVER_ADDRESS / the deploy record already names one.
 *   2. Read a buyer's policy key file (the JSON the /cover Buy flow or
 *      `pnpm web-buy` saves), fetch the Buy transaction from Cardano Preview
 *      (Blockfrost) and decode its policy datum with the PlutusShield SDK. The
 *      relay trusts the chain, not the file: policy id, coverage and expiry come
 *      from the datum, and the key must open the datum's midnight_commitment.
 *   3. registerPolicy(policyId, holder, coverage, expiry, cardanoCommitment) as
 *      the issuer (the circuit itself re-checks the Cardano commitment).
 *   4. proveCover(policyId, coverage) as the holder, with the holder secret
 *      from the key file as the localSecretKey witness.
 *
 * Only reports success from finalized tx data (txId + blockHeight + status).
 * Never prints seeds or secrets. Writes public results to
 * $PLUTUSSHIELD_SECRETS/midnight-preprod-*.json; docs copy them by hand.
 *
 * Runtime: midnight-js 4.1.1, wallet-sdk 1.2.0, compact-runtime 0.16.0,
 * proof server 8.1.0 on :6300, Node 22.18+ (imports the TS SDK by type
 * stripping). The midnight-js imports below are bare specifiers, so run a copy
 * of this file from a workspace that has those packages and a WalletFacade
 * helper (MIDNIGHT_WALLET_FACADE). See contracts/midnight/README.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { WebSocket } from 'ws';

const env = (k, d) => process.env[k] ?? d;
const need = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};

const PREPROD = {
  networkId: 'preprod',
  indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWS: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
  proofServer: env('MIDNIGHT_PROOF_SERVER', 'http://127.0.0.1:6300'),
};
const REPO = need('PLUTUSSHIELD_REPO');
const SECRETS = need('PLUTUSSHIELD_SECRETS');
const OUT = need('POLICY_COVER_OUT'); // compiled managed/policy-cover (with keys/ and zkir/)
const FACADE = need('MIDNIGHT_WALLET_FACADE');
const KEY_FILE = env('PLUTUSSHIELD_POLICY_KEY', '');
const KEY_WAIT_MS = Number(env('PLUTUSSHIELD_POLICY_KEY_WAIT_MS', '0'));
const BLOCKFROST = env('BLOCKFROST_PREVIEW_ID', '');
const DEPLOY_RECORD = path.join(SECRETS, 'midnight-preprod-deploy.json');
const ROLES_FILE = path.join(SECRETS, 'midnight-preprod-roles.json');

const log = (...a) => console.error(new Date().toISOString(), ...a);
const hex = (b) => Buffer.from(b).toString('hex');
const u8 = (h) => new Uint8Array(Buffer.from(h, 'hex'));
const jsonOut = (file, v) => fs.writeFileSync(file, `${JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2)}\n`, { mode: 0o600 });

// ---------------------------------------------------------------- roles (issuer / assessor secrets, never printed)

function loadRoles() {
  if (fs.existsSync(ROLES_FILE)) return JSON.parse(fs.readFileSync(ROLES_FILE, 'utf8'));
  const r = () => hex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
  const roles = { issuerSk: r(), assessorSk: r(), createdAt: new Date().toISOString() };
  jsonOut(ROLES_FILE, roles);
  return roles;
}

// Private state is JSON-safe: hex strings and decimal strings only.
const witnesses = {
  localSecretKey: ({ privateState }) => [privateState, u8(privateState.sk)],
  coverageAmount: ({ privateState }, id) => [privateState, BigInt(privateState.openings?.[hex(id)]?.amount ?? '0')],
  coverageSalt: ({ privateState }, id) => [privateState, privateState.openings?.[hex(id)] ? u8(privateState.openings[hex(id)].salt) : new Uint8Array(32)],
};

// ---------------------------------------------------------------- Cardano side

async function cardanoPolicy(key, Chain) {
  if (!BLOCKFROST) throw new Error('BLOCKFROST_PREVIEW_ID is required to read the Cardano datum');
  if (!key.txHash) throw new Error('policy key has no txHash');
  const res = await fetch(`https://cardano-preview.blockfrost.io/api/v0/txs/${key.txHash}/utxos`, { headers: { project_id: BLOCKFROST } });
  if (!res.ok) throw new Error(`Blockfrost ${res.status} for tx ${key.txHash}`);
  const tx = await res.json();
  for (const o of tx.outputs) {
    if (!o.inline_datum) continue;
    let d;
    try {
      d = Chain.decodeCoverDatum(o.inline_datum);
    } catch {
      continue;
    }
    if (d.kind === 'Policy' && d.policy.policyId === key.policyId) return { policy: d.policy, outRef: `${key.txHash}#${o.output_index}` };
  }
  throw new Error(`no policy datum for ${key.policyId} in tx ${key.txHash}`);
}

async function waitForKey() {
  if (!KEY_FILE) return null;
  const until = Date.now() + KEY_WAIT_MS;
  while (!fs.existsSync(KEY_FILE)) {
    if (Date.now() > until) return null;
    log(`waiting for policy key ${KEY_FILE}…`);
    await new Promise((r) => setTimeout(r, 30_000));
  }
  return fs.readFileSync(KEY_FILE, 'utf8');
}

const finalized = (label, f) => {
  const p = f?.public ?? {};
  if (!p.txId || p.blockHeight == null) throw new Error(`${label}: no txId/blockHeight; not claiming success`);
  if (p.status && p.status !== 'SucceedEntirely') throw new Error(`${label}: status ${p.status}`);
  return { txId: String(p.txId), txHash: p.txHash ? String(p.txHash) : null, blockHeight: p.blockHeight, blockHash: p.blockHash ? String(p.blockHash) : null, status: p.status ?? null };
};

// ---------------------------------------------------------------- main

async function main() {
  // Optional: a module exporting loadPreprodEnv() that loads MIDNIGHT_WALLET_SEED etc. from a gitignored file.
  if (process.env.MIDNIGHT_LOAD_ENV) (await import(pathToFileURL(process.env.MIDNIGHT_LOAD_ENV).href)).loadPreprodEnv();
  const Holder = await import(pathToFileURL(path.join(REPO, 'packages/sdk/src/midnight.ts')).href);
  const Chain = await import(pathToFileURL(path.join(REPO, 'packages/sdk/src/chain.ts')).href);
  const W = await import(pathToFileURL(FACADE).href);
  const { Contract, ledger } = await import(pathToFileURL(path.join(OUT, 'contract/index.js')).href);
  const pure = (await import(pathToFileURL(path.join(OUT, 'contract/index.js')).href)).pureCircuits;

  setNetworkId(PREPROD.networkId);
  if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;
  const health = await fetch(`${PREPROD.proofServer}/health`).then((r) => r.ok).catch(() => false);
  if (!health) throw new Error(`proof server ${PREPROD.proofServer} is not healthy`);

  const roles = loadRoles();
  const issuerState = { sk: roles.issuerSk, openings: {} };
  const assessorCommitment = pure.roleCommitment(u8(roles.assessorSk), pure.assessorTag());

  // Validate the key file against Cardano before spending any time on the wallet.
  let keyText = KEY_FILE && fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, 'utf8') : null;
  const checkKey = async (text) => {
    const key = Holder.parsePolicyKey(text);
    const { policy, outRef } = await cardanoPolicy(key, Chain);
    const check = await Holder.checkPolicyKey({ ...key, coverage: policy.coverage.toString() }, policy.midnightCommitment);
    if (!check.ok) throw new Error(`policy key does not open the Cardano datum commitment: ${check.reason}`);
    log(`policy ${key.policyId.slice(0, 16)}… datum ${outRef}: key opens midnight_commitment ${policy.midnightCommitment.slice(0, 16)}…`);
    return { key: { ...key, coverage: policy.coverage.toString(), expiry: policy.expiry.toString() }, policy, outRef };
  };
  let cardano = keyText ? await checkKey(keyText) : null;

  log('building wallet (seed from env, never printed)…');
  const ctx = await W.buildPreprodWalletFromEnv();
  log('unshielded', ctx.unshieldedAddress);
  try {
    await W.waitUntilConnected(ctx.wallet, { timeoutMs: 180_000 });
    await W.waitForNightBalance(ctx.wallet, ctx.unshieldedKeystore, { timeoutMs: 900_000 });
    log('syncing (Preprod dust sync can take ~30 min)…');
    const synced = await W.waitForSynced(ctx.wallet, { timeoutMs: 3_600_000 });
    log('synced; tNIGHT', W.formatNight(W.nightBalanceFromState(synced, ctx.unshieldedKeystore)), 'tDUST', W.formatDust(W.dustBalanceFromState(synced)));
    const dust = await W.ensureDustRegistered(ctx.wallet, ctx.unshieldedKeystore, { dustWaitTimeoutMs: 900_000 });
    if (dust.dustBalance <= 0n) throw new Error('tDUST is 0');

    const walletProvider = W.makeWalletMidnightProvider(ctx.wallet, ctx.shieldedSecretKeys, ctx.dustSecretKey);
    const accountId = String(ctx.unshieldedKeystore.getBech32Address());
    const zkConfigProvider = new NodeZkConfigProvider(OUT);
    const providers = {
      privateStateProvider: levelPrivateStateProvider({
        privateStateStoreName: 'plutusshield-policy-cover-private-state',
        signingKeyStoreName: 'plutusshield-policy-cover-signing-keys',
        privateStoragePasswordProvider: () => need('PRIVATE_STATE_PASSWORD'),
        accountId,
      }),
      publicDataProvider: indexerPublicDataProvider(PREPROD.indexer, PREPROD.indexerWS),
      zkConfigProvider,
      proofProvider: httpClientProofProvider(PREPROD.proofServer, zkConfigProvider),
      walletProvider,
      midnightProvider: walletProvider,
    };
    const compiled = CompiledContract.withCompiledFileAssets(
      CompiledContract.withWitnesses(CompiledContract.make('plutusshield-policy-cover', Contract), witnesses),
      OUT,
    );

    // 1. deploy once
    let record = fs.existsSync(DEPLOY_RECORD) ? JSON.parse(fs.readFileSync(DEPLOY_RECORD, 'utf8')) : null;
    let address = env('MIDNIGHT_POLICY_COVER_ADDRESS', record?.contractAddress);
    let issuer;
    if (!address) {
      log('deployContract policy-cover (prove + balance + submit)…');
      const deployed = await deployContract(providers, {
        compiledContract: compiled,
        privateStateId: 'plutusshieldIssuer',
        initialPrivateState: issuerState,
        args: [assessorCommitment],
      });
      const p = deployed.deployTxData.public;
      if (!p.contractAddress) throw new Error('deploy returned no contractAddress');
      address = String(p.contractAddress);
      record = {
        network: 'midnight-preprod',
        contract: 'contracts/midnight/src/policy-cover.compact',
        compiler: 'compactc 0.31.1',
        contractAddress: address,
        deployTxId: p.txId ? String(p.txId) : null,
        blockHeight: p.blockHeight ?? null,
        issuerCommitment: hex(pure.roleCommitment(u8(roles.issuerSk), pure.issuerTag())),
        assessorCommitment: hex(assessorCommitment),
        deployer: ctx.unshieldedAddress,
        deployedAt: new Date().toISOString(),
        registrations: [],
      };
      jsonOut(DEPLOY_RECORD, record);
      log('DEPLOYED', address, 'tx', record.deployTxId, 'block', record.blockHeight);
      issuer = deployed;
    } else {
      log('joining', address);
      issuer = await findDeployedContract(providers, { compiledContract: compiled, contractAddress: address, privateStateId: 'plutusshieldIssuer', initialPrivateState: issuerState });
    }

    // 2. policy key -> registerPolicy -> proveCover
    if (!cardano) {
      keyText = await waitForKey();
      if (!keyText) {
        log('no policy key given; deploy only');
        return;
      }
      cardano = await checkKey(keyText);
    }
    const { key, policy, outRef } = cardano;
    const a = Holder.registerPolicyArgs(key);
    log('registerPolicy as issuer…');
    const reg = finalized('registerPolicy', await issuer.callTx.registerPolicy(a.policyId, a.holderCommitment, a.coverage, a.expiry, a.cardanoCommitment));
    log('REGISTERED tx', reg.txId, 'block', reg.blockHeight);

    const holderState = { sk: key.holderSecret, openings: { [key.policyId]: { amount: key.coverage, salt: key.coverageSalt } } };
    const holder = await findDeployedContract(providers, { compiledContract: compiled, contractAddress: address, privateStateId: `plutusshieldHolder-${key.policyId.slice(0, 16)}`, initialPrivateState: holderState });
    log('proveCover as holder…');
    const prove = finalized('proveCover', await holder.callTx.proveCover(a.policyId, BigInt(key.coverage)));
    log('PROVED tx', prove.txId, 'block', prove.blockHeight);

    // Read back the public record and recompute the Cardano binding from it.
    const state = await providers.publicDataProvider.queryContractState(address);
    let l;
    try {
      l = ledger(state.data);
    } catch {
      l = ledger(state);
    }
    const rec = l.policies.lookup(a.policyId);
    const rebound = hex(pure.registrationCommitment(a.policyId, rec.holder, rec.coverage));
    const entry = {
      policyId: key.policyId,
      cardano: { network: 'preview', buyTx: key.txHash, policyDatum: outRef, midnightCommitment: policy.midnightCommitment, coverage: policy.coverage.toString(), expiry: policy.expiry.toString() },
      registerPolicy: reg,
      proveCover: { ...prove, minCoverage: key.coverage },
      ledger: { status: Number(rec.status), holder: hex(rec.holder), coverage: hex(rec.coverage), activePolicies: String(l.activePolicies), coverProofs: String(l.coverProofs) },
      bindingHolds: rebound === policy.midnightCommitment,
      at: new Date().toISOString(),
    };
    record.registrations = [...(record.registrations ?? []).filter((r) => r.policyId !== key.policyId), entry];
    jsonOut(DEPLOY_RECORD, record);
    console.log(JSON.stringify({ contractAddress: address, ...entry }, null, 2));
    if (!entry.bindingHolds) throw new Error('ledger record does not recompute to the Cardano commitment');
  } finally {
    await ctx.wallet.stop().catch(() => {});
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    log('FAILED (not claiming success):', e?.stack || e);
    let c = e?.cause;
    for (let i = 0; c && i < 5; i++, c = c.cause) log(`cause[${i}]`, c?.stack || c);
    process.exit(1);
  },
);
