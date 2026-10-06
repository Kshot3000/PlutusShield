// Relay plan (relay/plan.ts) against real public Cardano Preview data, with Koios mocked.
// Fixture: the cover script's UTxOs on 2026-10-06, including 8 pre-binding policies,
// the first bound policy (mirrored on Preprod) and two Buys that carry registration tickets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildRelayPlan, publicEntry, localPolicyKeys } from '../relay/plan.ts';
import { makePolicyKey } from '../../../packages/sdk/src/midnight.ts';
import { MIDNIGHT_TICKET_LABEL, mirrorSummary } from '../../../packages/sdk/src/relay.ts';

const here = path.dirname(new URL(import.meta.url).pathname);
const fixture = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/preview-utxos.json'), 'utf8'));
const deployment = JSON.parse(fs.readFileSync(path.join(here, '../../../apps/web/src/data/preview-deployment.json'), 'utf8'));

const MIRRORED = '72512facd0a8eb5257888b8f3b0ee71b774862cc7f4c7d7cc4f124c6f6d745d0';
// Real tickets, as published on Preview (public tx metadata).
const TICKETS = {
  '1e70f0895de64c50dbbc39df0e8d23af362a29e476d1bdfb1e2068ff780f321f': {
    v: 1, p: 'a33af8052854e2b4b32bff59afcb652dc0240bcb19b231314685bfaed13b2b3d',
    h: '49fbea54ed81af2b3f9711154818db0278c75405a264ad5db2d64dd08b3d51f6', c: 'fe69fb50cabd857ae5284256473b9654de9ab947456abb8c97be3b2794233a5a',
  },
  '94c4dc052711c6eec5b2942da768b151b9f1dd9519cf11bcd55982a6bd1325ff': {
    v: 1, p: '7c24be86268f54972c49f6f6e4ec10be6c59506e4c28d3869d33635979468ccb',
    h: 'fe435e1c70aed663e72ba011d9bb99b91f6c86081854ff67a0bf785d8ece5340', c: '9ff196e70b23ec063eca9b73075d835b263fbead076f2b0c6dd6f518cc2f46ab',
  },
};

function mockKoios(tickets = TICKETS) {
  const calls = [];
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(url.split('/').pop());
    if (url.endsWith('/address_utxos')) {
      assert.deepEqual(body._addresses, [deployment.address]);
      return new Response(JSON.stringify(fixture.utxos), { status: 200 });
    }
    if (url.endsWith('/tx_metadata')) {
      return new Response(JSON.stringify(body._tx_hashes.map((h) => ({ tx_hash: h, metadata: tickets[h] ? { [MIDNIGHT_TICKET_LABEL]: tickets[h] } : null }))), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  return { f, calls };
}

test('classifies every live Preview policy from chain data', async () => {
  const { f } = mockKoios();
  const plan = await buildRelayPlan({ deployment, fetch: f, isMirrored: (id) => id === MIRRORED });
  const s = mirrorSummary(plan);
  assert.deepEqual(s, { total: 11, mirrored: 1, ready: 2, 'awaiting-key': 0, 'pre-binding': 8, mirrorable: 3 });
  const ready = plan.filter((e) => e.state === 'ready');
  assert.deepEqual(new Set(ready.map((e) => e.policyId)), new Set(Object.values(TICKETS).map((t) => t.p)));
  assert.ok(ready.every((e) => e.source === 'ticket' && !e.canProve && e.keyFile === null), 'no local keys: register only');
  // Oldest first.
  for (let i = 1; i < plan.length; i++) assert.ok((plan[i - 1].blockTime ?? 0) <= (plan[i].blockTime ?? 0));
  // The public view carries no ticket, key or secret.
  for (const e of plan) assert.deepEqual(Object.keys(publicEntry(e)).sort(), ['badTicket', 'blockTime', 'buyTx', 'canProve', 'policyId', 'source', 'state', 'tranche']);
});

test('a forged ticket is reported and ignored; a mirrored policy is not re-planned', async () => {
  const [hash, t] = Object.entries(TICKETS)[0];
  const forged = { ...TICKETS, [hash]: { ...t, h: 'ee'.repeat(32) } };
  const plan = await buildRelayPlan({ deployment, fetch: mockKoios(forged).f, isMirrored: (id) => id === MIRRORED || id === TICKETS[Object.keys(TICKETS)[1]].p });
  const e = plan.find((x) => x.policyId === t.p);
  assert.equal(e.state, 'awaiting-key');
  assert.equal(e.badTicket, true);
  assert.equal(e.ticket, null);
  assert.equal(plan.filter((x) => x.state === 'ready').length, 0);
  assert.equal(plan.filter((x) => x.state === 'mirrored').length, 2);
});

test('local keys: only plain policy-key files that open the datum count', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-keys-'));
  // A well-formed key for a real policy id whose secrets do NOT open that datum: must not make it provable.
  const wrong = await makePolicyKey({ network: 'preview', policyId: TICKETS[Object.keys(TICKETS)[0]].p, coverage: 20_000_000n, expiry: 1n });
  fs.writeFileSync(path.join(dir, `${wrong.policyId}.json`), JSON.stringify(wrong));
  fs.writeFileSync(path.join(dir, 'junk.json'), '{"schema":"something-else"}');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignore me');
  assert.equal(localPolicyKeys([dir, path.join(dir, 'missing')]).size, 1);
  const plan = await buildRelayPlan({ deployment, fetch: mockKoios().f, keyDirs: [dir], isMirrored: () => false });
  const e = plan.find((x) => x.policyId === wrong.policyId);
  assert.deepEqual([e.state, e.source, e.canProve, e.keyFile], ['ready', 'ticket', false, null], 'falls back to the ticket, never the bad key');
  fs.rmSync(dir, { recursive: true });
});

test('fails closed when Koios is down', async () => {
  const f = async () => new Response('down', { status: 503 });
  await assert.rejects(buildRelayPlan({ deployment, fetch: f, isMirrored: () => false, retryMs: 1 }), /Koios address_utxos: 503/);
});
