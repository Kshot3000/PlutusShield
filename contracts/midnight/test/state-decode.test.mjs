/**
 * The web app reads policy status straight from the indexer's serialized
 * contract state with a small string decoder (apps/web/src/lib/midnightIndexer.ts,
 * no WASM). These tests hold it to the compiled contract's own ledger() decoder:
 * every lifecycle status, ids / commitments with trailing zero bytes, small and
 * large expiries, holder rotation, and the activity-feed diff between states.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import * as RT from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits } from '../src/managed/policy-cover/contract/index.js';
import { policyRecordFromState, policyRecordsFromState, diffPolicies, stateHasPolicy } from '../../../apps/web/src/lib/midnightIndexer.ts';

const COIN = '0'.repeat(64);
const ADDR = RT.sampleContractAddress();
const hex = (b) => Buffer.from(b).toString('hex');
const b32 = () => new Uint8Array(randomBytes(32));
/** A random policy id the state scan finds unaided (no trailing zero byte); trailing-zero ids are tested on purpose below. */
const pid = () => {
  const b = b32();
  if (b[31] === 0) b[31] = 1;
  return b;
};
const STATUS = ['NONE', 'ACTIVE', 'CLAIM_PENDING', 'PAID', 'EXPIRED'];
const { roleCommitment, coverageCommitment, registrationCommitment, assessorTag, holderTag } = pureCircuits;

const witnesses = {
  localSecretKey: ({ privateState }) => [privateState, privateState.sk],
  coverageAmount: ({ privateState }) => [privateState, privateState.amount ?? 0n],
  coverageSalt: ({ privateState }) => [privateState, privateState.salt ?? new Uint8Array(32)],
};
const contract = new Contract(witnesses);

function world() {
  const issuer = { sk: b32() };
  const assessor = { sk: b32() };
  const ctor = contract.initialState(RT.createConstructorContext(issuer, COIN), roleCommitment(assessor.sk, assessorTag()));
  const cs = ctor.currentContractState;
  let data = cs.data;
  const w = {
    issuer,
    assessor,
    call(ps, name, ...args) {
      const r = contract.impureCircuits[name](RT.createCircuitContext(ADDR, COIN, data, ps), ...args);
      data = r.context.currentQueryContext.state;
    },
    hex() {
      cs.data = data;
      return hex(cs.serialize());
    },
    ledger: () => ledger(data),
    register(id, holderSk, { expiry = 1_792_521_141_000n, holder, coverage } = {}) {
      const h = holder ?? roleCommitment(holderSk, holderTag());
      const c = coverage ?? coverageCommitment(50_000_000n, b32());
      w.call(issuer, 'registerPolicy', id, h, c, expiry, registrationCommitment(id, h, c));
    },
  };
  return w;
}

function assertMatchesLedger(w, extraIds = []) {
  const s = w.hex();
  const l = w.ledger();
  const ids = [];
  for (const [k, v] of l.policies) {
    const id = hex(k);
    ids.push(id);
    const r = policyRecordFromState(s, id);
    assert.ok(r, `decoder finds ${id.slice(0, 12)}`);
    assert.equal(r.status, STATUS[Number(v.status)]);
    assert.equal(r.holder, hex(v.holder));
    assert.equal(r.coverage, hex(v.coverage));
    assert.equal(r.expiry, Number(v.expiry)); // ms timestamps are far below 2^53
    assert.equal(r.evidence, /^0+$/.test(hex(v.evidence)) ? null : hex(v.evidence));
    assert.ok(stateHasPolicy(s, id));
  }
  // The scan finds ids without a trailing zero byte by itself; callers pass the rest (random ids hit this 1 time in 256).
  const all = policyRecordsFromState(s, [...extraIds, ...ids.filter((id) => id.endsWith('00'))]).map((r) => r.policyId).sort();
  assert.deepEqual(all, ids.slice().sort());
  return s;
}

test('state decoder agrees with ledger() through the whole claim lifecycle', () => {
  const w = world();
  const holder = b32();
  const id = pid();
  w.register(id, holder);
  const s0 = assertMatchesLedger(w);
  const ev = b32();
  w.call({ sk: holder }, 'fileClaim', id, ev);
  const s1 = assertMatchesLedger(w);
  assert.equal(policyRecordFromState(s1, hex(id)).status, 'CLAIM_PENDING');
  assert.equal(policyRecordFromState(s1, hex(id)).evidence, hex(ev));
  assert.deepEqual(diffPolicies(s0, s1), [{ policyId: hex(id), from: 'ACTIVE', to: 'CLAIM_PENDING', evidence: hex(ev) }]);
  w.call(w.assessor, 'resolveClaim', id, false);
  const s2 = assertMatchesLedger(w);
  assert.deepEqual(diffPolicies(s1, s2), [{ policyId: hex(id), from: 'CLAIM_PENDING', to: 'ACTIVE', evidence: null }]);
  w.call({ sk: holder }, 'fileClaim', id, ev);
  const s3 = w.hex();
  w.call(w.assessor, 'resolveClaim', id, true);
  const s4 = assertMatchesLedger(w);
  assert.deepEqual(diffPolicies(s3, s4), [{ policyId: hex(id), from: 'CLAIM_PENDING', to: 'PAID', evidence: hex(ev) }]);
  // a second policy expires
  const id2 = pid();
  w.register(id2, b32());
  const s5 = w.hex();
  assert.deepEqual(diffPolicies(s4, s5).map((c) => [c.from, c.to]), [['NONE', 'ACTIVE']]);
  w.call(w.issuer, 'expirePolicy', id2);
  const s6 = assertMatchesLedger(w);
  assert.equal(policyRecordFromState(s6, hex(id2)).status, 'EXPIRED');
});

test('trailing zero bytes, odd expiries, rotation, many policies', () => {
  const w = world();
  const expiries = [0n, 1n, 0x3fn, 0x40n, 0xffn, 0x100n, 1_792_521_141_000n, 2n ** 64n - 1n];
  const zeroTail = [];
  for (let i = 0; i < 24; i++) {
    const id = b32();
    if (i % 3 === 0) id.fill(0, 30); // id with trailing zeros
    // Random ids end in a zero byte 1 time in 256 too; the scan needs those passed in as well.
    if (id[31] === 0) zeroTail.push(hex(id));
    const holder = b32();
    const h = roleCommitment(holder, holderTag());
    const cov = b32();
    if (i % 4 === 1) cov.fill(0, 31);
    const hc = i % 5 === 2 ? Uint8Array.from([...h.slice(0, 31), 0]) : h;
    w.register(id, holder, { expiry: expiries[i % expiries.length], holder: hc, coverage: cov });
    if (i % 5 !== 2 && i % 2 === 0) {
      const ev = b32();
      if (i % 4 === 0) ev.fill(0, 28);
      w.call({ sk: holder }, 'fileClaim', id, ev);
      if (i % 8 === 0) w.call(w.assessor, 'resolveClaim', id, i % 16 === 0);
    } else if (i % 5 !== 2 && i % 7 === 1) {
      const before = w.hex();
      w.call({ sk: holder }, 'rotateHolder', id, b32());
      const ch = diffPolicies(before, w.hex(), zeroTail);
      assert.equal(ch.length, 1);
      assert.equal(ch[0].from, ch[0].to);
    }
  }
  assertMatchesLedger(w, zeroTail);
});

test('live Preprod state fixtures decode like ledger()', () => {
  const dir = new URL('./fixtures/', import.meta.url);
  const files = readdirSync(dir).filter((f) => /^preprod-state-.*\.hex$/.test(f));
  assert.ok(files.length > 0, 'at least one live Preprod state fixture');
  for (const f of files) {
    const s = readFileSync(new URL(f, dir), 'utf8').trim();
    const l = ledger(RT.ContractState.deserialize(new Uint8Array(Buffer.from(s, 'hex'))).data);
    let n = 0;
    for (const [k, v] of l.policies) {
      const r = policyRecordFromState(s, hex(k));
      assert.ok(r, `${f}: ${hex(k).slice(0, 12)}`);
      assert.equal(r.status, STATUS[Number(v.status)], `${f}: status`);
      assert.equal(r.evidence, /^0+$/.test(hex(v.evidence)) ? null : hex(v.evidence));
      n++;
    }
    assert.equal(policyRecordsFromState(s).length, n, `${f}: policy count`);
  }
});

test('live Preprod claims drill: diffs between consecutive states name the policy and outcome', () => {
  const st = (h) => readFileSync(new URL(`./fixtures/preprod-state-${h}.hex`, import.meta.url), 'utf8').trim();
  const A = '72512facd0a8eb5257888b8f3b0ee71b774862cc7f4c7d7cc4f124c6f6d745d0';
  const B = 'a33af8052854e2b4b32bff59afcb652dc0240bcb19b231314685bfaed13b2b3d';
  const evA = 'ca7e8da3bd36b464fcf670687f690d8e2276c08d694773c88d7ced5399622b30';
  const evB = 'dcdd60be82a7f163ac38021a477b1bd84e3f0442cdcbb4d7e3243caecaa13721';
  assert.deepEqual(diffPolicies(st(2866511), st(2867361)), [{ policyId: A, from: 'ACTIVE', to: 'CLAIM_PENDING', evidence: evA }]); // fileClaim
  assert.deepEqual(diffPolicies(st(2867361), st(2867365)), [{ policyId: A, from: 'CLAIM_PENDING', to: 'PAID', evidence: evA }]); // resolveClaim(approve)
  assert.deepEqual(diffPolicies(st(2867365), st(2867368)), [{ policyId: B, from: 'ACTIVE', to: 'CLAIM_PENDING', evidence: evB }]); // fileClaim
  assert.deepEqual(diffPolicies(st(2867368), st(2867372)), [{ policyId: B, from: 'CLAIM_PENDING', to: 'ACTIVE', evidence: null }]); // resolveClaim(reject)
});

test('live Preprod policy-cover v2 states (6-field record with claim round) decode like the v2 ledger()', async () => {
  const V2 = await import('../src/managed/policy-cover-v2/contract/index.js');
  const dir = new URL('./fixtures/', import.meta.url);
  const files = readdirSync(dir).filter((f) => /^preprod-v2-state-.*\.hex$/.test(f));
  assert.ok(files.length > 0, 'at least one live v2 state fixture');
  for (const f of files) {
    const s = readFileSync(new URL(f, dir), 'utf8').trim();
    const l = V2.ledger(RT.ContractState.deserialize(new Uint8Array(Buffer.from(s, 'hex'))).data);
    let n = 0;
    for (const [k, v] of l.policies) {
      const r = policyRecordFromState(s, hex(k));
      assert.ok(r, `${f}: ${hex(k).slice(0, 12)}`);
      assert.equal(r.status, STATUS[Number(v.status)], `${f}: status`);
      assert.equal(r.evidence, /^0+$/.test(hex(v.evidence)) ? null : hex(v.evidence), `${f}: evidence`);
      assert.equal(r.round, Number(v.round), `${f}: round`);
      assert.equal(r.expiry, Number(v.expiry), `${f}: expiry`);
      n++;
    }
    assert.equal(policyRecordsFromState(s).length, n, `${f}: policy count`);
  }
});

test('live Preprod v2 split vote: only fileClaim and the deciding vote change the record', () => {
  const st = (h) => readFileSync(new URL(`./fixtures/preprod-v2-state-${h}.hex`, import.meta.url), 'utf8').trim();
  const P = '7c24be86268f54972c49f6f6e4ec10be6c59506e4c28d3869d33635979468ccb';
  const ev = '013e08ebfbf6fed7ca23edd20c02296d1043ac1fe10466745642dd9add996ac1';
  assert.deepEqual(diffPolicies(st(2870317), st(2870321)), [{ policyId: P, from: 'NONE', to: 'ACTIVE', evidence: null }]); // registerPolicy
  assert.deepEqual(diffPolicies(st(2870325), st(2870329)), [{ policyId: P, from: 'ACTIVE', to: 'CLAIM_PENDING', evidence: ev }]); // fileClaim
  assert.deepEqual(diffPolicies(st(2870329), st(2870333)), []); // seat 0 approve: 1 of 2, still pending
  assert.deepEqual(diffPolicies(st(2870333), st(2870337)), []); // seat 1 reject: 1 approve / 1 reject
  assert.deepEqual(diffPolicies(st(2870337), st(2870341)), [{ policyId: P, from: 'CLAIM_PENDING', to: 'PAID', evidence: ev }]); // seat 2 approve: 2-of-3 -> PAID
});
