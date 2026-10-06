import { test } from "node:test";
import assert from "node:assert/strict";
import { blake2b256 } from "../src/blake2b.ts";
import {
  ADA,
  DAY_MS,
  buildPolicyDatum,
  bytesToHex,
  chainPremium,
  coverDatumData,
  coverParamsData,
  depegTrigger,
  poolActionData,
  policyIdFrom,
  productTerms,
  refTokenName,
  requiredPremium,
  textHex,
  toCborHex,
  userTokenName,
  utilizationMultiplierBps,
  withinCapacity,
  type CoverParams,
} from "../src/cardano.ts";
import { quote, utilizationMultiplier } from "../src/index.ts";

// Golden vectors produced by `aiken check` in contracts/cardano
// (names.ak policy_id_golden_vector, cover.ak sdk_golden_vectors).
const POOL_REF = { txHash: "aa".repeat(32), outputIndex: 1 };
const BOUGHT_ID = "b189a9907d60e630671d5d1cf94f41a33aca2203ae5aa8926722bd65312868ed";
const T0 = 1_800_000_000_000n;
const terms = productTerms("depeg", "B", depegTrigger(textHex("USDM")));

test("blake2b-256 matches the RFC 7693 empty-input vector", () => {
  assert.equal(
    bytesToHex(blake2b256(new Uint8Array())),
    "0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8",
  );
});

test("policy ids match the Aiken validator byte-for-byte", () => {
  assert.equal(
    policyIdFrom({ txHash: "01".repeat(32), outputIndex: 0 }),
    "f548355b76a9d34c085f05020ac0437fa82804e72b3d9660710dbb78daea9aa4",
  );
  assert.equal(policyIdFrom(POOL_REF), BOUGHT_ID);
  assert.equal(refTokenName(BOUGHT_ID).length, 64);
  assert.ok(refTokenName(BOUGHT_ID).startsWith("000643b0"));
  assert.ok(userTokenName(BOUGHT_ID).startsWith("000de140"));
});

test("PolicyDatum / PoolDatum / redeemer CBOR match Aiken", () => {
  const policy = buildPolicyDatum({
    poolRef: POOL_REF,
    terms,
    coverage: 10_000_000_000n,
    premium: 40_000_000n,
    start: T0,
    days: 30n,
    midnightCommitment: "c0441700".repeat(8),
  });
  assert.equal(policy.expiry, T0 + 30n * DAY_MS);
  assert.equal(
    toCborHex(coverDatumData({ kind: "Policy", policy })),
    "d87a9fd8799f5820b189a9907d60e630671d5d1cf94f41a33aca2203ae5aa8926722bd65312868ed4564657065671b00000002540be4001a02625a001b000001a3185c50001b000001a3b2db1800d8799f445553444d19251c1a05265c00ff5820c0441700c0441700c0441700c0441700c0441700c0441700c0441700c0441700ffff",
  );
  assert.equal(
    toCborHex(coverDatumData({ kind: "Pool", pool: { totalShares: 1_000_000_000_000n, activeCover: 300_000_000_000n } })),
    "d8799fd8799f1b000000e8d4a510001b00000045d964b800ffff",
  );
  assert.equal(toCborHex(poolActionData({ kind: "Withdraw", shares: 100_000_000_000n })), "d87a9f1b000000174876e800ff");
});

test("productTerms derives the validator parameters used in the Aiken tests", () => {
  const params: CoverParams = {
    seed: { txHash: "5eed".repeat(16), outputIndex: 0 },
    poolAsset: ADA,
    product: terms,
    oracle: { policyId: "0aac1e".repeat(9) + "0a", feeds: ["feed-a", "feed-b", "feed-c"].map(textHex), quorum: 2n },
    claimGraceMs: 3n * DAY_MS,
  };
  assert.equal(
    toCborHex(coverParamsData(params)),
    "d8799fd8799f58205eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed00ffd8799f4040ffd8799f456465706567d8799f445553444d19251c1a05265c00ff18c81927100e19016d1a004c4b401903e8192328ffd8799f581c0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0a9f46666565642d6146666565642d6246666565642d63ff02ff1a0f731400ff",
  );
});

test("on-chain premium floor matches the Aiken golden vectors", () => {
  // pricing.ak premium_golden_vector_matches_sdk
  assert.equal(requiredPremium(terms, 10_000_000_000n, 365n, 1_000_000_000_000n, 300_000_000_000n), 221_780_000n);
  // cover.ak buy_cover_pays_premium_and_mints_policy
  assert.equal(requiredPremium(terms, 10_000_000_000n, 30n, 1_000_000_000_000n, 300_000_000_000n), 18_228_493n);
});

test("SDK pricing and chainPremium always clear the on-chain floor", () => {
  const tiers = ["A", "B", "C"] as const;
  for (const product of ["depeg", "exploit", "sla"] as const) {
    for (const riskTier of tiers) {
      for (const days of [14, 30, 90, 180]) {
        for (const activeCover of [0, 300_000, 650_000, 780_000]) {
          const coverAmount = 25_000;
          const pool = { capital: 1_000_000, activeCover };
          const q = quote({ product, coverAmount, days, riskTier, pool });
          if (!q.ok) continue;
          const t = productTerms(product, riskTier, depegTrigger(textHex("USDM")));
          const args = [BigInt(coverAmount) * 1_000_000n, BigInt(days), BigInt(pool.capital) * 1_000_000n, BigInt(activeCover) * 1_000_000n] as const;
          const floor = requiredPremium(t, ...args);
          // unrounded engine price >= integer floor
          const exact = Math.max(5, coverAmount * q.annualRate * (days / 365));
          assert.ok(BigInt(Math.ceil(exact * 1_000_000)) >= floor, `${product}/${riskTier}/${days}d/${activeCover}`);
          // what the dApp submits: never below the floor, never below the quote
          const pay = chainPremium(q.premium, t, ...args);
          assert.ok(pay >= floor && pay >= BigInt(Math.ceil(q.premium * 1_000_000)));
          // and never more than a cent above the engine's exact price
          assert.ok(Number(pay) - exact * 1_000_000 <= 10_000);
        }
      }
    }
  }
});

test("integer utilization curve tracks the float curve within 1bp", () => {
  for (let u = 0; u <= 10_000; u += 250) {
    const diff = Math.abs(Number(utilizationMultiplierBps(BigInt(u))) - utilizationMultiplier(u / 10_000) * 10_000);
    assert.ok(diff <= 1, `u=${u} diff=${diff}`);
  }
});

test("capacity rules mirror the quote engine caps", () => {
  assert.equal(withinCapacity(terms, 100_000n, 1_000_000n, 300_000n), true);
  assert.equal(withinCapacity(terms, 150_000n, 1_000_000n, 300_000n), false);
  assert.equal(withinCapacity(terms, 90_000n, 1_000_000n, 850_000n), false);
});
