import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NIGHT_PREMIUMS_SUPPORTED,
  PRODUCT_ORDER,
  PRODUCTS,
  STATUS_LABEL,
  isBuyable,
  productsByStatus,
  quote,
} from "../src/index.ts";

test("live products are exactly depeg and exploit; SLA is priced, not live", () => {
  assert.deepEqual(productsByStatus("live").map((p) => p.id), ["depeg", "exploit"]);
  assert.deepEqual(productsByStatus("priced").map((p) => p.id), ["sla"]);
  assert.deepEqual(productsByStatus("planned"), []);
  assert.equal(isBuyable("depeg"), true);
  assert.equal(isBuyable("exploit"), true);
  assert.equal(isBuyable("sla"), false);
  assert.equal(PRODUCTS.sla.buy, null);
  assert.match(PRODUCTS.sla.blocker ?? "", /uptime oracle/);
});

test("live products take ADA and USDC premiums; SLA takes none yet; no NIGHT anywhere", () => {
  for (const id of ["depeg", "exploit"] as const) assert.deepEqual([...PRODUCTS[id].premiumCurrencies], ["ADA", "USDC"]);
  assert.equal(PRODUCTS.sla.premiumCurrencies.length, 0);
  assert.deepEqual([...PRODUCTS.sla.plannedCurrencies], ["ADA", "USDC"]);
  assert.equal(NIGHT_PREMIUMS_SUPPORTED, false);
  for (const p of Object.values(PRODUCTS)) {
    assert.ok(!(p.premiumCurrencies as readonly string[]).includes("NIGHT"), `${p.id} must not list NIGHT premiums`);
    assert.ok(!(p.plannedCurrencies as readonly string[]).includes("NIGHT"), `${p.id} must not plan NIGHT premiums`);
  }
});

test("buy links point at the live /cover sections; every product has a quote link", () => {
  assert.equal(PRODUCTS.depeg.buy?.href, "/cover#buy-depeg");
  assert.equal(PRODUCTS.exploit.buy?.href, "/cover#buy-exploit");
  for (const p of Object.values(PRODUCTS)) {
    assert.ok(p.quote.href.startsWith("/cover"), `${p.id} quote link`);
    assert.equal(p.blocker === null, p.status === "live", `${p.id}: only non-live products carry a blocker`);
    assert.ok(p.related.length > 0 && p.related.every((l) => l.href.startsWith("/")), `${p.id} related links are internal`);
  }
});

test("settlement models: depeg and SLA parametric, exploit assessed on Cardano + Midnight", () => {
  assert.equal(PRODUCTS.depeg.settlementModel, "parametric");
  assert.equal(PRODUCTS.sla.settlementModel, "parametric");
  assert.equal(PRODUCTS.exploit.settlementModel, "assessed");
  assert.equal(PRODUCTS.exploit.chain, "Cardano + Midnight");
  assert.match(PRODUCTS.exploit.claimModel, /2 of 3/);
});

test("catalog order covers every product once and every status has a label", () => {
  assert.deepEqual([...PRODUCT_ORDER].sort(), Object.keys(PRODUCTS).sort());
  for (const p of Object.values(PRODUCTS)) assert.ok(STATUS_LABEL[p.status]);
});

test("catalog metadata leaves the quote engine unchanged, SLA included", () => {
  const pool = { capital: 1_000_000, activeCover: 0 };
  const r = quote({ product: "sla", coverAmount: 10_000, days: 90, riskTier: "B", pool });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.breakdown.baseAnnualRate, 0.015);
});
