import { test } from "node:test";
import assert from "node:assert/strict";
import { makePolicyKey } from "../src/midnight.ts";
import {
  MIDNIGHT_BINDING_SINCE_MS,
  MIDNIGHT_TICKET_LABEL,
  blockTimeMs,
  classifyMirror,
  mirrorSummary,
  parseTicket,
  ticketMetadata,
  ticketOpensDatum,
} from "../src/relay.ts";
import * as index from "../src/index.ts";

const POLICY = "ab".repeat(32);
const key = () => makePolicyKey({ network: "preview", policyId: POLICY, coverage: 25_000_000n, expiry: 1_800_000_000_000n });
const AFTER = MIDNIGHT_BINDING_SINCE_MS + 60_000;

test("ticket metadata round-trips through Koios and Blockfrost shapes", async () => {
  const k = await key();
  const md = ticketMetadata(k);
  assert.deepEqual(md, { v: 1, p: k.policyId, h: k.holderCommitment, c: k.coverageCommitment });
  for (const s of [md.p, md.h, md.c]) assert.ok(new TextEncoder().encode(s).length <= 64, "metadata strings fit 64 bytes");
  const want = { policyId: k.policyId, holderCommitment: k.holderCommitment, coverageCommitment: k.coverageCommitment };
  assert.deepEqual(parseTicket({ [MIDNIGHT_TICKET_LABEL]: md }), want);
  assert.deepEqual(parseTicket([{ label: "674", json_metadata: { msg: ["x"] } }, { label: String(MIDNIGHT_TICKET_LABEL), json_metadata: md }]), want);
  assert.ok(await ticketOpensDatum(want, { policyId: k.policyId, midnightCommitment: k.registrationCommitment }));
  // The ticket carries no secrets.
  assert.ok(!JSON.stringify(md).includes(k.holderSecret) && !JSON.stringify(md).includes(k.coverageSalt));
  assert.equal(index.MIDNIGHT_TICKET_LABEL, MIDNIGHT_TICKET_LABEL);
});

test("parseTicket rejects missing, malformed and wrong-version tickets", () => {
  assert.equal(parseTicket(null), null);
  assert.equal(parseTicket({}), null);
  assert.equal(parseTicket({ "674": { msg: ["hi"] } }), null);
  assert.equal(parseTicket({ [MIDNIGHT_TICKET_LABEL]: { v: 2, p: POLICY, h: POLICY, c: POLICY } }), null);
  assert.equal(parseTicket({ [MIDNIGHT_TICKET_LABEL]: { v: 1, p: POLICY, h: "zz", c: POLICY } }), null);
  assert.equal(parseTicket([{ label: String(MIDNIGHT_TICKET_LABEL) }]), null);
  assert.throws(() => ticketMetadata({ policyId: "00", holderCommitment: POLICY, coverageCommitment: POLICY }));
});

test("a ticket that doesn't open the datum is never usable", async () => {
  const k = await key();
  const other = await key();
  const datum = { policyId: k.policyId, midnightCommitment: k.registrationCommitment };
  // Another key's commitments, a swapped pair, and a replay under another policy id all fail.
  assert.equal(await ticketOpensDatum({ policyId: k.policyId, holderCommitment: other.holderCommitment, coverageCommitment: k.coverageCommitment }, datum), false);
  assert.equal(await ticketOpensDatum({ policyId: k.policyId, holderCommitment: k.coverageCommitment, coverageCommitment: k.holderCommitment }, datum), false);
  assert.equal(await ticketOpensDatum({ policyId: "cd".repeat(32), holderCommitment: k.holderCommitment, coverageCommitment: k.coverageCommitment }, datum), false);
  const e = await classifyMirror({ ...datum, blockTime: AFTER, mirrored: false, ticket: { policyId: k.policyId, holderCommitment: other.holderCommitment, coverageCommitment: other.coverageCommitment } });
  assert.deepEqual(e, { policyId: k.policyId, state: "awaiting-key", source: null, canProve: false, badTicket: true });
});

test("classifyMirror: mirrored, ready (ticket / key), awaiting-key, pre-binding", async () => {
  const k = await key();
  const d = { policyId: k.policyId, midnightCommitment: k.registrationCommitment };
  const ticket = parseTicket({ [MIDNIGHT_TICKET_LABEL]: ticketMetadata(k) });
  assert.equal((await classifyMirror({ ...d, blockTime: AFTER, mirrored: true, ticket })).state, "mirrored");
  const viaTicket = await classifyMirror({ ...d, blockTime: AFTER, mirrored: false, ticket });
  assert.deepEqual([viaTicket.state, viaTicket.source, viaTicket.canProve], ["ready", "ticket", false]);
  const viaKey = await classifyMirror({ ...d, blockTime: AFTER, mirrored: false, ticket, keyOpensDatum: true });
  assert.deepEqual([viaKey.state, viaKey.source, viaKey.canProve], ["ready", "key", true]);
  assert.equal((await classifyMirror({ ...d, blockTime: AFTER, mirrored: false })).state, "awaiting-key");
  assert.equal((await classifyMirror({ ...d, blockTime: null, mirrored: false })).state, "awaiting-key", "unknown time is not assumed pre-binding");
  // Koios block_time is in seconds.
  assert.equal((await classifyMirror({ ...d, blockTime: Math.floor((MIDNIGHT_BINDING_SINCE_MS - 3_600_000) / 1000), mirrored: false })).state, "pre-binding");
  // A pre-binding-era policy that is somehow mirrored or ticketed is reported as such, not hidden.
  assert.equal((await classifyMirror({ ...d, blockTime: 1, mirrored: false, ticket })).state, "ready");
  assert.equal(blockTimeMs(1_759_771_200), 1_759_771_200_000);
  assert.equal(blockTimeMs(1_759_771_200_000), 1_759_771_200_000);
  assert.deepEqual(mirrorSummary([{ state: "mirrored" }, { state: "ready" }, { state: "pre-binding" }, { state: "pre-binding" }]), {
    total: 4, mirrored: 1, ready: 1, "awaiting-key": 0, "pre-binding": 2, mirrorable: 2,
  });
});
