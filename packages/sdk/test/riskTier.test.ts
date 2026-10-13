import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreRiskTier, maxScorecardPoints, SCORECARD_CRITERIA, RISK_MULTIPLIER } from "../src/index.ts";

const best = (p: "depeg" | "exploit") =>
  Object.fromEntries(SCORECARD_CRITERIA[p].map((c) => [c.id, c.options.reduce((a, b) => (b.points > a.points ? b : a)).value]));

test("max points per product", () => {
  assert.equal(maxScorecardPoints("exploit"), 15);
  assert.equal(maxScorecardPoints("depeg"), 11);
});

test("best answers reach tier A at the A multiplier", () => {
  for (const p of ["depeg", "exploit"] as const) {
    const r = scoreRiskTier(p, best(p));
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.tier, "A");
    assert.equal(r.riskMultBps, 8_000);
    assert.equal(r.riskMultiplier, RISK_MULTIPLIER.A);
  }
});

test("a hard stop declines cover however high the rest scores", () => {
  const r = scoreRiskTier("exploit", { ...best("exploit"), audits: "none" });
  assert.equal(r.ok, false);
  if (r.ok || !r.declined) return assert.fail("expected decline");
  assert.match(r.reasons[0], /audit/);
});

test("depeg needs three venues for the oracle quorum", () => {
  const r = scoreRiskTier("depeg", { ...best("depeg"), venues: "lt-3" });
  assert.ok(!r.ok && r.declined);
});

test("a single admin key caps an otherwise tier A protocol at C", () => {
  const r = scoreRiskTier("exploit", { ...best("exploit"), upgradeability: "admin-key" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.uncappedTier, "A");
  assert.equal(r.tier, "C");
  assert.equal(r.riskMultBps, 15_000);
  assert.equal(r.caps.length, 1);
});

test("single price source caps at B but does not lift a C", () => {
  const capped = scoreRiskTier("exploit", { ...best("exploit"), oracle: "single" });
  assert.ok(capped.ok && capped.tier === "B");
  const low = scoreRiskTier("exploit", {
    audits: "one", "time-live": "3-12m", upgradeability: "multisig-timelock", "bug-bounty": "none", incidents: "remediated", oracle: "single",
  });
  assert.ok(low.ok);
  if (!low.ok) return;
  assert.equal(low.points, 6);
  assert.equal(low.tier, "C");
});

test("a middling exploit scorecard lands at tier B, the live pools' tier", () => {
  const r = scoreRiskTier("exploit", {
    audits: "one", "time-live": "12-24m", upgradeability: "multisig-timelock", "bug-bounty": "public", incidents: "none", oracle: "multi",
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.points, 11);
  assert.equal(r.tier, "B");
  assert.equal(r.riskMultBps, 10_000);
});

test("below the C floor is declined", () => {
  const r = scoreRiskTier("exploit", {
    audits: "one", "time-live": "lt-3m", upgradeability: "admin-key", "bug-bounty": "none", incidents: "remediated", oracle: "single",
  });
  assert.ok(!r.ok && r.declined);
  if (r.ok || !r.declined) return;
  assert.equal(r.points, 3);
  assert.match(r.reasons[0], /floor/);
});

test("the weakest depeg scorecard without a hard stop still clears the C floor", () => {
  const r = scoreRiskTier("depeg", { backing: "overcollateralized", redemption: "none", venues: "3", age: "lt-6m", "peg-history": "recovered" });
  assert.ok(r.ok && r.tier === "C" && r.points === 4);
});

test("missing answers are reported, not scored", () => {
  const r = scoreRiskTier("exploit", { audits: "one" });
  assert.ok(!r.ok && !r.declined);
  if (r.ok || r.declined) return;
  assert.equal(r.missing.length, 5);
});
