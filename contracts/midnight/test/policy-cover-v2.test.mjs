/**
 * Off-chain simulation of policy-cover-v2.compact: the registry with a
 * committee-gated claim vote (M-of-3 assessors) instead of a single assessor.
 * Uses the compiler-generated Contract class; no network, no deploy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as RT from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits, PolicyStatus } from '../src/managed/policy-cover-v2/contract/index.js';
import * as V1 from '../src/managed/policy-cover/contract/index.js';
import * as Evidence from '../../../packages/sdk/src/evidence.ts';

const COIN = '0'.repeat(64);
const ADDR = RT.sampleContractAddress();
const b32 = () => new Uint8Array(randomBytes(32));
const hex = (b) => Buffer.from(b).toString('hex');

const issuerSk = b32();
const assessorSks = [b32(), b32(), b32()];
const holderSk = b32();
const strangerSk = b32();

const { roleCommitment, coverageCommitment, registrationCommitment, holderTag, assessorTag, roundKey, voteKey } = pureCircuits;
const committee = assessorSks.map((sk) => roleCommitment(sk, assessorTag()));

const witnesses = {
  localSecretKey: ({ privateState }) => [privateState, privateState.sk],
  coverageAmount: ({ privateState }, id) => [privateState, privateState.openings[hex(id)]?.amount ?? 0n],
  coverageSalt: ({ privateState }, id) => [privateState, privateState.openings[hex(id)]?.salt ?? new Uint8Array(32)],
};
const contract = new Contract(witnesses);
const as = (sk) => ({ sk, openings: {} });
const A = assessorSks.map(as);

function deploy(m = 2n, members = committee) {
  const ctor = contract.initialState(RT.createConstructorContext(as(issuerSk), COIN), members, m);
  return ctor.currentContractState;
}
function call(state, privateState, name, ...args) {
  const ctx = RT.createCircuitContext(ADDR, COIN, state, privateState);
  return contract.impureCircuits[name](ctx, ...args).context.currentQueryContext.state;
}
const L = (state) => ledger(state);

function setup(m = 2n) {
  let state = deploy(m);
  const policyId = b32();
  const amount = 50_000_000n;
  const salt = b32();
  const holderCommit = roleCommitment(holderSk, holderTag());
  const covCommit = coverageCommitment(amount, salt);
  const cardano = registrationCommitment(policyId, holderCommit, covCommit);
  state = call(state, as(issuerSk), 'registerPolicy', policyId, holderCommit, covCommit, 1_800_000_000n, cardano);
  const holder = { sk: holderSk, openings: { [hex(policyId)]: { amount, salt } } };
  return { state, policyId, holder };
}
const status = (s, id) => L(s).policies.lookup(id).status;

test('constructor fixes a distinct 3-member committee and a 1..3 threshold', () => {
  const l = L(deploy().data);
  assert.equal(l.threshold, 2n);
  assert.deepEqual(l.assessors.map(hex), committee.map(hex));
  assert.throws(() => deploy(0n), /threshold must be 1..3/);
  assert.throws(() => deploy(4n), /threshold must be 1..3/);
  assert.throws(() => deploy(2n, [committee[0], committee[0], committee[2]]), /distinct/);
  assert.throws(() => deploy(2n, [committee[0], new Uint8Array(32), committee[2]]), /empty committee member/);
});

test('2-of-3: one approval leaves the claim pending, the second pays it', () => {
  const { state, policyId, holder } = setup();
  let s = call(state, holder, 'fileClaim', policyId, b32());
  s = call(s, A[0], 'voteClaim', policyId, true);
  assert.equal(status(s, policyId), PolicyStatus.CLAIM_PENDING);
  assert.equal(L(s).claimsPaid, 0n);
  s = call(s, A[2], 'voteClaim', policyId, true);
  assert.equal(status(s, policyId), PolicyStatus.PAID);
  const l = L(s);
  assert.equal(l.claimsPaid, 1n);
  assert.equal(l.activePolicies, 0n);
  assert.equal(l.votesCast, 2n);
  assert.equal(l.approvals.lookup(roundKey(policyId, 1n)), 2n);
});

test('votes are attributable: the ledger records who voted which way', () => {
  const { state, policyId, holder } = setup();
  let s = call(state, holder, 'fileClaim', policyId, b32());
  s = call(s, A[1], 'voteClaim', policyId, false);
  const l = L(s);
  assert.equal(l.claimVotes.lookup(voteKey(policyId, 1n, committee[1])), false);
  assert.equal(l.claimVotes.member(voteKey(policyId, 1n, committee[0])), false);
});

test('a single member cannot vote twice, and outsiders cannot vote at all', () => {
  const { state, policyId, holder } = setup();
  let s = call(state, holder, 'fileClaim', policyId, b32());
  s = call(s, A[0], 'voteClaim', policyId, true);
  assert.throws(() => call(s, A[0], 'voteClaim', policyId, true), /already voted/);
  assert.throws(() => call(s, A[0], 'voteClaim', policyId, false), /already voted/);
  for (const sk of [issuerSk, holderSk, strangerSk]) {
    assert.throws(() => call(s, as(sk), 'voteClaim', policyId, true), /not on the assessor committee/);
  }
});

test('2-of-3 rejection returns the policy to ACTIVE with evidence cleared', () => {
  const { state, policyId, holder } = setup();
  let s = call(state, holder, 'fileClaim', policyId, b32());
  s = call(s, A[0], 'voteClaim', policyId, false);
  s = call(s, A[1], 'voteClaim', policyId, true);
  assert.equal(status(s, policyId), PolicyStatus.CLAIM_PENDING, 'split 1-1 stays pending');
  s = call(s, A[2], 'voteClaim', policyId, false);
  const rec = L(s).policies.lookup(policyId);
  assert.equal(rec.status, PolicyStatus.ACTIVE);
  assert.equal(hex(rec.evidence), '00'.repeat(32));
  assert.equal(L(s).claimsRejected, 1n);
  assert.equal(L(s).activePolicies, 1n);
});

test('a re-filed claim opens a fresh round; earlier votes do not carry over', () => {
  const { state, policyId, holder } = setup();
  let s = call(state, holder, 'fileClaim', policyId, b32());
  s = call(s, A[0], 'voteClaim', policyId, true); // approve in round 1
  s = call(s, A[1], 'voteClaim', policyId, false);
  s = call(s, A[2], 'voteClaim', policyId, false); // rejected
  s = call(s, holder, 'fileClaim', policyId, b32());
  assert.equal(L(s).policies.lookup(policyId).round, 2n);
  s = call(s, A[1], 'voteClaim', policyId, true);
  assert.equal(status(s, policyId), PolicyStatus.CLAIM_PENDING, "round-1 approval from A0 doesn't count");
  s = call(s, A[0], 'voteClaim', policyId, true); // A0 may vote again in the new round
  assert.equal(status(s, policyId), PolicyStatus.PAID);
});

test('votes need a pending claim; paid or expired policies cannot be voted', () => {
  const { state, policyId, holder } = setup();
  assert.throws(() => call(state, A[0], 'voteClaim', policyId, true), /no pending claim/);
  assert.throws(() => call(state, A[0], 'voteClaim', b32(), true), /unknown policy/);
  let s = call(state, holder, 'fileClaim', policyId, b32());
  s = call(s, A[0], 'voteClaim', policyId, true);
  s = call(s, A[1], 'voteClaim', policyId, true);
  assert.throws(() => call(s, A[2], 'voteClaim', policyId, true), /no pending claim/);
  const e = setup();
  const s2 = call(e.state, as(issuerSk), 'expirePolicy', e.policyId);
  assert.throws(() => call(s2, A[0], 'voteClaim', e.policyId, true), /no pending claim/);
});

test('threshold 3 needs unanimity; threshold 1 behaves like a single assessor', () => {
  const t3 = setup(3n);
  let s = call(t3.state, t3.holder, 'fileClaim', t3.policyId, b32());
  s = call(s, A[0], 'voteClaim', t3.policyId, true);
  s = call(s, A[1], 'voteClaim', t3.policyId, true);
  assert.equal(status(s, t3.policyId), PolicyStatus.CLAIM_PENDING);
  s = call(s, A[2], 'voteClaim', t3.policyId, true);
  assert.equal(status(s, t3.policyId), PolicyStatus.PAID);
  const t1 = setup(1n);
  s = call(t1.state, t1.holder, 'fileClaim', t1.policyId, b32());
  s = call(s, A[1], 'voteClaim', t1.policyId, true);
  assert.equal(status(s, t1.policyId), PolicyStatus.PAID);
});

test('holder flows are unchanged from v1: prove, rotate, and holder-only claims', () => {
  const { state, policyId, holder } = setup();
  let s = call(state, holder, 'proveCover', policyId, 50_000_000n);
  assert.throws(() => call(s, holder, 'proveCover', policyId, 50_000_001n), /below requested minimum/);
  assert.throws(() => call(s, { ...holder, sk: strangerSk }, 'fileClaim', policyId, b32()), /does not hold/);
  const nextSk = b32();
  s = call(s, holder, 'rotateHolder', policyId, roleCommitment(nextSk, holderTag()));
  assert.throws(() => call(s, holder, 'fileClaim', policyId, b32()), /does not hold/);
  s = call(s, { ...holder, sk: nextSk }, 'fileClaim', policyId, b32());
  assert.equal(status(s, policyId), PolicyStatus.CLAIM_PENDING);
});

test('v2 keeps v1 commitment schemes byte-for-byte (SDK, Cardano datum and evidence stay valid)', async () => {
  for (let i = 0; i < 8; i++) {
    const [sk, id, h, c, d, salt] = [b32(), b32(), b32(), b32(), b32(), b32()];
    assert.equal(hex(roleCommitment(sk, assessorTag())), hex(V1.pureCircuits.roleCommitment(sk, V1.pureCircuits.assessorTag())));
    assert.equal(hex(registrationCommitment(id, h, c)), hex(V1.pureCircuits.registrationCommitment(id, h, c)));
    assert.equal(hex(pureCircuits.evidenceCommitment(d, salt)), hex(V1.pureCircuits.evidenceCommitment(d, salt)));
    assert.equal(hex(pureCircuits.evidenceCommitment(d, salt)), hex(await Evidence.evidenceCommitment(d, salt)));
  }
});
