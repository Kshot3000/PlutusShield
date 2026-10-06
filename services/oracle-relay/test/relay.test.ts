import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate, type RelayInput } from "../src/relay.ts";

const example: RelayInput = JSON.parse(readFileSync(new URL("../examples/usdm-depeg.example.json", import.meta.url), "utf8"));
const H = 3_600_000;

test("example: depeg is attested, frozen venue is outvoted, peg recovered by now", () => {
  const r = evaluate(example);
  assert.ok(r.depeg, "trigger met");
  assert.ok(BigInt(r.depeg.datum.priceBps) < 9_500n);
  assert.equal(BigInt(r.depeg.datum.windowEnd) - BigInt(r.depeg.datum.windowStart), 86_400_000n);
  assert.match(r.depeg.cborHex, /^d8799f/, "constr 0 inline datum");
  assert.ok(r.peg?.healthy, "price back at peg by `now`");
  assert.equal(r.venues.length, 3);
});

test("no depeg when the cover period ends before the dip can fill a window", () => {
  const start = Number(example.start);
  const r = evaluate({ ...example, expiry: start + 80 * H });
  assert.equal(r.depeg, null);
  assert.ok(r.notes.some((n) => n.startsWith("No 24h window")));
});

test("circuit-breaker reading during the depeg is unhealthy", () => {
  const start = Number(example.start);
  const r = evaluate({ ...example, now: start + 100 * H });
  assert.equal(r.peg?.healthy, false);
});

test("stale feeds give no peg reading at all", () => {
  const start = Number(example.start);
  const r = evaluate({ ...example, now: start + 200 * H });
  assert.equal(r.peg, null);
});

test("bad input is rejected loudly", () => {
  assert.throws(() => evaluate({ ...example, thresholdBps: 0 }), /thresholdBps/);
  assert.throws(() => evaluate({ ...example, expiry: example.start }), /expiry/);
  assert.throws(() => evaluate({ ...example, sources: {} }), /source/);
  assert.throws(() => evaluate({ ...example, start: "1.5" }), /integer/);
});

test("two venues get a warning", () => {
  const { ["venue-c-frozen"]: _, ...two } = example.sources;
  assert.ok(evaluate({ ...example, sources: two }).notes[0].includes("3+"));
});
