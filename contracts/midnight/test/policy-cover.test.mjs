/**
 * Off-chain simulation of policy-cover.compact using the compiler-generated
 * Contract class and @midnight-ntwrk/compact-runtime. No network, no deploy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as RT from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits, PolicyStatus } from '../src/managed/policy-cover/contract/index.js';
// The SDK evidence vault (TypeScript, loaded via Node type stripping).
import * as Evidence from '../../../packages/sdk/src/evidence.ts';

const COIN = '0'.repeat(64);
const ADDR = RT.sampleContractAddress();
const b32 = () => new Uint8Array(randomBytes(32));

const issuerSk = b32();
const assessorSk = b32();
const holderSk = b32();
const strangerSk = b32();

const { roleCommitment, coverageCommitment, issuerTag, holderTag, assessorTag } = pureCircuits;

// Private state is the caller's local wallet: secret key + coverage openings.
const witnesses = {
  localSecretKey: ({ privateState }) => [privateState, privateState.sk],
  coverageAmount: ({ privateState }, id) => [privateState, privateState.openings[Buffer.from(id).toString('hex')]?.amount ?? 0n],
  coverageSalt: ({ privateState }, id) => [privateState, privateState.openings[Buffer.from(id).toString('hex')]?.salt ?? new Uint8Array(32)],
};

const contract = new Contract(witnesses);

function deploy() {
  const ps = { sk: issuerSk, openings: {} };
  const assessorCommit = roleCommitment(assessorSk, assessorTag());
  const ctor = contract.initialState(RT.createConstructorContext(ps, COIN), assessorCommit);
  return ctor.currentContractState;
}

// Run an impure circuit as a given private state; returns the new contract state.
function call(state, privateState, name, ...args) {
  const ctx = RT.createCircuitContext(ADDR, COIN, state, privateState);
  const res = contract.impureCircuits[name](ctx, ...args);
  return res.context.currentQueryContext.state;
}

const L = (state) => ledger(state);

function setup() {
  let state = deploy();
  const policyId = b32();
  const amount = 25_000n;
  const salt = b32();
  const holderCommit = roleCommitment(holderSk, holderTag());
  const covCommit = coverageCommitment(amount, salt);
  state = call(state, { sk: issuerSk, openings: {} }, 'registerPolicy', policyId, holderCommit, covCommit, 1_800_000_000n);
  const holder = { sk: holderSk, openings: { [Buffer.from(policyId).toString('hex')]: { amount, salt } } };
  return { state, policyId, amount, salt, holder };
}

test('issuer registers a policy; record stores only commitments', () => {
  const { state, policyId } = setup();
  const l = L(state);
  assert.equal(l.activePolicies, 1n);
  const rec = l.policies.lookup(policyId);
  assert.equal(rec.status, PolicyStatus.ACTIVE);
  assert.equal(rec.coverage.length, 32);
});

test('non-issuer cannot register', () => {
  const state = deploy();
  assert.throws(
    () => call(state, { sk: strangerSk, openings: {} }, 'registerPolicy', b32(), b32(), b32(), 1n),
    /not the issuer/,
  );
});

test('duplicate policy id rejected', () => {
  const { state, policyId } = setup();
  assert.throws(
    () => call(state, { sk: issuerSk, openings: {} }, 'registerPolicy', policyId, b32(), b32(), 1n),
    /already registered/,
  );
});

test('holder proves cover >= threshold without revealing amount', () => {
  const { state, policyId, holder } = setup();
  const s2 = call(state, holder, 'proveCover', policyId, 10_000n);
  assert.equal(L(s2).coverProofs, 1n);
});

test('proof fails above the committed amount', () => {
  const { state, policyId, holder } = setup();
  assert.throws(() => call(state, holder, 'proveCover', policyId, 25_001n), /below requested minimum/);
});

test('proof fails with a forged opening', () => {
  const { state, policyId, holder } = setup();
  const forged = { ...holder, openings: { [Buffer.from(policyId).toString('hex')]: { amount: 1_000_000n, salt: holder.openings[Buffer.from(policyId).toString('hex')].salt } } };
  assert.throws(() => call(state, forged, 'proveCover', policyId, 500_000n), /does not match commitment/);
});

test('stranger cannot prove or claim on someone else\'s policy', () => {
  const { state, policyId, holder } = setup();
  const stranger = { ...holder, sk: strangerSk };
  assert.throws(() => call(state, stranger, 'proveCover', policyId, 1n), /does not hold/);
  assert.throws(() => call(state, stranger, 'fileClaim', policyId, b32()), /does not hold/);
});

test('claim lifecycle: file -> assessor approves -> PAID', () => {
  const { state, policyId, holder } = setup();
  let s = call(state, holder, 'fileClaim', policyId, b32());
  assert.equal(L(s).policies.lookup(policyId).status, PolicyStatus.CLAIM_PENDING);
  assert.equal(L(s).claimsFiled, 1n);
  assert.throws(() => call(s, { sk: issuerSk, openings: {} }, 'resolveClaim', policyId, true), /not the assessor/);
  s = call(s, { sk: assessorSk, openings: {} }, 'resolveClaim', policyId, true);
  const l = L(s);
  assert.equal(l.policies.lookup(policyId).status, PolicyStatus.PAID);
  assert.equal(l.claimsPaid, 1n);
  assert.equal(l.activePolicies, 0n);
});

test('rejected claim returns policy to ACTIVE and clears evidence', () => {
  const { state, policyId, holder } = setup();
  let s = call(state, holder, 'fileClaim', policyId, b32());
  s = call(s, { sk: assessorSk, openings: {} }, 'resolveClaim', policyId, false);
  const rec = L(s).policies.lookup(policyId);
  assert.equal(rec.status, PolicyStatus.ACTIVE);
  assert.deepEqual([...rec.evidence], new Array(32).fill(0));
  assert.equal(L(s).claimsPaid, 0n);
});

test('issuer expires an active policy; expired cover cannot be proven', () => {
  const { state, policyId, holder } = setup();
  const s = call(state, { sk: issuerSk, openings: {} }, 'expirePolicy', policyId);
  assert.equal(L(s).policies.lookup(policyId).status, PolicyStatus.EXPIRED);
  assert.equal(L(s).activePolicies, 0n);
  assert.throws(() => call(s, holder, 'proveCover', policyId, 1n), /not active/);
});

/* ---------- holder rotation / private transfer ---------- */

const newHolderSk = b32();
const newHolderCommit = roleCommitment(newHolderSk, holderTag());

// Register a policy, then rotate it from holderSk to newHolderSk.
function rotated() {
  const base = setup();
  const before = L(base.state).policies.lookup(base.policyId);
  const state = call(base.state, base.holder, 'rotateHolder', base.policyId, newHolderCommit);
  const newHolder = { ...base.holder, sk: newHolderSk };
  return { ...base, state, before, newHolder };
}

test('holder rotates to a new key; only the holder commitment changes', () => {
  const { state, policyId, before } = rotated();
  const l = L(state);
  const rec = l.policies.lookup(policyId);
  assert.deepEqual([...rec.holder], [...newHolderCommit]);
  assert.deepEqual([...rec.coverage], [...before.coverage]);
  assert.equal(rec.expiry, before.expiry);
  assert.equal(rec.status, PolicyStatus.ACTIVE);
  assert.equal(l.holderRotations, 1n);
  assert.equal(l.activePolicies, 1n);
});

test('after rotation the old key can no longer prove, claim or rotate', () => {
  const { state, policyId, holder } = rotated();
  assert.throws(() => call(state, holder, 'proveCover', policyId, 1n), /does not hold/);
  assert.throws(() => call(state, holder, 'fileClaim', policyId, b32()), /does not hold/);
  assert.throws(() => call(state, holder, 'rotateHolder', policyId, roleCommitment(holderSk, holderTag())), /does not hold/);
});

test('after rotation the new key can prove cover and file a claim', () => {
  const { state, policyId, newHolder } = rotated();
  let s = call(state, newHolder, 'proveCover', policyId, 25_000n);
  assert.equal(L(s).coverProofs, 1n);
  s = call(s, newHolder, 'fileClaim', policyId, b32());
  assert.equal(L(s).policies.lookup(policyId).status, PolicyStatus.CLAIM_PENDING);
  assert.equal(L(s).claimsFiled, 1n);
});

test('new holder can rotate again (chain of transfers)', () => {
  const { state, policyId, holder, newHolder } = rotated();
  const s = call(state, newHolder, 'rotateHolder', policyId, roleCommitment(holderSk, holderTag()));
  assert.equal(L(s).holderRotations, 2n);
  assert.equal(L(call(s, holder, 'proveCover', policyId, 1n)).coverProofs, 1n);
});

test('non-holder cannot rotate a policy', () => {
  const { state, policyId, holder } = setup();
  const stranger = { ...holder, sk: strangerSk };
  assert.throws(
    () => call(state, stranger, 'rotateHolder', policyId, roleCommitment(strangerSk, holderTag())),
    /does not hold/,
  );
  assert.throws(
    () => call(state, { sk: issuerSk, openings: {} }, 'rotateHolder', policyId, newHolderCommit),
    /does not hold/,
  );
});

test('rotation rejects empty or unchanged holder commitments and unknown ids', () => {
  const { state, policyId, holder } = setup();
  assert.throws(() => call(state, holder, 'rotateHolder', policyId, new Uint8Array(32)), /empty holder commitment/);
  assert.throws(
    () => call(state, holder, 'rotateHolder', policyId, roleCommitment(holderSk, holderTag())),
    /matches current holder/,
  );
  assert.throws(() => call(state, holder, 'rotateHolder', b32(), newHolderCommit), /unknown policy/);
});

test('cannot rotate while a claim is pending', () => {
  const { state, policyId, holder } = setup();
  const s = call(state, holder, 'fileClaim', policyId, b32());
  assert.throws(() => call(s, holder, 'rotateHolder', policyId, newHolderCommit), /not transferable/);
});

test('cannot rotate after payout or expiry', () => {
  const { state, policyId, holder } = setup();
  let paid = call(state, holder, 'fileClaim', policyId, b32());
  paid = call(paid, { sk: assessorSk, openings: {} }, 'resolveClaim', policyId, true);
  assert.throws(() => call(paid, holder, 'rotateHolder', policyId, newHolderCommit), /not transferable/);
  const expired = call(state, { sk: issuerSk, openings: {} }, 'expirePolicy', policyId);
  assert.throws(() => call(expired, holder, 'rotateHolder', policyId, newHolderCommit), /not transferable/);
});

/* ---------- evidence vault (packages/sdk/src/evidence.ts) ---------- */

const hex = (b) => Buffer.from(b).toString('hex');
const SEAL_NOW = new Date('2026-10-06T14:00:00Z');
const exploitInput = (policyId, over = {}) => ({
  policyId: hex(policyId),
  protocol: { name: 'Example DEX', chain: 'cardano', contracts: ['addr_test1wexampleswapvalidator'] },
  incident: {
    kind: 'logic-bug',
    description: 'Swap validator accepted a forged pool datum and the pool was drained.',
    startedAt: '2026-10-05T03:12:00Z',
    detectedAt: '2026-10-05T03:40:00Z',
  },
  txHashes: [hex(b32())],
  loss: { amount: '1250.5', asset: 'ADA' },
  createdAt: '2026-10-06T13:00:00Z',
  ...over,
});

test('SDK evidenceCommitment equals the contract pure circuit on random inputs', async () => {
  assert.equal(hex(pureCircuits.evidenceTag()), hex(Evidence.evidenceTag()));
  for (let i = 0; i < 32; i++) {
    const digest = b32();
    const salt = b32();
    assert.equal(hex(await Evidence.evidenceCommitment(digest, salt)), hex(pureCircuits.evidenceCommitment(digest, salt)));
  }
  // And the same formula as persistentHash over the raw runtime type.
  const digest = b32();
  const salt = b32();
  const rt = RT.persistentHash(new RT.CompactTypeVector(3, new RT.CompactTypeBytes(32)), [pureCircuits.evidenceTag(), digest, salt]);
  assert.equal(hex(rt), hex(await Evidence.evidenceCommitment(digest, salt)));
});

test('sealed evidence: fileClaim stores the SDK commitment; assessor verifies against the ledger, then pays', async () => {
  const { state, policyId, holder } = setup();
  const sealed = await Evidence.sealEvidence(exploitInput(policyId), { now: SEAL_NOW });
  const { policyId: id, evidenceCommitment } = Evidence.fileClaimArgs(sealed);
  assert.equal(hex(id), hex(policyId));
  // The commitment the SDK produced is the contract's own formula on (digest, salt).
  assert.equal(hex(pureCircuits.evidenceCommitment(Buffer.from(sealed.digest, 'hex'), Buffer.from(sealed.keyFile.salt, 'hex'))), sealed.commitment);

  let s = call(state, holder, 'fileClaim', id, evidenceCommitment);
  const filed = L(s).policies.lookup(policyId);
  assert.equal(filed.status, PolicyStatus.CLAIM_PENDING);
  assert.equal(hex(filed.evidence), sealed.commitment);

  // Assessor receives the two files off-ledger and checks them against the record.
  const v = await Evidence.verifyEvidence(Evidence.evidenceFileText(sealed.envelope), Evidence.evidenceFileText(sealed.keyFile), hex(filed.evidence));
  assert.equal(v.ok, true);
  assert.equal(v.bundle.loss.amount, '1250.5');

  s = call(s, { sk: assessorSk, openings: {} }, 'resolveClaim', policyId, true);
  const paid = L(s).policies.lookup(policyId);
  assert.equal(paid.status, PolicyStatus.PAID);
  assert.equal(hex(paid.evidence), sealed.commitment, 'approved claim keeps the evidence commitment');
  assert.equal((await Evidence.verifyEvidence(sealed.envelope, sealed.keyFile, hex(paid.evidence))).ok, true);
});

test('rejected evidence is cleared; a re-filed bundle gets a new commitment and the old one no longer matches', async () => {
  const { state, policyId, holder } = setup();
  const evidence = exploitInput(policyId);
  const first = await Evidence.sealEvidence(evidence, { now: SEAL_NOW });
  let s = call(state, holder, 'fileClaim', policyId, Evidence.fileClaimArgs(first).evidenceCommitment);
  s = call(s, { sk: assessorSk, openings: {} }, 'resolveClaim', policyId, false);
  assert.equal(hex(L(s).policies.lookup(policyId).evidence), '00'.repeat(32));

  // Same evidence re-sealed: fresh salt, so the ledger can't link the two filings.
  const second = await Evidence.sealEvidence(evidence, { now: SEAL_NOW });
  assert.equal(second.digest, first.digest);
  assert.notEqual(second.commitment, first.commitment);
  s = call(s, holder, 'fileClaim', policyId, Evidence.fileClaimArgs(second).evidenceCommitment);
  const onLedger = hex(L(s).policies.lookup(policyId).evidence);
  assert.equal((await Evidence.verifyEvidence(second.envelope, second.keyFile, onLedger)).ok, true);
  const stale = await Evidence.verifyEvidence(first.envelope, first.keyFile, onLedger);
  assert.equal(stale.ok, false);
  assert.equal(stale.checks.find((c) => c.id === 'ledger').ok, false);
});

