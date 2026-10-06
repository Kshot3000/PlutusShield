import { test } from "node:test";
import assert from "node:assert/strict";
import { blake2b256 } from "../src/blake2b.ts";
import {
  ADA,
  DAY_MS,
  assetTerms,
  initialPoolDatum,
  lpTokenName,
  premiumTerms,
  trancheOf,
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
  addressData,
  earliestStart,
  isHealthyReading,
  saleGuard,
  type CoverParams,
} from "../src/cardano.ts";
import { USDCX_MAINNET, USDCX_PREPROD, currencyAsset } from "../src/assets.ts";
import { quote, utilizationMultiplier } from "../src/index.ts";

// Golden vectors produced by `aiken check` in contracts/cardano
// (names.ak policy_id_golden_vector, cover.ak sdk_golden_vectors).
const POOL_REF = { txHash: "aa".repeat(32), outputIndex: 1 };
const BOUGHT_ID = "b189a9907d60e630671d5d1cf94f41a33aca2203ae5aa8926722bd65312868ed";
const T0 = 1_800_000_000_000n;
const terms = productTerms("depeg", "B", depegTrigger(textHex("USDM")));
const ASSETS = [assetTerms(ADA), assetTerms(USDCX_MAINNET)];
const adaPricing = premiumTerms(terms, ASSETS[0]);
// cover.ak `holder`: refund_to = address.from_verification_key(holder)
const HOLDER = { payment: { type: "Key" as const, hash: "4011de".repeat(9) + "40" } };

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
    asset: ADA,
    coverage: 10_000_000_000n,
    premium: 40_000_000n,
    start: T0,
    days: 30n,
    midnightCommitment: "c0441700".repeat(8),
    refundTo: HOLDER,
  });
  assert.equal(policy.expiry, T0 + 30n * DAY_MS);
  assert.equal(
    toCborHex(coverDatumData({ kind: "Policy", policy })),
    "d87a9fd8799f5820b189a9907d60e630671d5d1cf94f41a33aca2203ae5aa8926722bd65312868ed456465706567d8799f4040ff1b00000002540be4001a02625a001b000001a3185c50001b000001a3b2db1800d8799f445553444d19251c1a05265c00ff5820c0441700c0441700c0441700c0441700c0441700c0441700c0441700c0441700d8799fd8799f581c4011de4011de4011de4011de4011de4011de4011de4011de4011de40ffd87a80ffffff",
  );
  const usdPolicy = buildPolicyDatum({
    poolRef: POOL_REF,
    terms,
    asset: USDCX_MAINNET,
    coverage: 10_000_000_000n,
    premium: 17_670_410n,
    start: T0,
    days: 30n,
    midnightCommitment: "c0441700".repeat(8),
    refundTo: HOLDER,
  });
  assert.equal(
    toCborHex(coverDatumData({ kind: "Policy", policy: usdPolicy })),
    "d87a9fd8799f5820b189a9907d60e630671d5d1cf94f41a33aca2203ae5aa8926722bd65312868ed456465706567d8799f581c1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34455553444378ff1b00000002540be4001a010da10a1b000001a3185c50001b000001a3b2db1800d8799f445553444d19251c1a05265c00ff5820c0441700c0441700c0441700c0441700c0441700c0441700c0441700c0441700d8799fd8799f581c4011de4011de4011de4011de4011de4011de4011de4011de4011de40ffd87a80ffffff",
  );
  assert.equal(
    toCborHex(
      coverDatumData({
        kind: "Pool",
        pool: {
          tranches: [
            { totalShares: 1_000_000_000_000n, activeCover: 300_000_000_000n },
            { totalShares: 500_000_000_000n, activeCover: 100_000_000_000n },
          ],
        },
      }),
    ),
    "d8799fd8799f9fd8799f1b000000e8d4a510001b00000045d964b800ffd8799f1b000000746a5288001b000000174876e800ffffffff",
  );
  assert.equal(toCborHex(poolActionData({ kind: "Withdraw", tranche: 1, shares: 100_000_000_000n })), "d87a9f011b000000174876e800ff");
  assert.equal(toCborHex(poolActionData({ kind: "Deposit", tranche: 1 })), "d8799f01ff");
});

test("productTerms derives the validator parameters used in the Aiken tests", () => {
  const params: CoverParams = {
    seed: { txHash: "5eed".repeat(16), outputIndex: 0 },
    assets: ASSETS,
    product: terms,
    oracle: { policyId: "0aac1e".repeat(9) + "0a", feeds: ["feed-a", "feed-b", "feed-c"].map(textHex), quorum: 2n },
    claimGraceMs: 3n * DAY_MS,
    saleGuard: saleGuard(DAY_MS, 2n * 3_600_000n),
  };
  assert.equal(
    toCborHex(coverParamsData(params)),
    "d8799fd8799f58205eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed00ff9fd8799fd8799f4040ff1a004c4b40ffd8799fd8799f581c1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34455553444378ff1a004c4b40ffffd8799f456465706567d8799f445553444d19251c1a05265c00ff18c81927100e19016d1903e8192328ffd8799f581c0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0a9f46666565642d6146666565642d6246666565642d63ff02ff1a0f731400d8799f1a05265c001a006ddd00ffff",
  );
});

test("on-chain premium floor matches the Aiken golden vectors", () => {
  // pricing.ak premium_golden_vector_matches_sdk
  assert.equal(requiredPremium(adaPricing, 10_000_000_000n, 365n, 1_000_000_000_000n, 300_000_000_000n), 221_780_000n);
  // cover.ak buy_cover_pays_premium_and_mints_policy
  assert.equal(requiredPremium(adaPricing, 10_000_000_000n, 30n, 1_000_000_000_000n, 300_000_000_000n), 18_228_493n);
  // cover.ak usdc_buy_prices_against_usdc_tranche (USDC tranche 500k / 100k)
  const usdPricing = premiumTerms(terms, ASSETS[1]);
  assert.equal(requiredPremium(usdPricing, 10_000_000_000n, 30n, 500_000_000_000n, 100_000_000_000n), 17_670_410n);
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
          const pt = premiumTerms(t, assetTerms(ADA));
          const floor = requiredPremium(pt, ...args);
          // unrounded engine price >= integer floor
          const exact = Math.max(5, coverAmount * q.annualRate * (days / 365));
          assert.ok(BigInt(Math.ceil(exact * 1_000_000)) >= floor, `${product}/${riskTier}/${days}d/${activeCover}`);
          // what the dApp submits: never below the floor, never below the quote
          const pay = chainPremium(q.premium, pt, ...args);
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

test("tranche helpers mirror the validator", () => {
  assert.equal(lpTokenName(0), "6c7000");
  assert.equal(lpTokenName(1), "6c7001");
  assert.throws(() => lpTokenName(256));
  assert.equal(trancheOf(ASSETS, USDCX_MAINNET), 1);
  assert.equal(trancheOf(ASSETS, ADA), 0);
  assert.throws(() => trancheOf(ASSETS, USDCX_PREPROD));
  assert.deepEqual(initialPoolDatum(ASSETS), { tranches: [{ totalShares: 0n, activeCover: 0n }, { totalShares: 0n, activeCover: 0n }] });
});

test("USDC asset classes per network", () => {
  assert.equal(currencyAsset("USDC", "mainnet").policyId, "1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34");
  assert.equal(currencyAsset("USDC", "mainnet").assetName, textHex("USDCx"));
  assert.equal(currencyAsset("USDC", "preprod").policyId, "31dde3db98ad05feb688d4dbb146b3b6054e1246cbcef98c79b0bf66");
  assert.throws(() => currencyAsset("USDC", "preview"));
  assert.equal(currencyAsset("USDC", "preview", "ab".repeat(28)).assetName, textHex("tUSDCx"));
  assert.deepEqual(currencyAsset("ADA", "preview"), ADA);
});

test("USDC quotes clear the USDC tranche floor the same way ada quotes do", () => {
  const pt = premiumTerms(terms, ASSETS[1]);
  for (const days of [14, 30, 90, 365]) {
    for (const activeCover of [0, 100_000, 300_000]) {
      const q = quote({ product: "depeg", coverAmount: 20_000, days, riskTier: "B", pool: { capital: 500_000, activeCover } });
      if (!q.ok) continue;
      const args = [20_000n * 1_000_000n, BigInt(days), 500_000n * 1_000_000n, BigInt(activeCover) * 1_000_000n] as const;
      const pay = chainPremium(q.premium, pt, ...args);
      assert.ok(pay >= requiredPremium(pt, ...args));
    }
  }
});

test("Address encodes like Aiken's Address (key, script, with stake)", () => {
  assert.equal(toCborHex(addressData(HOLDER)), "d8799fd8799f581c" + "4011de".repeat(9) + "40ffd87a80ff");
  const withStake = addressData({ payment: { type: "Script", hash: "ab".repeat(28) }, stake: { type: "Key", hash: "cd".repeat(28) } });
  assert.equal(toCborHex(withStake), "d8799fd87a9f581c" + "ab".repeat(28) + "ffd8799fd8799fd8799f581c" + "cd".repeat(28) + "ffffffff");
});

test("sale guard mirrors the validator's circuit-breaker", () => {
  const g = saleGuard(DAY_MS, 2n * 3_600_000n);
  const saleBy = T0 - DAY_MS;
  assert.equal(earliestStart(g, saleBy), T0);
  const reading = (priceBps: bigint, windowEnd: bigint) => ({ coveredAsset: textHex("USDM"), priceBps, windowStart: windowEnd - DAY_MS, windowEnd });
  assert.equal(isHealthyReading(reading(9_990n, saleBy - 1_800_000n), terms.trigger, g, saleBy), true);
  assert.equal(isHealthyReading(reading(9_500n, saleBy), terms.trigger, g, saleBy), true, "at threshold is healthy");
  assert.equal(isHealthyReading(reading(9_100n, saleBy), terms.trigger, g, saleBy), false, "depeg under way");
  assert.equal(isHealthyReading(reading(10_000n, saleBy - 3n * 3_600_000n), terms.trigger, g, saleBy), false, "stale");
  assert.throws(() => saleGuard(0n, 0n));
  assert.throws(() => saleGuard(-1n));
});
