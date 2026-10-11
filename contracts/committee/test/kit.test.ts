// Assessor-operator kit: offline keygen -> signed enrollment -> verify -> committee plan.
// Every key here is generated fresh into a temp dir and deleted; nothing touches a real seat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkLocalSecrets, keygen, planCommittee, verifyEnrollment, type Enrollment } from "../lib/kit.ts";

async function seats(root: string) {
  const out: Enrollment[] = [];
  for (const seat of [0, 1, 2]) out.push((await keygen({ dir: join(root, `s${seat}`), handle: `@op${seat}`, affiliations: ["ExampleDEX"], seat })).enrollment);
  return out;
}

test("keygen writes 0600 secrets and a public record that verifies and opens with its own secrets", async () => {
  const root = mkdtempSync(join(tmpdir(), "ps-committee-"));
  try {
    const r = await keygen({ dir: join(root, "a"), handle: "@alice", seat: 1 });
    for (const kind of ["cardanoSk", "cardanoSkey", "midnightSeat"] as const)
      assert.equal(statSync(r.files[kind]).mode & 0o077, 0, `${kind} must not be group/world readable`);
    assert.equal(statSync(r.files.enrollment).mode & 0o777, 0o644, "the enrollment record is public");
    assert.deepEqual(verifyEnrollment(r.enrollment), { ok: true, problems: [] });
    assert.equal((await checkLocalSecrets(r.enrollment, join(root, "a"))).ok, true);
    // The public record carries no secret material.
    assert.doesNotMatch(JSON.stringify(r.enrollment), /"(sk|skey|secret|seed)"/i);
    // Never overwrites an existing identity.
    await assert.rejects(keygen({ dir: join(root, "a"), handle: "@alice" }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a tampered record fails verification; another operator's secrets do not open it", async () => {
  const root = mkdtempSync(join(tmpdir(), "ps-committee-"));
  try {
    const [a, b] = await seats(root);
    const forged = structuredClone(a);
    forged.handle = "@mallory";
    assert.equal(verifyEnrollment(forged).ok, false);
    assert.equal(verifyEnrollment({ nope: true }).ok, false, "never throws on junk");
    assert.equal((await checkLocalSecrets(a, join(root, "s1"))).ok, false);
    assert.ok(b);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("plan: three distinct seats -> 2-of-3 params for both chains, deterministic; bad input throws", async () => {
  const root = mkdtempSync(join(tmpdir(), "ps-committee-"));
  try {
    const recs = await seats(root);
    const p = planCommittee(recs);
    assert.equal(p.dryRun, true);
    assert.equal(p.threshold, 2);
    assert.equal(p.seats.length, 3);
    assert.deepEqual(p.midnight.constructorArgs.committee, recs.map((r) => r.midnight.seatCommitment));
    assert.equal(p.midnight.constructorArgs.m, 2);
    assert.equal(p.cardano.committee.threshold, 2);
    assert.equal(new Set(p.cardano.committee.assessors).size, 3);
    assert.match(p.planSha256, /^[0-9a-f]{64}$/);
    assert.equal(planCommittee(recs).planSha256, p.planSha256, "same seats, same plan hash");
    assert.throws(() => planCommittee(recs.slice(0, 2)), /exactly 3/);
    assert.throws(() => planCommittee([recs[0], recs[0], recs[1]]), /appears in two records/);
    assert.throws(() => planCommittee(recs, { threshold: 4 }), /threshold/);
    const forged = structuredClone(recs[2]);
    forged.handle = "@mallory";
    assert.throws(() => planCommittee([recs[0], recs[1], forged]), /does not verify/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
