/**
 * The claim relay's pure half (relay/claims.ts): argv parsing and the
 * assessor's off-ledger gate before resolveClaim, with real sealed bundles
 * from the SDK evidence vault and the compiled contract's evidenceCommitment.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pureCircuits } from '../src/managed/policy-cover/contract/index.js';
import { parseClaimOps, sealEvidenceFile, saveSealed, assessClaim, loadFiling } from '../relay/claims.ts';
import { evidenceFileText } from '../../../packages/sdk/src/evidence.ts';

const A = '72512facd0a8eb5257888b8f3b0ee71b774862cc7f4c7d7cc4f124c6f6d745d0';
const B = 'a33af8052854e2b4b32bff59afcb652dc0240bcb19b231314685bfaed13b2b3d';
const DEMO = new URL('../preprod/demo-evidence/approve-72512fac.json', import.meta.url).pathname;
const DEMO_B = new URL('../preprod/demo-evidence/reject-a33af805.json', import.meta.url).pathname;
const hex = (b) => Buffer.from(b).toString('hex');

test('parseClaimOps: chained claim + resolve in argv order', () => {
  const ops = parseClaimOps(['--claim', A, '--evidence', 'a.json', '--resolve', A, '--approve', '--claim', B.toUpperCase(), '--evidence', 'b.json', '--resolve', B, '--reject']);
  assert.deepEqual(ops, [
    { kind: 'claim', policyId: A, evidence: 'a.json' },
    { kind: 'resolve', policyId: A, approved: true },
    { kind: 'claim', policyId: B, evidence: 'b.json' },
    { kind: 'resolve', policyId: B, approved: false },
  ]);
  assert.deepEqual(parseClaimOps(['--all']), []);
});

test('parseClaimOps: refuses ambiguous requests', () => {
  assert.throws(() => parseClaimOps(['--claim', A]), /needs --evidence/);
  assert.throws(() => parseClaimOps(['--claim', 'abc', '--evidence', 'x']), /64 hex/);
  assert.throws(() => parseClaimOps(['--resolve', A]), /--approve or --reject/);
  assert.throws(() => parseClaimOps(['--resolve', A, '--approve', '--reject']), /exactly one/);
  assert.throws(() => parseClaimOps(['--evidence', 'x']), /must follow --claim/);
  assert.throws(() => parseClaimOps(['--approve']), /must follow --resolve/);
  assert.throws(() => parseClaimOps(['--resolve', A, '--approve', '--envelope', 'e.json']), /go together/);
});

test('demo evidence seals with a fresh salt and the contract commitment', async () => {
  const now = new Date('2026-10-06T20:00:00Z');
  const s1 = await sealEvidenceFile(DEMO, A, now);
  const s2 = await sealEvidenceFile(DEMO, A, now);
  assert.equal(s1.digest, s2.digest, 'same canonical bundle bytes');
  assert.notEqual(s1.commitment, s2.commitment, 'fresh salt per filing');
  assert.match(s1.bundle.protocol.name, /DEMO/);
  const onchain = hex(pureCircuits.evidenceCommitment(Buffer.from(s1.digest, 'hex'), Buffer.from(s1.keyFile.salt, 'hex')));
  assert.equal(onchain, s1.commitment);
  await assert.rejects(sealEvidenceFile(DEMO, B), /names policy/);
  await sealEvidenceFile(DEMO_B, B);
});

test('assessClaim gates resolveClaim on the on-ledger commitment', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps-claims-'));
  const sealed = await sealEvidenceFile(DEMO, A);
  const p = saveSealed(dir, sealed);
  assert.equal(statSync(p.keyFile).mode & 0o777, 0o600);
  const files = loadFiling(dir, { kind: 'resolve', policyId: A, approved: true }, sealed.commitment);
  const pending = { status: 'CLAIM_PENDING', evidence: sealed.commitment };

  const ok = await assessClaim({ policyId: A, ledger: pending, ...files });
  assert.equal(ok.ok, true);
  assert.equal(ok.commitment, sealed.commitment);
  assert.equal(ok.summary.loss, '50 tADA');

  assert.equal((await assessClaim({ policyId: A, ledger: null, ...files })).ok, false);
  assert.match((await assessClaim({ policyId: A, ledger: { ...pending, status: 'ACTIVE' }, ...files })).reason, /not CLAIM_PENDING/);
  // a different filing on the ledger (e.g. re-filed with a new salt) is not this bundle
  const other = await sealEvidenceFile(DEMO, A);
  assert.match((await assessClaim({ policyId: A, ledger: { ...pending, evidence: other.commitment }, ...files })).reason, /on-ledger commitment/);
  // tampered ciphertext
  const env = JSON.parse(files.envelopeText);
  env.ciphertext = env.ciphertext.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'));
  assert.equal((await assessClaim({ policyId: A, ledger: pending, envelopeText: JSON.stringify(env), keyFileText: files.keyFileText })).ok, false);
  // wrong key file
  const p2 = saveSealed(dir, other);
  assert.equal((await assessClaim({ policyId: A, ledger: pending, envelopeText: files.envelopeText, keyFileText: readFileSync(p2.keyFile, 'utf8') })).ok, false);
  // missing files
  assert.throws(() => loadFiling(dir, { kind: 'resolve', policyId: A, approved: true }, 'ab'.repeat(32)), /no evidence bundle/);
  writeFileSync(join(dir, 'x.json'), evidenceFileText(sealed.envelope));
});
