import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCoverageCertificate,
  certTime,
  coverageCertificateFilename,
  coverageCertificateMarkdown,
  coverageCertificatePlainText,
  type CoverageCertificateInput,
} from "../src/index.ts";

const ID = "cd".repeat(32);
const DAY = 86_400_000;
const base: CoverageCertificateInput = {
  policyId: `0x${ID.toUpperCase()}`,
  product: "depeg",
  coverage: "250 tUSDCx",
  premium: "5 tUSDCx",
  asset: "USDM",
  start: Date.UTC(2026, 9, 13, 21, 0, 0),
  expiry: Date.UTC(2026, 10, 12, 21, 0, 0),
  claimGraceMs: 3 * DAY,
  network: "Cardano Preview",
  pool: "addr_test1wp89…tq4j5tgr",
  trackerUrl: `https://kshot3000.github.io/PlutusShield/policy/?id=${ID}`,
  termsUrl: "https://kshot3000.github.io/PlutusShield/docs/terms/",
  claimUrl: "https://kshot3000.github.io/PlutusShield/claim/",
  waitingPeriodMs: 3_600_000,
};

test("depeg certificate carries product, term, claim deadline and honest network flag", () => {
  const c = buildCoverageCertificate(base);
  assert.equal(c.title, "Certificate of Cover");
  assert.equal(c.product, "depeg");
  assert.equal(c.productLabel, "USDM depeg cover");
  assert.equal(c.policyId, ID);
  assert.equal(c.policyIdShort, `${ID.slice(0, 8)}…${ID.slice(-4)}`);
  assert.equal(c.coverage, "250 tUSDCx");
  assert.equal(c.premium, "5 tUSDCx");
  assert.equal(c.claimDeadline, base.expiry + 3 * DAY);
  assert.equal(c.waitingPeriodMs, 3_600_000);
  assert.match(c.trigger, /USDM peg below 95/);
  assert.ok(c.rows.some((r) => r.label === "Network" && /testnet; not audited/.test(r.value)));
  assert.ok(c.disclaimers.some((d) => /not a regulated insurance/i.test(d)));
  assert.equal(c.issuedAt, base.expiry);
});

test("exploit certificate uses committee trigger and optional Midnight commitment", () => {
  const c = buildCoverageCertificate({
    ...base,
    product: "exploit",
    premium: null,
    asset: "tADA",
    midnightCommitment: "0x" + "ab".repeat(32),
    claimUrl: `https://kshot3000.github.io/PlutusShield/claim/evidence/?policy=${ID}`,
    trigger: "Approved Midnight claim + 2-of-3 Settle",
    waitingPeriodMs: 600_000,
  });
  assert.equal(c.productLabel, "Smart-contract exploit cover");
  assert.equal(c.premium, null);
  assert.equal(c.midnightCommitment, "ab".repeat(32));
  assert.equal(c.trigger, "Approved Midnight claim + 2-of-3 Settle");
  assert.ok(c.rows.some((r) => r.label === "Waiting period" && r.value === "10 minutes"));
  assert.ok(c.rows.some((r) => r.label === "Midnight commitment"));
  assert.ok(!c.rows.some((r) => r.label === "Premium"));
});

test("filename uses the first eight hex of the policy id", () => {
  assert.equal(coverageCertificateFilename(base.policyId), "plutusshield-cover-cdcdcdcd.md");
  assert.equal(coverageCertificateFilename(ID), "plutusshield-cover-cdcdcdcd.md");
});

test("markdown and plain text contain the key fields", () => {
  const c = buildCoverageCertificate(base);
  const md = coverageCertificateMarkdown(c);
  assert.match(md, /^# Certificate of Cover\n/);
  assert.match(md, /\| Policy id \| cdcdcdcd/);
  assert.match(md, /250 tUSDCx/);
  assert.match(md, /Claim deadline/);
  assert.match(md, /docs\/terms/);
  assert.match(md, /not a regulated insurance/i);
  const plain = coverageCertificatePlainText(c);
  assert.match(plain, /^Certificate of Cover\n/);
  assert.match(plain, /Coverage: 250 tUSDCx/);
});

test("bad inputs throw clear errors", () => {
  assert.throws(() => buildCoverageCertificate({ ...base, policyId: "abc" }), /64 hex/);
  assert.throws(() => buildCoverageCertificate({ ...base, start: base.expiry }), /before expiry/);
  assert.throws(() => buildCoverageCertificate({ ...base, expiry: Number.NaN }), /expiry/);
  assert.throws(() => buildCoverageCertificate({ ...base, claimGraceMs: -1 }), /claimGraceMs/);
  assert.throws(() => buildCoverageCertificate({ ...base, coverage: "  " }), /coverage is required/);
});

test("claim deadline is expiry plus grace; null start is allowed", () => {
  const c = buildCoverageCertificate({ ...base, start: null, claimGraceMs: 7 * DAY });
  assert.equal(c.start, null);
  assert.equal(c.claimDeadline, base.expiry + 7 * DAY);
  assert.match(c.rows.find((r) => r.label === "Term")!.value, /^active until /);
  assert.equal(certTime(c.claimDeadline), certTime(base.expiry + 7 * DAY));
});

test("same input yields identical markdown (determinism)", () => {
  const a = coverageCertificateMarkdown(buildCoverageCertificate(base));
  const b = coverageCertificateMarkdown(buildCoverageCertificate({ ...base, issuedAt: undefined }));
  assert.equal(a, b);
  assert.equal(a, coverageCertificateMarkdown(buildCoverageCertificate(base)));
});

test("issuedAt override is respected and defaults to expiry", () => {
  const stamp = Date.UTC(2026, 9, 13, 12, 0, 0);
  const c = buildCoverageCertificate({ ...base, issuedAt: stamp });
  assert.equal(c.issuedAt, stamp);
  assert.ok(c.rows.some((r) => r.label === "Issued" && r.value === certTime(stamp)));
  assert.equal(buildCoverageCertificate(base).issuedAt, base.expiry);
});
