import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_DEPEG_SCORECARD,
  LIVE_EXPLOIT_SCORECARD,
  LIVE_POOL_RISK_MULT_BPS,
  LIVE_POOL_TIER,
  LIVE_SCORECARDS,
  liveBookBreakdown,
  scoreLiveBook,
  RISK_MULTIPLIER,
  scoreRiskTier,
} from "../src/index.ts";

test("live depeg scorecard answers score to tier B at 10_000 bps", () => {
  const r = scoreLiveBook("depeg");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.tier, "B");
  assert.equal(r.tier, LIVE_POOL_TIER);
  assert.equal(r.riskMultBps, 10_000);
  assert.equal(r.riskMultBps, LIVE_POOL_RISK_MULT_BPS);
  assert.equal(r.riskMultiplier, RISK_MULTIPLIER.B);
  assert.equal(r.points, 8);
  assert.equal(r.maxPoints, 11);
});

test("live exploit scorecard answers score to tier B at 10_000 bps", () => {
  const r = scoreLiveBook("exploit");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.tier, "B");
  assert.equal(r.riskMultBps, 10_000);
  assert.equal(r.riskMultiplier, RISK_MULTIPLIER.B);
  assert.equal(r.points, 11);
  assert.equal(r.maxPoints, 15);
});

test("live exploit answers match the middling scorecard already in riskTier tests", () => {
  const middling = {
    audits: "one",
    "time-live": "12-24m",
    upgradeability: "multisig-timelock",
    "bug-bounty": "public",
    incidents: "none",
    oracle: "multi",
  };
  assert.deepEqual(LIVE_EXPLOIT_SCORECARD.answers, middling);
  const a = scoreRiskTier("exploit", middling);
  const b = scoreLiveBook("exploit");
  assert.deepEqual(a, b);
});

test("live book scorecards cover every scorecard product and break down cleanly", () => {
  for (const product of ["depeg", "exploit"] as const) {
    assert.equal(LIVE_SCORECARDS[product].product, product);
    const rows = liveBookBreakdown(product);
    assert.ok(rows.length >= 5);
    assert.ok(rows.every((row) => row.answer && row.label && row.points >= 0));
    const scored = scoreLiveBook(product);
    assert.ok(scored.ok && scored.tier === "B" && scored.riskMultBps === 10_000);
  }
  assert.match(LIVE_DEPEG_SCORECARD.whyTier, /B|band|middling/i);
  assert.match(LIVE_EXPLOIT_SCORECARD.whyTier, /InitPool|Preview|eleven/i);
});
