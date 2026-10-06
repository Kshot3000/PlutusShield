import { test } from "node:test";
import assert from "node:assert/strict";
import { quote, utilizationMultiplier, UTILIZATION_KINK } from "../src/index.ts";

const pool = { capital: 1_000_000, activeCover: 300_000 };

test("depeg quote at tier B is base rate scaled by utilization and term", () => {
  const r = quote({ product: "depeg", coverAmount: 10_000, days: 365, riskTier: "B", pool });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.ok(r.annualRate > 0.02 && r.annualRate < 0.03);
  assert.equal(r.premium, Math.round(10_000 * r.annualRate * 100) / 100);
});

test("risk tier ordering A < B < C", () => {
  const p = (riskTier: "A" | "B" | "C") => {
    const r = quote({ product: "exploit", coverAmount: 20_000, days: 90, riskTier, pool });
    assert.ok(r.ok);
    return r.ok ? r.premium : 0;
  };
  assert.ok(p("A") < p("B") && p("B") < p("C"));
});

test("utilization curve is continuous at the kink and steeper after", () => {
  const eps = 1e-9;
  assert.ok(Math.abs(utilizationMultiplier(UTILIZATION_KINK) - utilizationMultiplier(UTILIZATION_KINK + eps)) < 1e-6);
  const before = utilizationMultiplier(0.6) - utilizationMultiplier(0.5);
  const after = utilizationMultiplier(0.85) - utilizationMultiplier(0.75);
  assert.ok(after > before * 3);
});

test("rejects cover above single-policy cap", () => {
  const r = quote({ product: "depeg", coverAmount: 150_000, days: 30, riskTier: "A", pool });
  assert.equal(r.ok, false);
});

test("rejects cover that would breach the 90% utilization cap", () => {
  const r = quote({ product: "depeg", coverAmount: 90_000, days: 30, riskTier: "A", pool: { capital: 1_000_000, activeCover: 850_000 } });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /capacity/);
});

test("enforces product term bounds", () => {
  assert.equal(quote({ product: "sla", coverAmount: 1_000, days: 200, riskTier: "B", pool }).ok, false);
  assert.equal(quote({ product: "exploit", coverAmount: 1_000, days: 10, riskTier: "B", pool }).ok, false);
});

test("minimum premium floor applies to tiny policies", () => {
  const r = quote({ product: "sla", coverAmount: 100, days: 7, riskTier: "A", pool });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.premium, 5);
});
