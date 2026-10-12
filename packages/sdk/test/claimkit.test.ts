import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLAIM_KIT_SCHEMA,
  ClaimKitError,
  buildClaimKit,
  claimKitFileName,
  claimKitFileText,
  openClaimKit,
  parseClaimKit,
} from "../src/claimkit.ts";
import { sealEvidence, type EvidenceInput } from "../src/evidence.ts";
import { makePolicyKey } from "../src/midnight.ts";

const POLICY = "cd".repeat(32);
const OTHER = "ef".repeat(32);
const NOW = new Date("2026-10-12T19:00:00.000Z");
const PASS = "correct horse battery";

const input = (policyId = POLICY): EvidenceInput => ({
  policyId,
  protocol: { name: "Example DEX", chain: "cardano", contracts: ["addr_test1wexample"] },
  incident: {
    kind: "logic-bug",
    description: "Swap validator accepted a forged pool NFT and the ADA pool was drained.",
    startedAt: "2026-10-11T03:12:00Z",
    detectedAt: "2026-10-11T03:40:00Z",
  },
  txHashes: ["0f".repeat(32)],
  loss: { amount: "1250.5", asset: "ADA" },
  attachments: [],
  createdAt: "2026-10-12T18:59:00Z",
});

async function fixture() {
  const key = await makePolicyKey({ network: "preview", policyId: POLICY, coverage: 100_000_000n, asset: "tADA", expiry: 1_800_000_000_000n, now: NOW });
  const sealed = await sealEvidence(input(), { now: NOW });
  const kit = await buildClaimKit({ key, sealed, passphrase: PASS, now: NOW, iterations: 1_000 });
  return { key, sealed, kit };
}

test("claim kit round-trips: key, evidence and the exact fileClaim call", async () => {
  const { key, sealed, kit } = await fixture();
  assert.equal(kit.schema, CLAIM_KIT_SCHEMA);
  assert.deepEqual(kit.call, { circuit: "fileClaim", policyId: POLICY, evidenceCommitment: sealed.commitment });
  assert.deepEqual(kit.target, { chain: "midnight", network: "preprod", contract: "policy-cover-v2" });
  assert.equal(claimKitFileName(POLICY.toUpperCase()), `plutusshield-claim-${POLICY.slice(0, 16)}.json`);
  const text = claimKitFileText(kit);
  const opened = await openClaimKit(text, PASS, { datumCommitment: key.registrationCommitment });
  assert.deepEqual(opened.key, key);
  assert.equal(opened.sealed.commitment, sealed.commitment);
  assert.deepEqual(opened.sealed.bundle, sealed.bundle);
});

test("the holder secret is never in the kit in the clear", async () => {
  const { key, kit } = await fixture();
  const text = claimKitFileText(kit);
  assert.equal(text.includes(key.holderSecret), false);
  assert.equal(text.includes(key.coverageSalt), false);
});

test("wrong passphrase, tampered evidence, or a foreign datum are refused", async () => {
  const { kit } = await fixture();
  await assert.rejects(openClaimKit(kit, "not the passphrase"), (e: unknown) => e instanceof ClaimKitError && e.code === "decrypt");
  await assert.rejects(openClaimKit(kit, PASS, { datumCommitment: "00".repeat(32) }), (e: unknown) => e instanceof ClaimKitError && e.code === "key");
  const flipped = structuredClone(kit);
  const c = flipped.evidence.envelope.ciphertext;
  flipped.evidence.envelope.ciphertext = (c[0] === "A" ? "B" : "A") + c.slice(1);
  await assert.rejects(openClaimKit(flipped, PASS), (e: unknown) => e instanceof ClaimKitError && e.code === "evidence");
});

test("a kit whose call, key or evidence name another policy does not parse", async () => {
  const { kit } = await fixture();
  assert.throws(() => parseClaimKit({ ...kit, call: { ...kit.call, policyId: OTHER } }), ClaimKitError);
  assert.throws(() => parseClaimKit({ ...kit, call: { ...kit.call, evidenceCommitment: "11".repeat(32) } }), ClaimKitError);
  assert.throws(() => parseClaimKit({ ...kit, policyKey: { ...kit.policyKey, policyId: OTHER } }), ClaimKitError);
  assert.throws(() => parseClaimKit({ ...kit, schema: "nope" }), ClaimKitError);
  assert.throws(() => parseClaimKit("{"), ClaimKitError);
});

test("buildClaimKit refuses a bundle for a different policy, a short passphrase, or an inconsistent key", async () => {
  const key = await makePolicyKey({ network: "preview", policyId: POLICY, coverage: 1n });
  const other = await sealEvidence(input(OTHER), { now: NOW });
  await assert.rejects(buildClaimKit({ key, sealed: other, passphrase: PASS, iterations: 1_000 }), (e: unknown) => e instanceof ClaimKitError && e.code === "mismatch");
  const sealed = await sealEvidence(input(), { now: NOW });
  await assert.rejects(buildClaimKit({ key, sealed, passphrase: "short", iterations: 1_000 }));
  const broken = { ...key, holderCommitment: "00".repeat(32) };
  await assert.rejects(buildClaimKit({ key: broken, sealed, passphrase: PASS, iterations: 1_000 }), (e: unknown) => e instanceof ClaimKitError && e.code === "key");
});
