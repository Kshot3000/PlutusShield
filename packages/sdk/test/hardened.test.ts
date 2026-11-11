import { test } from "node:test";
import assert from "node:assert/strict";
import { ADA, DAY_MS, depegTrigger, productTerms, saleGuard, textHex, toCborHex, type OracleDatum } from "../src/cardano.ts";
import { USDCX_MAINNET } from "../src/assets.ts";
import {
  adaCapital,
  assetTerms,
  attests,
  canApply,
  committeeActionData,
  committeeStateData,
  coverParamsData,
  depositAllowed,
  feedOf,
  healthy,
  oracleConfigProblem,
  proposeProblem,
  refundTagData,
  triggered,
  type CommitteeState,
  type CoverParams,
  type FeedUtxo,
  type OracleConfig,
} from "../src/hardened.ts";
import { hardened } from "../src/index.ts";

// Fixtures mirror contracts/cardano/validators/cover.ak and committee.ak.
const opA = "a1".repeat(28), opB = "b2".repeat(28), opC = "c3".repeat(28);
const polA = "0aac1e".repeat(9) + "0a", polB = "0bbc1e".repeat(9) + "0b", polC = "0ccc1e".repeat(9) + "0c";
const oracle: OracleConfig = {
  feeds: [
    { name: textHex("feed-a"), policyId: polA, operator: opA },
    { name: textHex("feed-b"), policyId: polB, operator: opB },
    { name: textHex("feed-c"), policyId: polC, operator: opC },
  ],
  quorum: 2n,
};
const terms = productTerms("depeg", "B", depegTrigger(textHex("USDM")));
const T0 = 1_800_000_000_000n;

test("hardened CoverParams CBOR matches cover.ak sdk_golden_vectors", () => {
  const params: CoverParams = {
    seed: { txHash: "5eed".repeat(16), outputIndex: 0 },
    assets: [assetTerms(ADA), assetTerms(USDCX_MAINNET)],
    product: terms,
    oracle,
    claimGraceMs: 3n * DAY_MS,
    saleGuard: saleGuard(DAY_MS, 2n * 3_600_000n),
    poolMinLovelace: 2_000_000n,
  };
  assert.equal(toCborHex(coverParamsData(params)), "d8799fd8799f58205eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed00ff9fd8799fd8799f4040ff1a004c4b401a00989680ffd8799fd8799f581c1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34455553444378ff1a004c4b401a00989680ffffd8799f456465706567d8799f445553444d19251c1a05265c00ff18c81927100e19016d1903e8192328ffd8799f9fd8799f46666565642d61581c0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0a581ca1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1ffd8799f46666565642d62581c0bbc1e0bbc1e0bbc1e0bbc1e0bbc1e0bbc1e0bbc1e0bbc1e0bbc1e0b581cb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2ffd8799f46666565642d63581c0ccc1e0ccc1e0ccc1e0ccc1e0ccc1e0ccc1e0ccc1e0ccc1e0ccc1e0c581cc3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3ffff02ff1a0f731400d8799f1a05265c001a006ddd00ff1a001e8480ff");
});

test("CommitteeState / CommitteeAction CBOR match committee.ak sdk_committee_golden_vectors", () => {
  const a = (i: number) => "a55e55".repeat(9) + "0" + i;
  const old = { assessors: [a(1), a(2), a(3)], threshold: 2n };
  const next = { assessors: [a(2), a(3), a(4)], threshold: 2n };
  const delay = 7n * DAY_MS;
  assert.equal(toCborHex(committeeStateData({ current: old, pending: { next, effectiveAt: T0 + delay } })), "d8799fd8799f9f581ca55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e5501581ca55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e5502581ca55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e5503ff02ffd8799fd8799fd8799f9f581ca55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e5502581ca55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e5503581ca55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e5504ff02ff1b000001a33c68d400ffffff");
  assert.equal(toCborHex(committeeActionData({ kind: "Propose", next })), "d8799fd8799f9f581ca55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e5502581ca55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e5503581ca55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e5504ff02ffff");
  assert.equal(toCborHex(committeeStateData({ current: old })), "d8799fd8799f9f581ca55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e5501581ca55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e5502581ca55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e5503ff02ffd87a80ff");
});

test("oracle config needs 3+ distinct operators/policies and a strict majority", () => {
  assert.equal(oracleConfigProblem(oracle), null);
  const one = oracle.feeds.map((f) => ({ ...f, operator: opA }));
  assert.match(oracleConfigProblem({ feeds: one, quorum: 2n })!, /share an operator/);
  assert.match(oracleConfigProblem({ feeds: oracle.feeds.map((f) => ({ ...f, policyId: polA })), quorum: 2n })!, /share a token policy/);
  assert.match(oracleConfigProblem({ feeds: oracle.feeds.slice(0, 2), quorum: 2n })!, /at least 3/);
  assert.match(oracleConfigProblem({ ...oracle, quorum: 1n })!, /strict majority/);
  assert.match(oracleConfigProblem({ ...oracle, quorum: 4n })!, /above/);
});

const depeg = (end: bigint): OracleDatum => ({ coveredAsset: textHex("USDM"), priceBps: 9_100n, windowStart: end - DAY_MS, windowEnd: end });
const reading = (i: number, datum: OracleDatum, at = oracle.feeds[i].operator): FeedUtxo => ({
  tokens: [{ name: oracle.feeds[i].name, quantity: 1n }],
  policyId: oracle.feeds[i].policyId,
  paymentKeyHash: at,
  datum,
});
const policy = { trigger: terms.trigger, start: T0, expiry: T0 + 30n * DAY_MS };

test("feeds are authenticated by operator address; one key can't count twice", () => {
  const end = T0 + 5n * DAY_MS;
  assert.equal(feedOf(reading(0, depeg(end)), oracle), opA);
  assert.equal(feedOf(reading(0, depeg(end), opB), oracle), undefined, "feed-a token at feed-b's address");
  assert.equal(feedOf({ ...reading(0, depeg(end)), paymentKeyHash: undefined }, oracle), undefined, "script address");
  assert.ok(triggered([reading(0, depeg(end)), reading(2, depeg(end))], oracle, policy, end).ok);
  // two readings of feed-a (same operator) are one vote
  assert.ok(!triggered([reading(0, depeg(end)), reading(0, depeg(end - 1n))], oracle, policy, end).ok);
});

test("readings dated after the tx lower bound are rejected", () => {
  const end = T0 + 5n * DAY_MS;
  assert.ok(attests(depeg(end), terms.trigger, policy.start, policy.expiry, end));
  assert.ok(!attests(depeg(end), terms.trigger, policy.start, policy.expiry, end - 1n));
  assert.ok(!triggered([reading(0, depeg(end)), reading(1, depeg(end))], oracle, policy, end - 1n).ok);
  const peg = { ...depeg(end), priceBps: 10_000n };
  const all = [0, 1, 2].map((i) => reading(i, peg));
  assert.ok(healthy(all, oracle, terms.trigger, end - 3_600_000n, end).ok);
  const h = healthy(all, oracle, terms.trigger, end - 3_600_000n, end - 1n);
  assert.ok(!h.ok);
  assert.equal(h.missing.length, 3);
});

test("min deposit, pool min-ADA and refund tags", () => {
  const t = assetTerms(ADA);
  assert.equal(t.minDeposit, 10_000_000n);
  assert.ok(!depositAllowed(t, 9_999_999n));
  assert.ok(depositAllowed(t, 10_000_000n));
  assert.throws(() => assetTerms(ADA, 1_000_000n, 5n, 0n), /minDeposit/);
  assert.equal(adaCapital(2_000_000n, 2_000_000n), 0n);
  assert.equal(adaCapital(12_000_000n, 2_000_000n), 10_000_000n);
  assert.equal(adaCapital(1_000_000n, 2_000_000n), 0n);
  assert.deepEqual(refundTagData("AB".repeat(32)), { bytes: "ab".repeat(32) });
});

test("committee rotation mirrors committee.ak", () => {
  const k = (i: number) => String(i).repeat(56);
  const state: CommitteeState = { current: { assessors: [k(1), k(2), k(3)], threshold: 2n } };
  const next = { assessors: [k(2), k(3), k(4)], threshold: 2n };
  const delay = 7n * DAY_MS;
  assert.equal(proposeProblem(state, next, T0 + delay, [k(1), k(3)], T0, delay), null);
  assert.match(proposeProblem(state, next, T0 + delay, [k(1)], T0, delay)!, /1 of 2/);
  assert.match(proposeProblem(state, next, T0 + delay - 1n, [k(1), k(3)], T0, delay)!, /delay/);
  assert.match(proposeProblem(state, { assessors: [k(4), k(4)], threshold: 1n }, T0 + delay, [k(1), k(3)], T0, delay)!, /twice/);
  const pending: CommitteeState = { ...state, pending: { next, effectiveAt: T0 + delay } };
  assert.ok(!canApply(pending, T0 + delay - 1n));
  assert.ok(canApply(pending, T0 + delay));
  assert.ok(!canApply(state, T0 + delay));
  assert.equal(hardened.activeCommittee(pending), state.current);
});
