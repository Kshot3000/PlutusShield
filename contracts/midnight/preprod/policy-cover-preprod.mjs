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
 * `--all` (batch relay) replaces steps 2-4 with the relay plan
 * (contracts/midnight/relay/plan.ts): every live PlutusShield policy on
 * Preview that is not yet in the contract's ledger is registered from its Buy
 * tx's public registration ticket or a local policy key (whichever opens the
 * datum's midnight_commitment), and proven with proveCover when the holder's
 * key is on this machine. Idempotent (re-checks the ledger before each call),
 * one policy at a time, stops at the first failure. Pre-binding policies and
 * policies with neither a ticket nor a key are reported, never faked.
 *
 * `--claim <policyId> --evidence <input.json>` and `--resolve <policyId>
 * --approve|--reject` (claims relay, contracts/midnight/relay/claims.ts) run the
 * exploit-claim lifecycle on an already-mirrored policy, in argv order, in one
 * wallet sync:
 *   claim:   seal the evidence input with packages/sdk/src/evidence.ts
 *            (canonical bundle -> SHA-256 digest -> fresh salt ->
 *            evidenceCommitment), save the encrypted envelope + key file under
 *            $PLUTUSSHIELD_SECRETS/evidence/, then fileClaim(policyId,
 *            commitment) as the holder (policy key from the key dirs, re-checked
 *            against the Cardano datum and the ledger's holder commitment).
 *   resolve: as the assessor, open the bundle off-ledger and check it against
 *            the commitment the ledger holds for the policy (verifyEvidence);
 *            only then resolveClaim(policyId, approved). Approve -> PAID,
 *            reject -> ACTIVE with the evidence cleared.
 * `--register-first` lets `--claim` take a policy that isn't mirrored yet
 * (e.g. a new exploit-cover pool's Buy): registerPolicy + proveCover from the
 * local holder key, then fileClaim, all in the same wallet sync.
 * Preflight (ledger state, keys, Cardano datum, sealing) runs before the wallet
 * syncs, so a bad request fails in seconds, not after the dust sync; add
 * `--dry-run` to stop after it (no wallet, no proof, no tx).
 *
 * Only reports success from finalized tx data (txId + blockHeight + status).
 * Never prints seeds or secrets. Writes public results to
 * $PLUTUSSHIELD_SECRETS/midnight-preprod-deploy.json after every policy, and to
 * $PLUTUSSHIELD_PUBLIC_RECORD (contracts/midnight/deployments/preprod.json) if set.
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
const PUBLIC_RECORD = env('PLUTUSSHIELD_PUBLIC_RECORD', '');
const ALL = process.argv.includes('--all');
const ARGV = process.argv.slice(2);
const CLAIM_MODE = ARGV.includes('--claim') || ARGV.includes('--resolve');
const REGISTER_FIRST = ARGV.includes('--register-first');
const KEY_DIRS = env('PLUTUSSHIELD_POLICY_KEY_DIRS', [path.join(SECRETS, 'policy-keys'), path.join(REPO, 'contracts/cardano/deploy/.keys/policy-keys')].join(','))
  .split(',')
  .filter(Boolean);
const ROLES_FILE = path.join(SECRETS, 'midnight-preprod-roles.json');

const log = (...a) => console.error(new Date().toISOString(), ...a);
const hex = (b) => Buffer.from(b).toString('hex');
const u8 = (h) => new Uint8Array(Buffer.from(h, 'hex'));
const jsonText = (v) => `${JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2)}\n`;
const jsonOut = (file, v) => fs.writeFileSync(file, `${JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2)}\n`, { mode: 0o600 });

/** Mirror the run record into the repo's public record (keeps its _note; public data only). */
function writePublic(record) {
  if (!PUBLIC_RECORD) return;
  const prev = fs.existsSync(PUBLIC_RECORD) ? JSON.parse(fs.readFileSync(PUBLIC_RECORD, 'utf8')) : {};
  fs.writeFileSync(PUBLIC_RECORD, jsonText({ ...record, _note: prev._note ?? 'Public Midnight Preprod data only. No keys, seeds or holder secrets.' }));
}

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

  const checkKey = async (text) => {
    const key = Holder.parsePolicyKey(text);
    const { policy, outRef } = await cardanoPolicy(key, Chain);
    const check = await Holder.checkPolicyKey({ ...key, coverage: policy.coverage.toString() }, policy.midnightCommitment);
    if (!check.ok) throw new Error(`policy key does not open the Cardano datum commitment: ${check.reason}`);
    log(`policy ${key.policyId.slice(0, 16)}… datum ${outRef}: key opens midnight_commitment ${policy.midnightCommitment.slice(0, 16)}…`);
    return { key: { ...key, coverage: policy.coverage.toString(), expiry: policy.expiry.toString() }, policy, outRef };
  };

  // Claims mode: plan + check everything against the public ledger and Cardano before the wallet sync.
  const Claims = CLAIM_MODE ? await import(pathToFileURL(path.join(REPO, 'contracts/midnight/relay/claims.ts')).href) : null;
  const claimOps = Claims ? Claims.parseClaimOps(ARGV) : [];
  const publicData = indexerPublicDataProvider(PREPROD.indexer, PREPROD.indexerWS);
  const ledgerAt = async (address) => {
    const state = await publicData.queryContractState(address);
    if (!state) throw new Error(`no contract state for ${address}`);
    try {
      return ledger(state.data);
    } catch {
      return ledger(state);
    }
  };
  const statusName = (n) => ['NONE', 'ACTIVE', 'CLAIM_PENDING', 'PAID', 'EXPIRED'][Number(n)] ?? `#${n}`;
  const claimView = (l, id) => {
    if (!l.policies.member(u8(id))) return null;
    const r = l.policies.lookup(u8(id));
    return { status: statusName(r.status), evidence: hex(r.evidence), holder: hex(r.holder) };
  };
  const ledgerSummary = (l, id) => {
    const v = claimView(l, id);
    return { status: v?.status ?? 'NONE', evidence: v?.evidence ?? null, activePolicies: String(l.activePolicies), claimsFiled: String(l.claimsFiled), claimsPaid: String(l.claimsPaid) };
  };
  const prepared = [];
  if (CLAIM_MODE) {
    const rec0 = fs.existsSync(DEPLOY_RECORD) ? JSON.parse(fs.readFileSync(DEPLOY_RECORD, 'utf8')) : null;
    const address = env('MIDNIGHT_POLICY_COVER_ADDRESS', rec0?.contractAddress);
    if (!address) throw new Error('claims mode needs a deployed contract (deploy record or MIDNIGHT_POLICY_COVER_ADDRESS)');
    const Plan = await import(pathToFileURL(path.join(REPO, 'contracts/midnight/relay/plan.ts')).href);
    const keys = Plan.localPolicyKeys(KEY_DIRS);
    const l0 = await ledgerAt(address);
    const planned = new Map(); // policyId -> status after the ops so far
    for (const op of claimOps) {
      const now = planned.get(op.policyId) ?? claimView(l0, op.policyId)?.status ?? 'NONE';
      if (op.kind === 'claim') {
        // --register-first: a policy not yet mirrored is registered (issuer) + proven (holder) in the same sync.
        const register = now === 'NONE' && REGISTER_FIRST;
        if (now !== 'ACTIVE' && !register) throw new Error(`--claim ${op.policyId.slice(0, 16)}…: policy is ${now} on Midnight, not ACTIVE${now === 'NONE' ? ' (add --register-first to mirror it in this run)' : ''}`);
        const local = keys.get(op.policyId);
        if (!local) throw new Error(`--claim ${op.policyId.slice(0, 16)}…: no holder policy key in ${KEY_DIRS.join(', ')}`);
        const c = await checkKey(fs.readFileSync(local.file, 'utf8'));
        const onLedger = claimView(l0, op.policyId);
        if (onLedger && onLedger.holder !== c.key.holderCommitment.toLowerCase()) throw new Error(`--claim ${op.policyId.slice(0, 16)}…: key is not the ledger's holder (rotated?)`);
        const sealed = await Claims.sealEvidenceFile(path.resolve(op.evidence), op.policyId);
        const files = Claims.saveSealed(SECRETS, sealed);
        log(`sealed evidence for ${op.policyId.slice(0, 16)}…: commitment ${sealed.commitment.slice(0, 16)}… (fresh salt; envelope + key file in ${path.dirname(files.envelope)})`);
        prepared.push({ op, key: c.key, cardano: { network: 'preview', buyTx: c.key.txHash, policyDatum: c.outRef }, sealed, register, midnightCommitment: c.policy.midnightCommitment });
        planned.set(op.policyId, 'CLAIM_PENDING');
      } else {
        if (now !== 'CLAIM_PENDING') throw new Error(`--resolve ${op.policyId.slice(0, 16)}…: policy is ${now}, no pending claim`);
        // A claim already on the ledger is assessed now, so a bundle that doesn't open fails before the sync.
        const v = claimView(l0, op.policyId);
        if (v?.status === 'CLAIM_PENDING' && !planned.has(op.policyId)) {
          const a = await Claims.assessClaim({ policyId: op.policyId, ledger: v, ...Claims.loadFiling(SECRETS, op, v.evidence) });
          if (!a.ok) throw new Error(`--resolve ${op.policyId.slice(0, 16)}…: assessor check failed: ${a.reason}`);
          log(`preflight assessor check ${op.policyId.slice(0, 16)}…: ${a.reason}`);
        }
        prepared.push({ op });
        planned.set(op.policyId, op.approved ? 'PAID' : 'ACTIVE');
      }
    }
    if (ARGV.includes('--dry-run')) {
      log(`claims plan (dry run, no wallet, no txs): ${claimOps.map((o) => `${o.kind} ${o.policyId.slice(0, 16)}…${o.kind === 'resolve' ? (o.approved ? ' approve' : ' reject') : ''}`).join(', ')}`);
      return;
    }
    log(`claims plan: ${claimOps.map((o) => `${o.kind} ${o.policyId.slice(0, 16)}…${o.kind === 'resolve' ? (o.approved ? ' approve' : ' reject') : ''}`).join(', ')}`);
  }

  // Validate the key file against Cardano before spending any time on the wallet.
  let keyText = !ALL && !CLAIM_MODE && KEY_FILE && fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, 'utf8') : null;
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
    if (!address && CLAIM_MODE) throw new Error('claims mode never deploys');
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
    } else if (!CLAIM_MODE || prepared.some((p) => p.register)) {
      log('joining', address);
      issuer = await findDeployedContract(providers, { compiledContract: compiled, contractAddress: address, privateStateId: 'plutusshieldIssuer', initialPrivateState: issuerState });
    }

    const readLedger = async () => {
      const state = await providers.publicDataProvider.queryContractState(address);
      if (!state) throw new Error(`no contract state for ${address}`);
      try {
        return ledger(state.data);
      } catch {
        return ledger(state);
      }
    };

    /**
     * registerPolicy (issuer) then, with a holder key, proveCover (holder) for one
     * policy; read the record back and recompute the Cardano binding from it.
     * `args` are registerPolicy's five arguments, all from the datum + ticket/key.
     */
    const relayOne = async ({ policyId, args, holderKey, cardano: c, source }) => {
      log(`registerPolicy ${policyId.slice(0, 16)}… as issuer (${source})…`);
      const reg = finalized('registerPolicy', await issuer.callTx.registerPolicy(args.policyId, args.holderCommitment, args.coverage, args.expiry, args.cardanoCommitment));
      log('REGISTERED tx', reg.txId, 'hash', reg.txHash, 'block', reg.blockHeight);
      let prove = null;
      if (holderKey) {
        const holderState = { sk: holderKey.holderSecret, openings: { [policyId]: { amount: holderKey.coverage, salt: holderKey.coverageSalt } } };
        const holder = await findDeployedContract(providers, { compiledContract: compiled, contractAddress: address, privateStateId: `plutusshieldHolder-${policyId.slice(0, 16)}`, initialPrivateState: holderState });
        log('proveCover as holder…');
        prove = { ...finalized('proveCover', await holder.callTx.proveCover(args.policyId, BigInt(holderKey.coverage))), minCoverage: holderKey.coverage };
        log('PROVED tx', prove.txId, 'hash', prove.txHash, 'block', prove.blockHeight);
      }
      const l = await readLedger();
      const rec = l.policies.lookup(args.policyId);
      const rebound = hex(pure.registrationCommitment(args.policyId, rec.holder, rec.coverage));
      const entry = {
        policyId,
        cardano: c,
        source,
        registerPolicy: reg,
        ...(prove ? { proveCover: prove } : {}),
        ledger: { status: Number(rec.status), holder: hex(rec.holder), coverage: hex(rec.coverage), activePolicies: String(l.activePolicies), coverProofs: String(l.coverProofs) },
        bindingHolds: rebound === c.midnightCommitment,
        at: new Date().toISOString(),
      };
      record.registrations = [...(record.registrations ?? []).filter((r) => r.policyId !== policyId), entry];
      jsonOut(DEPLOY_RECORD, record);
      writePublic(record);
      console.log(JSON.stringify({ contractAddress: address, ...entry }, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2));
      if (!entry.bindingHolds) throw new Error('ledger record does not recompute to the Cardano commitment');
      return entry;
    };

    if (CLAIM_MODE) {
      const tx = (label, f) => finalized(label, f);
      const done = [];
      const saveClaim = (entry) => {
        record.claims = [...(record.claims ?? []).filter((c) => !(c.policyId === entry.policyId && c.evidenceCommitment === entry.evidenceCommitment)), entry];
        jsonOut(DEPLOY_RECORD, record);
        writePublic(record);
      };
      for (const p of prepared) {
        const { op } = p;
        const id = op.policyId;
        if (op.kind === 'claim') {
          if (p.register && !(await readLedger()).policies.member(u8(id))) {
            await relayOne({
              policyId: id,
              args: Holder.registerPolicyArgs(p.key),
              holderKey: p.key,
              cardano: { ...p.cardano, midnightCommitment: p.midnightCommitment, coverage: p.key.coverage, expiry: p.key.expiry },
              source: 'key',
            });
          }
          const before = claimView(await readLedger(), id);
          if (before?.status !== 'ACTIVE') throw new Error(`fileClaim ${id.slice(0, 16)}…: policy is ${before?.status ?? 'NONE'} now; not filing`);
          const holderState = { sk: p.key.holderSecret, openings: { [id]: { amount: p.key.coverage, salt: p.key.coverageSalt } } };
          const holder = await findDeployedContract(providers, { compiledContract: compiled, contractAddress: address, privateStateId: `plutusshieldHolder-${id.slice(0, 16)}`, initialPrivateState: holderState });
          log(`fileClaim ${id.slice(0, 16)}… as holder, evidence commitment ${p.sealed.commitment.slice(0, 16)}…`);
          const filed = tx('fileClaim', await holder.callTx.fileClaim(u8(id), u8(p.sealed.commitment)));
          log('FILED tx', filed.txId, 'hash', filed.txHash, 'block', filed.blockHeight);
          const l = await readLedger();
          const after = ledgerSummary(l, id);
          const entry = {
            policyId: id,
            cardano: p.cardano,
            evidenceCommitment: p.sealed.commitment,
            evidenceInput: path.relative(REPO, path.resolve(op.evidence)),
            fileClaim: filed,
            ledgerAfterFile: after,
            filedAt: new Date().toISOString(),
          };
          saveClaim(entry);
          done.push(entry);
          if (after.status !== 'CLAIM_PENDING' || after.evidence !== p.sealed.commitment) throw new Error(`ledger after fileClaim: ${after.status} ${after.evidence}; expected CLAIM_PENDING ${p.sealed.commitment}`);
        } else {
          const l = await readLedger();
          const v = claimView(l, id);
          const a = await Claims.assessClaim({ policyId: id, ledger: v, ...(v ? Claims.loadFiling(SECRETS, op, v.evidence) : { envelopeText: '', keyFileText: '' }) });
          if (!a.ok) throw new Error(`assessor check failed for ${id.slice(0, 16)}…: ${a.reason}; not resolving`);
          log(`assessor verified ${id.slice(0, 16)}… off-ledger: ${a.reason} (${a.summary.protocol}, ${a.summary.loss})`);
          const assessor = await findDeployedContract(providers, { compiledContract: compiled, contractAddress: address, privateStateId: 'plutusshieldAssessor', initialPrivateState: { sk: roles.assessorSk, openings: {} } });
          log(`resolveClaim ${id.slice(0, 16)}… ${op.approved ? 'APPROVE' : 'REJECT'} as assessor…`);
          const res = { ...tx('resolveClaim', await assessor.callTx.resolveClaim(u8(id), op.approved)), approved: op.approved };
          log('RESOLVED tx', res.txId, 'hash', res.txHash, 'block', res.blockHeight);
          const after = ledgerSummary(await readLedger(), id);
          const prev = (record.claims ?? []).find((c) => c.policyId === id && c.evidenceCommitment === v.evidence) ?? { policyId: id, evidenceCommitment: v.evidence };
          const entry = {
            ...prev,
            assessment: { ok: a.ok, reason: a.reason, checks: a.checks.map((c) => ({ id: c.id, ok: c.ok })), bundle: a.summary },
            resolveClaim: res,
            ledgerAfterResolve: after,
            resolvedAt: new Date().toISOString(),
          };
          saveClaim(entry);
          done.push(entry);
          const want = op.approved ? 'PAID' : 'ACTIVE';
          if (after.status !== want) throw new Error(`ledger after resolveClaim: ${after.status}; expected ${want}`);
          if (!op.approved && !/^0+$/.test(after.evidence ?? '')) throw new Error('rejected claim kept its evidence commitment');
        }
        console.log(JSON.stringify({ contractAddress: address, ...done[done.length - 1] }, null, 2));
      }
      log(`claims done: ${done.length} txs`);
      return;
    }

    if (ALL) {
      // Batch relay: plan from Cardano (Koios) + this ledger, then one policy at a time.
      const Plan = await import(pathToFileURL(path.join(REPO, 'contracts/midnight/relay/plan.ts')).href);
      const Relay = await import(pathToFileURL(path.join(REPO, 'packages/sdk/src/relay.ts')).href);
      const dep = JSON.parse(fs.readFileSync(path.join(REPO, 'apps/web/src/data/preview-deployment.json'), 'utf8'));
      const memberNow = async (id) => (await readLedger()).policies.member(u8(id));
      const l0 = await readLedger();
      const plan = await Plan.buildRelayPlan({ deployment: dep, keyDirs: KEY_DIRS, isMirrored: (id) => l0.policies.member(u8(id)) });
      const sum = Relay.mirrorSummary(plan);
      log(`plan: ${sum.total} live Preview policies: ${sum.mirrored} mirrored, ${sum.ready} ready, ${sum['awaiting-key']} awaiting holder key, ${sum['pre-binding']} pre-binding`);
      for (const e of plan.filter((x) => x.state !== 'ready')) log(`  skip ${e.policyId.slice(0, 16)}… ${Relay.MIRROR_STATE_LABEL[e.state]}`);
      const done = [];
      for (const e of plan.filter((x) => x.state === 'ready')) {
        if (await memberNow(e.policyId)) {
          log(`  ${e.policyId.slice(0, 16)}… registered meanwhile; skipping`);
          continue;
        }
        let holderKey = null;
        let regArgs;
        if (e.keyFile) {
          const k = Holder.parsePolicyKey(fs.readFileSync(e.keyFile, 'utf8'));
          holderKey = { ...k, coverage: e.coverage.toString(), expiry: e.expiry.toString() };
          const chk = await Holder.checkPolicyKey(holderKey, e.midnightCommitment);
          if (!chk.ok) throw new Error(`key for ${e.policyId} no longer opens the datum: ${chk.reason}`);
          regArgs = Holder.registerPolicyArgs(holderKey);
        } else {
          if (!(await Relay.ticketOpensDatum(e.ticket, e))) throw new Error(`ticket for ${e.policyId} does not open the datum`);
          regArgs = {
            policyId: u8(e.policyId),
            holderCommitment: u8(e.ticket.holderCommitment),
            coverage: u8(e.ticket.coverageCommitment),
            expiry: e.expiry,
            cardanoCommitment: u8(e.midnightCommitment),
          };
        }
        const c = { network: 'preview', buyTx: e.buyTx, policyDatum: e.ref, midnightCommitment: e.midnightCommitment, coverage: e.coverage.toString(), expiry: e.expiry.toString() };
        done.push(await relayOne({ policyId: e.policyId, args: regArgs, holderKey, cardano: c, source: e.source }));
      }
      log(`batch relay done: ${done.length} newly mirrored, ${done.filter((d) => d.proveCover).length} cover proofs`);
      return;
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
    await relayOne({
      policyId: key.policyId,
      args: Holder.registerPolicyArgs(key),
      holderKey: key,
      cardano: { network: 'preview', buyTx: key.txHash, policyDatum: outRef, midnightCommitment: policy.midnightCommitment, coverage: policy.coverage.toString(), expiry: policy.expiry.toString() },
      source: 'key',
    });
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
