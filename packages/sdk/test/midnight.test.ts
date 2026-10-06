import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PolicyKeyError,
  checkPolicyKey,
  coverageCommitment,
  decryptPolicyKey,
  deriveRegistration,
  encryptPolicyKey,
  holderCommitment,
  holderPrivateState,
  isEncryptedPolicyKey,
  makePolicyKey,
  newHolderSecrets,
  pad32,
  parsePolicyKey,
  policyKeyFileName,
  policyKeyFileText,
  readPolicyKeyFile,
  registerPolicyArgs,
  registrationCommitment,
  registrationTag,
  u64le,
} from "../src/midnight.ts";
import * as index from "../src/index.ts";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const fill = (v: number) => new Uint8Array(32).fill(v);
const POLICY = "33".repeat(32);

test("commitments match policy-cover.compact pure circuits (vectors from the compiled contract)", async () => {
  // pureCircuits.* via compact-runtime 0.16.0 / compactc 0.31.1; contracts/midnight/test re-checks on random inputs.
  const h = await holderCommitment(fill(0x11));
  const c = await coverageCommitment(100_000_000n, fill(0x22));
  const r = await registrationCommitment(fill(0x33), h, c);
  assert.equal(hex(h), "f505ebc08c8888f5fba6221ac67fad1fe17af697a92398bf44459cbc99366829");
  assert.equal(hex(c), "c3583623da75e15aafdd758178f08b7685ba47ca209856577bc592416aa78b78");
  assert.equal(hex(r), "fb67ea6a96d58040da1648089f066f7ce3bf41f0f6533a787deb02be9f9f4d8b");
  assert.equal(hex(registrationTag()), "706c75747573736869656c643a72656769737465723a76310000000000000000");
  // Hex and byte inputs are interchangeable.
  assert.equal(hex(await registrationCommitment(POLICY, hex(h), hex(c).toUpperCase())), hex(r));
});

test("u64 encoding and range checks", async () => {
  assert.equal(hex(u64le(0x0102n)), "0201000000000000");
  assert.equal(hex(u64le((1n << 64n) - 1n)), "ffffffffffffffff");
  assert.throws(() => u64le(1n << 64n), PolicyKeyError);
  assert.throws(() => u64le(-1n), PolicyKeyError);
  assert.throws(() => pad32("x".repeat(33)), PolicyKeyError);
  await assert.rejects(coverageCommitment(1n, new Uint8Array(31)), PolicyKeyError);
  await assert.rejects(holderCommitment("zz"), PolicyKeyError);
});

test("derivation is deterministic and binds every input", async () => {
  const s = newHolderSecrets();
  const a = await deriveRegistration({ policyId: POLICY, coverage: 50_000_000n, ...s });
  assert.deepEqual(await deriveRegistration({ policyId: POLICY, coverage: 50_000_000n, ...s }), a);
  const other = newHolderSecrets();
  const variants = [
    { policyId: "34".repeat(32), coverage: 50_000_000n, ...s },
    { policyId: POLICY, coverage: 50_000_001n, ...s },
    { policyId: POLICY, coverage: 50_000_000n, holderSecret: other.holderSecret, coverageSalt: s.coverageSalt },
    { policyId: POLICY, coverage: 50_000_000n, holderSecret: s.holderSecret, coverageSalt: other.coverageSalt },
  ];
  for (const v of variants) assert.notEqual((await deriveRegistration(v)).registrationCommitment, a.registrationCommitment);
  assert.notEqual(s.holderSecret, other.holderSecret);
});

test("policy key: make, check against the datum, parse, private state, registerPolicy args", async () => {
  const key = await makePolicyKey({ network: "preview", policyId: POLICY.toUpperCase(), coverage: 100_000_000n, asset: "tADA", expiry: 1_800_000_000_000n, txHash: "AB".repeat(32), now: new Date("2026-10-06T17:00:00Z") });
  assert.equal(key.policyId, POLICY);
  assert.equal(key.txHash, "ab".repeat(32));
  assert.deepEqual(await checkPolicyKey(key, key.registrationCommitment.toUpperCase()), { ok: true, consistent: true, matchesDatum: true, reason: undefined });
  const wrong = await checkPolicyKey(key, "00".repeat(32));
  assert.equal(wrong.ok, false);
  assert.equal(wrong.matchesDatum, false);
  const tampered = await checkPolicyKey({ ...key, holderSecret: "44".repeat(32) }, key.registrationCommitment);
  assert.equal(tampered.ok, false);
  assert.equal(tampered.consistent, false);

  const round = parsePolicyKey(policyKeyFileText(key));
  assert.deepEqual(round, key);
  assert.throws(() => parsePolicyKey("{}"), PolicyKeyError);
  assert.throws(() => parsePolicyKey({ ...key, coverage: "1.5" }), PolicyKeyError);
  assert.throws(() => parsePolicyKey("not json"), PolicyKeyError);

  const ps = holderPrivateState(key);
  assert.equal(hex(ps.sk), key.holderSecret);
  assert.equal(ps.openings[POLICY].amount, 100_000_000n);
  assert.equal(hex(ps.openings[POLICY].salt), key.coverageSalt);
  const args = registerPolicyArgs(key);
  assert.equal(hex(args.cardanoCommitment), key.registrationCommitment);
  assert.equal(args.expiry, 1_800_000_000_000n);
  assert.equal(policyKeyFileName(POLICY), "plutusshield-policy-key-333333333333.json");
  assert.equal(index.registrationCommitment, registrationCommitment);
});

test("encrypted backup round-trips; wrong passphrase and tampering fail", async () => {
  const key = await makePolicyKey({ network: "preview", policyId: POLICY, coverage: 7n });
  const env = await encryptPolicyKey(key, "correct horse battery", 1_000);
  const text = policyKeyFileText(env);
  assert.equal(isEncryptedPolicyKey(text), true);
  assert.equal(isEncryptedPolicyKey(policyKeyFileText(key)), false);
  assert.equal(text.includes(key.holderSecret), false);
  assert.deepEqual(await decryptPolicyKey(env, "correct horse battery"), key);
  assert.deepEqual(await readPolicyKeyFile(text, "correct horse battery"), key);
  assert.deepEqual(await readPolicyKeyFile(policyKeyFileText(key)), key);
  await assert.rejects(readPolicyKeyFile(text), /encrypted/);
  await assert.rejects(decryptPolicyKey(env, "wrong horse battery"), PolicyKeyError);
  await assert.rejects(decryptPolicyKey({ ...env, policyId: "35".repeat(32) }, "correct horse battery"), /passphrase/);
  await assert.rejects(encryptPolicyKey(key, "short"), PolicyKeyError);
});
