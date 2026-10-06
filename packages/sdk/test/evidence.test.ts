import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EvidenceError,
  buildEvidenceBundle,
  canonicalJson,
  checkEvidence,
  commitBundle,
  encodeEvidence,
  evidenceCommitment,
  evidenceFileText,
  evidenceTag,
  fileClaimArgs,
  hashAttachment,
  matchAttachments,
  normalizeAmount,
  openEvidence,
  parseEnvelope,
  sealEvidence,
  verifyEvidence,
  type EvidenceInput,
} from "../src/evidence.ts";
import * as index from "../src/index.ts";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const fill = (n: number, v: number) => new Uint8Array(n).fill(v);
const NOW = new Date("2026-10-06T14:00:00.000Z");
const POLICY = "ab".repeat(32);
const TX1 = "0f".repeat(32);
const TX2 = "1e".repeat(32);

const input = (over: Partial<EvidenceInput> = {}): EvidenceInput => ({
  policyId: POLICY.toUpperCase(),
  protocol: { name: "  Example DEX  ", chain: "cardano", contracts: ["addr_test1wexample", "addr_test1wexample", ""] },
  incident: {
    kind: "logic-bug",
    description: "Swap validator accepted a datum with a forged pool NFT, draining the ADA/USDC pool.",
    startedAt: "2026-10-05T03:12:00Z",
    detectedAt: "2026-10-05T03:40:00.000Z",
  },
  txHashes: [TX1.toUpperCase(), TX2, TX1],
  loss: { amount: "01,250.500", asset: "ADA" },
  attachments: [{ name: "trace.txt", mediaType: "text/plain", size: 11, sha256: "" }],
  createdAt: "2026-10-06T13:59:00Z",
  ...over,
});

async function withAttachment(over: Partial<EvidenceInput> = {}) {
  const file = new TextEncoder().encode("hello trace");
  const i = input(over);
  i.attachments = [{ name: "trace.txt", mediaType: "text/plain", size: file.length, sha256: await hashAttachment(file) }];
  return { i, file };
}

test("commitment matches policy-cover.compact evidenceCommitment (vector from the compiled contract)", async () => {
  // pureCircuits.evidenceCommitment(0x11 * 32, 0x22 * 32) via compact-runtime 0.16.0 / compactc 0.31.1.
  // contracts/midnight/test re-checks this live against the compiled contract on random inputs.
  assert.equal(hex(await evidenceCommitment(fill(32, 0x11), fill(32, 0x22))), "14ba6297004896270978c6eb916969a73d487220d6a4cc31fabc533e40f4b2b8");
  assert.equal(hex(evidenceTag()), "706c75747573736869656c643a65766964656e63653a76310000000000000000");
  await assert.rejects(evidenceCommitment(fill(31, 1), fill(32, 2)), EvidenceError);
});

test("canonical JSON sorts keys, strips whitespace, rejects floats and undefined", () => {
  assert.equal(canonicalJson({ b: 1, a: [true, null, "x\u00e9\n"], c: { z: "", y: 0 } }), '{"a":[true,null,"xé\\n"],"b":1,"c":{"y":0,"z":""}}');
  assert.throws(() => canonicalJson({ a: 1.5 }), EvidenceError);
  assert.throws(() => canonicalJson({ a: undefined }), EvidenceError);
  assert.throws(() => canonicalJson(new Date()), EvidenceError);
});

test("normalization: hex lowercased, duplicates dropped, amount and times canonical", async () => {
  const { i } = await withAttachment();
  const b = buildEvidenceBundle(i, NOW);
  assert.equal(b.policyId, POLICY);
  assert.equal(b.protocol.name, "Example DEX");
  assert.deepEqual(b.protocol.contracts, ["addr_test1wexample"]);
  assert.deepEqual(b.txHashes, [TX1, TX2]);
  assert.deepEqual(b.loss, { amount: "1250.5", asset: "ADA" });
  assert.equal(b.incident.startedAt, "2026-10-05T03:12:00.000Z");
  assert.equal(b.createdAt, "2026-10-06T13:59:00.000Z");
  assert.equal(b.product, "exploit");
  assert.equal(normalizeAmount("0.000"), null);
  assert.equal(normalizeAmount("0.10"), "0.1");
  assert.equal(normalizeAmount("-5"), null);
  assert.equal(normalizeAmount("1e5"), null);
});

test("validation reports every bad field", () => {
  const issues = checkEvidence(
    {
      policyId: "xyz",
      protocol: { name: "", chain: "solana" as never, contracts: [] },
      incident: { kind: "nope" as never, description: "short", startedAt: "2026-10-05T04:00:00Z", detectedAt: "2026-10-05T03:00:00Z" },
      txHashes: ["abc"],
      loss: { amount: "0", asset: "A D A" },
      attachments: [{ name: "", mediaType: "", size: -1, sha256: "zz" }],
    },
    NOW,
  );
  const paths = new Set(issues.map((x) => x.path));
  for (const p of [
    "policyId",
    "protocol.name",
    "protocol.chain",
    "protocol.contracts",
    "incident.kind",
    "incident.description",
    "incident.detectedAt",
    "txHashes",
    "loss.amount",
    "loss.asset",
    "attachments.0.name",
    "attachments.0.sha256",
    "attachments.0.size",
  ]) {
    assert.ok(paths.has(p), `missing issue for ${p}`);
  }
  assert.throws(() => buildEvidenceBundle(input({ txHashes: [] }), NOW), (e: unknown) => e instanceof EvidenceError && e.code === "invalid");
  assert.ok(checkEvidence(input({ createdAt: "2026-10-07T00:00:00Z" }), NOW).some((x) => x.path === "createdAt"));
});

test("commitment is deterministic for equivalent inputs and changes with any field or salt", async () => {
  const { i } = await withAttachment();
  const salt = fill(32, 7);
  const a = await commitBundle(buildEvidenceBundle(i, NOW), salt);
  // Same evidence, different spelling: key order, case, whitespace, duplicates.
  const j = { ...i, policyId: POLICY, txHashes: [TX1, TX2], loss: { asset: "ADA", amount: "1250.50" } };
  const b = await commitBundle(buildEvidenceBundle(j, NOW), salt);
  assert.deepEqual(a, b);
  const c = await commitBundle(buildEvidenceBundle({ ...i, loss: { amount: "1250.51", asset: "ADA" } }, NOW), salt);
  assert.notEqual(c.commitment, a.commitment);
  const d = await commitBundle(buildEvidenceBundle(i, NOW), fill(32, 8));
  assert.equal(d.digest, a.digest);
  assert.notEqual(d.commitment, a.commitment);
});

test("seal → open round trip, with the documented formula", async () => {
  const { i } = await withAttachment();
  const s = await sealEvidence(i, { now: NOW });
  assert.match(s.commitment, /^[0-9a-f]{64}$/);
  assert.equal(s.envelope.commitment, s.commitment);
  assert.equal(s.keyFile.commitment, s.commitment);
  // digest = SHA-256(canonical bytes); commitment = SHA-256(tag || digest || salt).
  const bytes = new TextEncoder().encode(canonicalJson(s.bundle));
  assert.deepEqual(new Uint8Array(s.bytes), bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  assert.equal(s.digest, hex(digest));
  const manual = new Uint8Array(await crypto.subtle.digest("SHA-256", Buffer.concat([evidenceTag(), digest, Buffer.from(s.keyFile.salt, "hex")])));
  assert.equal(hex(manual), s.commitment);
  // Files survive a text round trip.
  const opened = await openEvidence(evidenceFileText(s.envelope), evidenceFileText(s.keyFile));
  assert.deepEqual(opened.bundle, s.bundle);
  assert.equal(opened.commitment, s.commitment);
  // Ciphertext does not contain the plaintext.
  assert.ok(!Buffer.from(s.envelope.ciphertext, "base64").toString("latin1").includes("Example DEX"));
});

test("fresh key, salt and nonce per seal; injected randomness is reproducible", async () => {
  const { i } = await withAttachment();
  const a = await sealEvidence(i, { now: NOW });
  const b = await sealEvidence(i, { now: NOW });
  assert.notEqual(a.keyFile.key, b.keyFile.key);
  assert.notEqual(a.commitment, b.commitment);
  assert.notEqual(a.envelope.iv, b.envelope.iv);
  const fixed = { now: NOW, key: fill(32, 1), salt: fill(32, 2), iv: fill(12, 3) };
  const c = await sealEvidence(i, fixed);
  const d = await sealEvidence(i, fixed);
  assert.deepEqual(c.envelope, d.envelope);
  assert.equal(c.digest, a.digest);
});

test("wrong key fails decryption; a key file for another bundle is refused", async () => {
  const { i } = await withAttachment();
  const s = await sealEvidence(i, { now: NOW });
  const other = await sealEvidence(i, { now: NOW });
  await assert.rejects(openEvidence(s.envelope, { ...s.keyFile, key: other.keyFile.key }), (e: unknown) => e instanceof EvidenceError && e.code === "decrypt");
  await assert.rejects(openEvidence(s.envelope, other.keyFile), (e: unknown) => e instanceof EvidenceError && e.code === "key-mismatch");
  await assert.rejects(openEvidence(s.keyFile, s.envelope), (e: unknown) => e instanceof EvidenceError && e.code === "format");
});

test("tampering is detected: ciphertext, nonce, header, and salt", async () => {
  const { i } = await withAttachment();
  const s = await sealEvidence(i, { now: NOW });
  const ct = Buffer.from(s.envelope.ciphertext, "base64");
  ct[5] ^= 0x01;
  await assert.rejects(openEvidence({ ...s.envelope, ciphertext: ct.toString("base64") }, s.keyFile), (e: unknown) => (e as EvidenceError).code === "decrypt");
  await assert.rejects(openEvidence({ ...s.envelope, iv: "00".repeat(12) }, s.keyFile), (e: unknown) => (e as EvidenceError).code === "decrypt");
  // Swapping the header commitment (and the key file's, so they still pair) breaks the GCM additional data.
  const forged = "cd".repeat(32);
  await assert.rejects(
    openEvidence({ ...s.envelope, commitment: forged }, { ...s.keyFile, commitment: forged }),
    (e: unknown) => (e as EvidenceError).code === "decrypt",
  );
  // Right key, wrong salt: decrypts but the opening no longer matches.
  await assert.rejects(openEvidence(s.envelope, { ...s.keyFile, salt: "00".repeat(32) }), (e: unknown) => (e as EvidenceError).code === "commitment");
});

test("non-canonical plaintext under a valid key is rejected", async () => {
  const { i } = await withAttachment();
  const s = await sealEvidence(i, { now: NOW, key: fill(32, 9) });
  // Re-encrypt the same bundle with pretty-printed JSON under the same header and key.
  const plain = new TextEncoder().encode(JSON.stringify(s.bundle, null, 2));
  const aad = new TextEncoder().encode(canonicalJson({ alg: "AES-256-GCM", commitment: s.commitment, policyId: s.bundle.policyId, schema: s.envelope.schema }));
  const key = await crypto.subtle.importKey("raw", fill(32, 9), "AES-GCM", false, ["encrypt"]);
  const iv = fill(12, 4);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, plain));
  const env = { ...s.envelope, iv: hex(iv), ciphertext: Buffer.from(ct).toString("base64") };
  await assert.rejects(openEvidence(env, s.keyFile), (e: unknown) => (e as EvidenceError).code === "not-canonical");
});

test("verifyEvidence reports each step for assessors", async () => {
  const { i } = await withAttachment();
  const s = await sealEvidence(i, { now: NOW });
  const good = await verifyEvidence(s.envelope, s.keyFile, `0x${s.commitment.toUpperCase()}`);
  assert.equal(good.ok, true);
  assert.ok(good.checks.every((c) => c.ok === true));
  assert.equal(good.bundle?.protocol.name, "Example DEX");

  const noLedger = await verifyEvidence(s.envelope, s.keyFile);
  assert.equal(noLedger.ok, false);
  assert.equal(noLedger.checks.find((c) => c.id === "ledger")?.ok, null);
  assert.equal(noLedger.checks.find((c) => c.id === "commitment")?.ok, true);

  const wrongLedger = await verifyEvidence(s.envelope, s.keyFile, "ef".repeat(32));
  assert.equal(wrongLedger.ok, false);
  assert.equal(wrongLedger.checks.find((c) => c.id === "ledger")?.ok, false);

  const other = await sealEvidence(i, { now: NOW });
  const bad = await verifyEvidence(s.envelope, { ...s.keyFile, key: other.keyFile.key }, s.commitment);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.checks.map((c) => c.ok), [true, false, null, null, null]);

  const junk = await verifyEvidence("{not json", s.keyFile, s.commitment);
  assert.equal(junk.checks[0].ok, false);
});

test("attachments are matched by hash only", async () => {
  const { i, file } = await withAttachment();
  const s = await sealEvidence(i, { now: NOW });
  const m = await matchAttachments(s.bundle, [
    { name: "renamed.txt", bytes: file },
    { name: "other.bin", bytes: new Uint8Array([1, 2, 3]) },
  ]);
  assert.equal(m.files[0].matches?.name, "trace.txt");
  assert.equal(m.files[1].matches, null);
  assert.equal(m.missing.length, 0);
  assert.equal((await matchAttachments(s.bundle, [])).missing.length, 1);
});

test("fileClaim arguments and SDK index export", async () => {
  const { i } = await withAttachment();
  const s = await sealEvidence(i, { now: NOW });
  const args = fileClaimArgs(s);
  assert.equal(hex(args.policyId), POLICY);
  assert.equal(hex(args.evidenceCommitment), s.commitment);
  assert.equal(parseEnvelope(s.envelope).commitment, s.commitment);
  assert.equal(typeof index.sealEvidence, "function");
  assert.equal(typeof index.verifyEvidence, "function");
  assert.deepEqual(encodeEvidence(s.bundle), s.bytes);
});
