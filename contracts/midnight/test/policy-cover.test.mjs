/**
 * Off-chain simulation of policy-cover.compact using the compiler-generated
 * Contract class and @midnight-ntwrk/compact-runtime. No network, no deploy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as RT from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits, PolicyStatus } from '../src/managed/policy-cover/contract/index.js';

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
