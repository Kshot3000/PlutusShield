import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPremiumReceipt,
  certTime,
  premiumReceiptFilename,
  premiumReceiptMarkdown,
  premiumReceiptPlainText,
  type PremiumReceiptInput,
} from "../src/index.ts";

const ID = "ab".repeat(32);
const BUY = "cd".repeat(32);
const base: PremiumReceiptInput = {
  policyId: `0x${ID.toUpperCase()}`,
  product: "depeg",
  coverage: "250 tUSDCx",
  premium: "5 ADA",
  asset: "USDM",
  premiumAsset: "ADA",
  boughtAt: Date.UTC(2026, 9, 13, 18, 0, 0),
  network: "Cardano Preview",
  pool: "addr_test1wp89…tq4j5tgr",
  buyTx: `0x${BUY.toUpperCase()}`,
  buyExplorerUrl: `https://preview.cexplorer.io/tx/${BUY}`,
  trackerUrl: `https://kshot3000.github.io/PlutusShield/policy/?id=${ID}`,
  termsUrl: "https://kshot3000.github.io/PlutusShield/docs/terms/",
  issuedAt: Date.UTC(2026, 9, 13, 18, 5, 0),
};

test("depeg receipt carries product, premium paid, buy tx and honest network flag", () => {
  const r = buildPremiumReceipt(base);
  assert.equal(r.title, "Premium receipt");
  assert.equal(r.product, "depeg");
  assert.equal(r.productLabel, "USDM depeg cover");
  assert.equal(r.policyId, ID);
  assert.equal(r.policyIdShort, `${ID.slice(0, 8)}…${ID.slice(-4)}`);
  assert.equal(r.coverage, "250 tUSDCx");
  assert.equal(r.premium, "5 ADA");
  assert.equal(r.buyTx, BUY);
  assert.equal(r.boughtAt, base.boughtAt);
  assert.ok(r.rows.some((row) => row.label === "Premium paid" && row.value === "5 ADA"));
  assert.ok(r.rows.some((row) => row.label === "Buy transaction" && row.value === BUY));
  assert.ok(r.rows.some((row) => row.label === "Explorer" && /preview\.cexplorer\.io/.test(row.value)));
  assert.ok(r.rows.some((row) => row.label === "Network" && /testnet; not audited/.test(row.value)));
  assert.ok(r.disclaimers.some((d) => /not a regulated insurance/i.test(d)));
  assert.ok(r.disclaimers.some((d) => /proves only the Buy payment facts/i.test(d)));
  assert.equal(r.issuedAt, base.issuedAt);
});

test("exploit product label and optional Midnight commitment", () => {
  const r = buildPremiumReceipt({
    ...base,
    product: "exploit",
    asset: "tADA",
    premiumAsset: "tUSDCx",
    midnightCommitment: "0x" + "ef".repeat(32),
    tranche: "tADA tranche 0",
  });
  assert.equal(r.productLabel, "Smart-contract exploit cover");
  assert.equal(r.midnightCommitment, "ef".repeat(32));
  assert.ok(r.rows.some((row) => row.label === "Midnight commitment"));
  assert.ok(r.rows.some((row) => row.label === "Tranche" && row.value === "tADA tranche 0"));
  assert.ok(r.rows.some((row) => row.label === "Premium asset" && row.value === "tUSDCx"));
});

test("filename uses the first eight hex of the policy id", () => {
  assert.equal(premiumReceiptFilename(base.policyId), "plutusshield-receipt-abababab.md");
  assert.equal(premiumReceiptFilename(ID), "plutusshield-receipt-abababab.md");
});

test("markdown table and plain text contain the key fields", () => {
  const r = buildPremiumReceipt(base);
  const md = premiumReceiptMarkdown(r);
  assert.match(md, /^# Premium receipt\n/);
  assert.match(md, /\| Policy id \| abababab/);
  assert.match(md, /\| Premium paid \| 5 ADA \|/);
  assert.match(md, /Buy transaction/);
  assert.match(md, /docs\/terms/);
  assert.match(md, /not a regulated insurance/i);
  const plain = premiumReceiptPlainText(r);
  assert.match(plain, /^Premium receipt\n/);
  assert.match(plain, /Premium paid: 5 ADA/);
  assert.match(plain, /Buy transaction: /);
});

test("rejects bad policyId, buyTx, empty premium, empty coverage", () => {
  assert.throws(() => buildPremiumReceipt({ ...base, policyId: "abc" }), /policyId must be 64 hex/);
  assert.throws(() => buildPremiumReceipt({ ...base, buyTx: "deadbeef" }), /buyTx must be 64 hex/);
  assert.throws(() => buildPremiumReceipt({ ...base, premium: "  " }), /premium is required/);
  assert.throws(() => buildPremiumReceipt({ ...base, coverage: "" }), /coverage is required/);
  assert.throws(
    () => buildPremiumReceipt({ ...base, boughtAt: null, issuedAt: undefined }),
    /boughtAt or issuedAt/,
  );
  assert.throws(() => buildPremiumReceipt({ ...base, buyExplorerUrl: "/tx/x" }), /buyExplorerUrl/);
});

test("0x and case normalization on policyId and buyTx", () => {
  const r = buildPremiumReceipt({
    ...base,
    policyId: `0x${ID.toUpperCase()}`,
    buyTx: BUY.toUpperCase(),
  });
  assert.equal(r.policyId, ID);
  assert.equal(r.buyTx, BUY);
  const r2 = buildPremiumReceipt({
    ...base,
    policyId: ID,
    buyTx: `0x${BUY}`,
  });
  assert.equal(r2.policyId, ID);
  assert.equal(r2.buyTx, BUY);
});

test("same input yields identical markdown (determinism)", () => {
  const a = premiumReceiptMarkdown(buildPremiumReceipt(base));
  const b = premiumReceiptMarkdown(buildPremiumReceipt({ ...base }));
  assert.equal(a, b);
  assert.equal(a, premiumReceiptMarkdown(buildPremiumReceipt(base)));
});

test("issuedAt defaults to boughtAt; certTime formatting matches", () => {
  const boughtAt = Date.UTC(2026, 9, 13, 17, 30, 0);
  const r = buildPremiumReceipt({ ...base, boughtAt, issuedAt: undefined });
  assert.equal(r.issuedAt, boughtAt);
  assert.ok(r.rows.some((row) => row.label === "Issued" && row.value === certTime(boughtAt)));
  assert.ok(r.rows.some((row) => row.label === "Bought at" && row.value === certTime(boughtAt)));
  const stamp = Date.UTC(2026, 9, 14, 12, 0, 0);
  const r2 = buildPremiumReceipt({ ...base, boughtAt: null, issuedAt: stamp });
  assert.equal(r2.issuedAt, stamp);
  assert.equal(r2.boughtAt, null);
  assert.ok(!r2.rows.some((row) => row.label === "Bought at"));
});
