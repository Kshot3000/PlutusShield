import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SINGLE_POLICY_SHARE,
  MAX_UTILIZATION,
  PLAN_SHARE_MAX_EXPOSURES,
  decodePlanShare,
  encodePlanShare,
  planCover,
  planShareQuery,
  quote,
} from "../src/index.ts";

const pool = { capital: 10_000, activeCover: 0 };

test("a small exposure becomes one policy priced exactly like quote()", () => {
  const plan = planCover({
    exposures: [{ id: "usdm", label: "USDM in wallet", product: "depeg", amount: 500 }],
    days: 90,
    riskTier: "B",
    pools: { depeg: pool },
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.policies.length, 1);
  const q = quote({ product: "depeg", coverAmount: 500, days: 90, riskTier: "B", pool });
  assert.ok(q.ok);
  assert.equal(plan.policies[0].premium, q.premium);
  assert.equal(plan.exposures[0].status, "covered");
  assert.equal(plan.totals.coverageRatio, 1);
  assert.equal(plan.totals.uncovered, 0);
});

test("an exposure above the single-policy cap splits into capped policies", () => {
  const plan = planCover({
    exposures: [{ id: "lp", label: "Minswap LP", product: "exploit", amount: 2_500 }],
    days: 60,
    riskTier: "B",
    pools: { exploit: pool },
  });
  const cap = pool.capital * MAX_SINGLE_POLICY_SHARE;
  assert.deepEqual(plan.policies.map((p) => p.coverAmount), [cap, cap, 500]);
  assert.equal(plan.exposures[0].status, "covered");
  assert.match(plan.exposures[0].note ?? "", /Split into 3 policies/);
});

test("later policies on the same tranche price on the utilization earlier ones left", () => {
  const plan = planCover({
    exposures: [
      { id: "a", label: "A", product: "depeg", amount: 1_000 },
      { id: "b", label: "B", product: "depeg", amount: 1_000 },
    ],
    days: 180,
    riskTier: "B",
    pools: { depeg: pool },
  });
  const [a, b] = plan.policies;
  assert.ok(b.annualRate > a.annualRate, "second policy is priced higher");
  const q = quote({ product: "depeg", coverAmount: 1_000, days: 180, riskTier: "B", pool: { capital: 10_000, activeCover: 1_000 } });
  assert.ok(q.ok);
  assert.equal(b.premium, q.premium);
});

test("nothing is planned past the 90% utilization cap; the rest is reported uncovered", () => {
  const busy = { capital: 10_000, activeCover: 8_500 };
  const plan = planCover({
    exposures: [{ id: "big", label: "Big", product: "depeg", amount: 2_000 }],
    days: 30,
    riskTier: "B",
    pools: { depeg: busy },
  });
  const room = busy.capital * MAX_UTILIZATION - busy.activeCover;
  assert.equal(plan.totals.covered, room);
  assert.equal(plan.totals.uncovered, 2_000 - room);
  assert.equal(plan.exposures[0].status, "partial");
  assert.ok(plan.policies.every((p) => p.utilizationAfter <= MAX_UTILIZATION + 1e-9));
});

test("SLA cover is never planned as a buy; its target stays uncovered with the blocker", () => {
  const plan = planCover({
    exposures: [{ id: "sla", label: "DEX uptime", product: "sla", amount: 300 }],
    days: 30,
    riskTier: "B",
    pools: { sla: pool },
  });
  assert.equal(plan.policies.length, 0);
  assert.equal(plan.exposures[0].status, "not-buyable");
  assert.match(plan.exposures[0].note ?? "", /uptime oracle/);
  assert.equal(plan.totals.uncovered, 300);
});

test("protectShare, missing pools and bad terms are handled per exposure", () => {
  const plan = planCover({
    exposures: [
      { id: "half", label: "Half", product: "depeg", amount: 800, protectShare: 0.5 },
      { id: "nopool", label: "No pool", product: "exploit", amount: 100 },
      { id: "bad", label: "Bad", product: "depeg", amount: -5 },
    ],
    days: 30,
    riskTier: "A",
    pools: { depeg: pool, exploit: null },
  });
  const [half, nopool, bad] = plan.exposures;
  assert.equal(half.target, 400);
  assert.equal(half.covered, 400);
  assert.equal(nopool.status, "no-capacity");
  assert.equal(bad.status, "invalid");
  assert.equal(plan.totals.atRisk, 900);
  assert.equal(plan.totals.target, 500);
});

test("terms outside a product's range are refused for that product only", () => {
  const plan = planCover({
    exposures: [
      { id: "d", label: "Depeg", product: "depeg", amount: 100 },
      { id: "x", label: "Exploit", product: "exploit", amount: 100 },
    ],
    days: 20,
    riskTier: "B",
    pools: { depeg: pool, exploit: pool },
  });
  assert.equal(plan.exposures[0].status, "covered");
  assert.equal(plan.exposures[1].status, "invalid");
  assert.match(plan.exposures[1].note ?? "", /30–365 days/);
});

test("whole-plan errors: non-integer term and duplicate ids", () => {
  assert.equal(planCover({ exposures: [], days: 1.5, riskTier: "B", pools: {} }).ok, false);
  const dup = planCover({
    exposures: [
      { id: "a", label: "A", product: "depeg", amount: 1 },
      { id: "a", label: "A2", product: "depeg", amount: 1 },
    ],
    days: 30,
    riskTier: "B",
    pools: { depeg: pool },
  });
  assert.equal(dup.ok, false);
  assert.match(dup.reason ?? "", /Duplicate/);
  const none = planCover({ exposures: [], days: 30, riskTier: "B", pools: {} });
  assert.equal(none.totals.coverageRatio, 1);
  assert.equal(none.totals.effectiveAnnualRate, 0);
});

test("encodePlanShare ↔ decodePlanShare round-trips currency, term and exposures", () => {
  const state = {
    currency: "USDC" as const,
    days: 180,
    exposures: [
      { label: "USDM in wallet", product: "depeg" as const, amount: 400, protectPct: 100 },
      { label: "DEX LP|v2", product: "exploit" as const, amount: 300.5, protectPct: 80 },
      { label: "Uptime SLA", product: "sla" as const, amount: 50, protectPct: 25 },
    ],
  };
  const q = planShareQuery(state);
  assert.match(q, /^c=USDC&d=180&x=/);
  const back = decodePlanShare(q);
  assert.equal(back.ok, true);
  if (!back.ok) return;
  assert.deepEqual(back.state, state);
  assert.deepEqual(decodePlanShare(`?${q}`), back);
  assert.deepEqual(decodePlanShare(encodePlanShare(state)), back);
});

test("decodePlanShare fills ADA/90 defaults when c and d are omitted", () => {
  const r = decodePlanShare("x=Treasury%20USDM%7Cdepeg%7C500%7C100");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.state.currency, "ADA");
  assert.equal(r.state.days, 90);
  assert.deepEqual(r.state.exposures, [{ label: "Treasury USDM", product: "depeg", amount: 500, protectPct: 100 }]);
});

test("decodePlanShare refuses bad currency, days, product, amount, share and overlong lists", () => {
  assert.match(decodePlanShare("c=ETH&d=90").reason ?? "", /ADA or USDC/);
  assert.match(decodePlanShare("c=ADA&d=1.5").reason ?? "", /positive integer/);
  assert.match(decodePlanShare("c=ADA&d=0").reason ?? "", /positive integer/);
  assert.match(decodePlanShare("x=a|nope|1|100").reason ?? "", /unknown product/);
  assert.match(decodePlanShare("x=a|depeg|-1|100").reason ?? "", /positive number/);
  assert.match(decodePlanShare("x=a|depeg|10|0").reason ?? "", /1–100/);
  assert.match(decodePlanShare("x=a|depeg|10").reason ?? "", /label\|product\|amount\|protectPct/);
  // label may contain "|"; splitting from the right still round-trips
  const pipe = decodePlanShare(planShareQuery({ currency: "ADA", days: 30, exposures: [{ label: "a|b|c", product: "depeg", amount: 10, protectPct: 100 }] }));
  assert.equal(pipe.ok && pipe.state.exposures[0].label, "a|b|c");
  const tooMany = Array.from({ length: PLAN_SHARE_MAX_EXPOSURES + 1 }, (_, i) => `x=e${i}|depeg|1|100`).join("&");
  assert.match(decodePlanShare(tooMany).reason ?? "", /at most/);
});

test("encodePlanShare rejects invalid state before it reaches the URL", () => {
  assert.throws(
    () => encodePlanShare({ currency: "ADA", days: 90, exposures: [{ label: "x", product: "depeg", amount: 0, protectPct: 100 }] }),
    /positive/,
  );
  assert.throws(
    () =>
      encodePlanShare({
        currency: "ADA",
        days: 90,
        exposures: Array.from({ length: PLAN_SHARE_MAX_EXPOSURES + 1 }, () => ({
          label: "x",
          product: "depeg" as const,
          amount: 1,
          protectPct: 100,
        })),
      }),
    /at most/,
  );
});
