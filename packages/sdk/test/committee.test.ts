import { test } from "node:test";
import assert from "node:assert/strict";
import {
  committeeApproves,
  committeeData,
  committeeFromJson,
  committeeProblem,
  committeeSigners,
  toCborHex,
  type Committee,
} from "../src/cardano.ts";

// exploit_cover.ak test fixtures: assessor_1..3 and the 2-of-3 committee.
const A = (n: number) => "a55e55".repeat(9).slice(0, 52) + "55" + n.toString(16).padStart(2, "0");
const [a1, a2, a3] = [A(1), A(2), A(3)];
const committee: Committee = { assessors: [a1, a2, a3], threshold: 2n };
const holder = "4011de".repeat(9) + "40";

test("fixture keys match exploit_cover.ak", () => {
  assert.equal(a1, "a55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e5501");
});

test("Committee encodes like Aiken's (exploit_cover.ak committee_sdk_golden_vector)", () => {
  assert.equal(
    toCborHex(committeeData(committee)),
    "d8799f9f581c" + a1 + "581c" + a2 + "581c" + a3 + "ff02ff",
  );
  // upper-case input is normalised, so the applied script hash doesn't depend on case
  assert.equal(toCborHex(committeeData({ ...committee, assessors: committee.assessors.map((k) => k.toUpperCase()) })), toCborHex(committeeData(committee)));
});

test("committeeProblem mirrors committee_ok", () => {
  assert.equal(committeeProblem(committee), null);
  assert.equal(committeeProblem({ assessors: [a2], threshold: 1n }), null);
  assert.equal(committeeProblem({ ...committee, threshold: 3n }), null);
  assert.match(committeeProblem({ assessors: [], threshold: 1n })!, /at least one/);
  assert.match(committeeProblem({ assessors: [a1, "a55e55", a3], threshold: 2n })!, /28-byte/);
  assert.match(committeeProblem({ assessors: [a1, a1 + "03"], threshold: 1n })!, /28-byte/);
  assert.match(committeeProblem({ assessors: [a1, a1, a2], threshold: 2n })!, /twice/);
  assert.match(committeeProblem({ assessors: [a1, a1.toUpperCase()], threshold: 1n })!, /twice/);
  assert.match(committeeProblem({ ...committee, threshold: 0n })!, /at least 1/);
  assert.match(committeeProblem({ ...committee, threshold: -1n })!, /at least 1/);
  assert.match(committeeProblem({ ...committee, threshold: 4n })!, /above/);
  assert.throws(() => committeeData({ assessors: [a1, a1], threshold: 2n }), /invalid assessor committee/);
});

test("committee counting mirrors committee_signatures / committee_approves", () => {
  assert.deepEqual(committeeSigners(committee, [a3, a1]), [a1, a3]);
  assert.deepEqual(committeeSigners(committee, [a2, a2, a2]), [a2], "a repeated signer counts once");
  assert.deepEqual(committeeSigners(committee, [holder]), []);
  assert.equal(committeeApproves(committee, [a1, a3]), true);
  assert.equal(committeeApproves(committee, [a1, a2, a3]), true);
  assert.equal(committeeApproves(committee, [holder, a2, "0be0".repeat(14), a3]), true, "extra non-committee signers are ignored");
  assert.equal(committeeApproves(committee, [a2]), false, "1-of-3 is below threshold");
  assert.equal(committeeApproves(committee, [a1, a1]), false, "duplicate signer counted once");
  assert.equal(committeeApproves(committee, [holder, a1]), false);
  assert.equal(committeeApproves(committee, []), false);
  assert.equal(committeeApproves({ assessors: [a1, a1], threshold: 2n }, [a1]), false, "malformed committee never approves");
});

test("committeeFromJson revives the deployment record form", () => {
  const c = committeeFromJson(JSON.parse(JSON.stringify({ assessors: committee.assessors, threshold: "2" })));
  assert.deepEqual(c, committee);
});
