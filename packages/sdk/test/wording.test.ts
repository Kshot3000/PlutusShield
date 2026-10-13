import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { coverWording, coverWordingFilename, coverWordingMarkdown, fmtBps, fmtDuration, hexToText, type WordingParamsJson } from "../src/index.ts";

const dep = (f: string) => JSON.parse(fs.readFileSync(new URL(`../../../contracts/cardano/deploy/deployments/${f}`, import.meta.url), "utf8"));
const depeg = dep("preview.json");
const exploit = dep("preview-exploit-v2.json");
const committee = { threshold: Number(exploit.committee.threshold), seats: exploit.committee.assessors.length };
const depegW = () => coverWording({ product: "depeg", params: depeg.params, network: "Cardano Preview", source: "preview.json" });
const exploitW = () => coverWording({ product: "exploit", params: exploit.params, committee, network: "Cardano Preview", source: "preview-exploit-v2.json" });
const value = (w: ReturnType<typeof depegW>, term: string) => w.schedule.find((r) => r.term === term)?.value;

test("formatters", () => {
  assert.equal(fmtDuration(3_600_000), "1 hour");
  assert.equal(fmtDuration(600_000), "10 minutes");
  assert.equal(fmtDuration(86_400_000), "24 hours");
  assert.equal(fmtDuration(259_200_000), "72 hours (3 days)");
  assert.equal(fmtDuration(0), "none");
  assert.equal(fmtBps(9500), "95.00%");
  assert.equal(hexToText("5553444d"), "USDM");
  assert.throws(() => hexToText("zz"));
});

test("depeg wording reads every number from the Preview deployment params", () => {
  const w = depegW();
  assert.equal(w.covered, "USDM");
  assert.equal(value(w, "Trigger"), "USDM below 95.00% of peg for at least 24 hours");
  assert.equal(value(w, "Oracle quorum"), "2 of 3 allowlisted feeds");
  assert.equal(value(w, "Sale guard"), "all 3 feeds healthy, readings at most 2 hours old");
  assert.equal(value(w, "Waiting period"), "1 hour");
  assert.equal(value(w, "Term"), "14–365 whole days");
  assert.equal(value(w, "Premium and payout currency"), "ADA or tUSDCx");
  assert.equal(value(w, "Minimum premium"), "5 ADA, 5 tUSDCx");
  assert.equal(value(w, "Largest single policy"), "10.00% of its tranche's capital");
  assert.equal(value(w, "Tranche utilization cap"), "90.00% of capital");
  assert.equal(value(w, "Claim window"), "until 72 hours (3 days) after expiry");
  assert.ok(w.notCovered.some((n) => n.includes("less than 24 hours")));
});

test("exploit wording uses the committee, the 10-minute wait and no oracle", () => {
  const w = exploitW();
  assert.equal(value(w, "Decided by"), "2 of 3 assessor signatures on the payout");
  assert.equal(value(w, "Waiting period"), "10 minutes");
  assert.equal(value(w, "Term"), "30–365 whole days");
  assert.equal(value(w, "Oracle quorum"), undefined);
  assert.equal(value(w, "Claim window"), "cover start to 72 hours (3 days) after expiry");
  assert.ok(w.clauses.some((c) => c.id === "trust" && c.enforcedBy === "disclosure"));
  assert.ok(w.clauses.every((c) => c.check.length > 0));
});

test("refuses params for the wrong product, a missing committee, or a bad quorum", () => {
  assert.throws(() => coverWording({ product: "exploit", params: depeg.params, committee, network: "x", source: "x" }), /not "exploit"/);
  assert.throws(() => coverWording({ product: "exploit", params: exploit.params, network: "x", source: "x" }), /committee/);
  const bad: WordingParamsJson = { ...depeg.params, oracle: { feeds: depeg.params.oracle.feeds, quorum: "4" } };
  assert.throws(() => coverWording({ product: "depeg", params: bad, network: "x", source: "x" }), /quorum/);
  const tok: WordingParamsJson = { ...depeg.params, assets: [{ asset: { policyId: "ab", assetName: "4142" }, minPremium: "1" }] };
  assert.throws(() => coverWording({ product: "depeg", params: tok, network: "x", source: "x" }), /decimals/);
});

test("markdown is deterministic and carries schedule, clauses and exclusions", () => {
  const w = depegW();
  const md = coverWordingMarkdown(w);
  assert.equal(md, coverWordingMarkdown(depegW()));
  assert.match(md, /^# PlutusShield Stablecoin depeg cover: cover wording/);
  assert.match(md, /\| Oracle quorum \| 2 of 3 allowlisted feeds \| validator \| `oracle.ak triggered` \|/);
  assert.match(md, /## Not covered/);
  assert.equal(coverWordingFilename(w), "plutusshield-depeg-cover-wording.md");
});
