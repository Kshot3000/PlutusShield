import { test } from "node:test";
import assert from "node:assert/strict";
import { depegTrigger, productTerms, requiredPremium, textHex } from "../src/cardano.ts";
import {
  EMPTY_POOL,
  buy,
  deposit,
  expire,
  lockedCapital,
  maxWithdrawableShares,
  settle,
  shareValue,
  underwriterProjection,
  utilizationBps,
  withdraw,
  type PoolLedger,
} from "../src/pool.ts";

// Same fixture as contracts/cardano/validators/cover.ak tests.
const ADA = 1_000_000n;
const base: PoolLedger = { capital: 1_000_000n * ADA, totalShares: 1_000_000n * ADA, activeCover: 300_000n * ADA };
const terms = productTerms("depeg", "B", depegTrigger(textHex("USDM")));
const MAX_U = terms.maxUtilizationBps;

test("first deposit mints 1:1, later deposits mint pro rata (floored)", () => {
  const a = deposit(EMPTY_POOL, 500n * ADA);
  assert.ok(a.ok);
  assert.equal(a.shares, 500n * ADA);
  const grown: PoolLedger = { ...a.pool, capital: a.pool.capital + 50n * ADA }; // premiums accrued
  const b = deposit(grown, 110n * ADA);
  assert.ok(b.ok);
  assert.equal(b.shares, (110n * ADA * 500n * ADA) / (550n * ADA));
  assert.equal(b.shares, 100n * ADA);
  assert.equal(deposit(base, 0n).ok, false);
});

test("withdraw matches the validator's capital-lock fixtures", () => {
  assert.equal(withdraw(base, 660_000n * ADA, MAX_U).ok, true); // withdraw_up_to_capital_lock_ok
  assert.equal(withdraw(base, 700_000n * ADA, MAX_U).ok, false); // withdraw_below_capital_lock_fails
  const w = withdraw(base, 100_000n * ADA, MAX_U);
  assert.ok(w.ok);
  assert.equal(w.payout, 100_000n * ADA);
  assert.equal(w.pool.totalShares, 900_000n * ADA);
});

test("maxWithdrawableShares is the exact capital-lock boundary", () => {
  assert.equal(lockedCapital(base, MAX_U), 333_333_333_334n);
  const max = maxWithdrawableShares(base, MAX_U);
  assert.equal(max, 666_666_666_666n);
  assert.equal(withdraw(base, max, MAX_U).ok, true);
  assert.equal(withdraw(base, max + 1n, MAX_U).ok, false);
  assert.equal(maxWithdrawableShares(base, MAX_U, 10n * ADA), 10n * ADA);
  // Boundary also holds when shares and capital diverge.
  const odd: PoolLedger = { capital: 1_234_567_891n, totalShares: 987_654_321n, activeCover: 600_000_000n };
  const m = maxWithdrawableShares(odd, MAX_U);
  assert.equal(withdraw(odd, m, MAX_U).ok, true);
  assert.equal(withdraw(odd, m + 1n, MAX_U).ok, false);
});

test("buy charges the validator floor and enforces capacity", () => {
  const coverage = 10_000n * ADA;
  const r = buy(base, terms, coverage, 90n);
  assert.ok(r.ok);
  assert.equal(r.premium, requiredPremium(terms, coverage, 90n, base.capital, base.activeCover));
  assert.equal(r.pool.activeCover, base.activeCover + coverage);
  assert.equal(r.pool.capital, base.capital + r.premium);
  assert.equal(buy(base, terms, coverage, 90n, r.premium - 1n).ok, false);
  assert.equal(buy(base, terms, 100_001n * ADA, 90n).ok, false); // > 10% single-policy cap
  assert.equal(buy(base, terms, coverage, 7n).ok, false); // below min term
  const full: PoolLedger = { ...base, activeCover: 895_000n * ADA };
  assert.equal(buy(full, terms, coverage, 90n).ok, false); // would pass 90% utilization
});

test("settle pays coverage once; expire frees capacity without moving capital", () => {
  const s = settle(base, 10_000n * ADA);
  assert.ok(s.ok);
  assert.equal(s.pool.capital, base.capital - 10_000n * ADA);
  assert.equal(s.pool.activeCover, base.activeCover - 10_000n * ADA);
  const e = expire(base, 10_000n * ADA);
  assert.ok(e.ok);
  assert.equal(e.pool.capital, base.capital);
  assert.equal(settle({ ...base, activeCover: 0n }, 1n).ok, false);
});

test("solvency invariant holds across random action sequences", () => {
  let seed = 42;
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
  for (let run = 0; run < 50; run++) {
    let p: PoolLedger = EMPTY_POOL;
    const live: bigint[] = [];
    for (let i = 0; i < 200; i++) {
      const op = rnd(5);
      if (op === 0) {
        const r = deposit(p, BigInt(1 + rnd(50_000)) * ADA);
        if (r.ok) p = r.pool;
      } else if (op === 1 && p.totalShares > 0n) {
        const r = withdraw(p, BigInt(1 + rnd(Number(p.totalShares / ADA) + 1)) * ADA, MAX_U);
        if (r.ok) p = r.pool;
      } else if (op === 2) {
        const cov = BigInt(1 + rnd(20_000)) * ADA;
        const r = buy(p, terms, cov, BigInt(14 + rnd(352)));
        if (r.ok) (p = r.pool), live.push(cov);
      } else if (live.length) {
        const cov = live.splice(rnd(live.length), 1)[0];
        const r = op === 3 ? settle(p, cov) : expire(p, cov);
        assert.ok(r.ok);
        p = r.pool;
      }
      assert.ok(p.capital >= p.activeCover, "capital must back active cover");
      assert.ok(utilizationBps(p) <= MAX_U, "utilization cap");
      assert.ok(shareValue(p, p.totalShares) <= p.capital);
    }
  }
});

test("underwriter projection: premium APR, stress loss, break-even", () => {
  const p = underwriterProjection({
    product: "depeg",
    riskTier: "B",
    pool: { capital: 900_000, activeCover: 0 },
    deposit: 100_000,
    utilization: 0.7,
    claimRate: 0,
    horizonDays: 365,
  });
  assert.equal(p.ownership, 0.1);
  // 2% base x 1.0 tier x 1.25 at the kink = 2.5% on 70% of capital
  assert.ok(Math.abs(p.premiumApr - 0.0175) < 1e-12);
  assert.ok(Math.abs(p.breakEvenClaimRate - 0.025) < 1e-12);
  const stressed = underwriterProjection({
    product: "depeg",
    riskTier: "B",
    pool: { capital: 900_000, activeCover: 0 },
    deposit: 100_000,
    utilization: 0.7,
    claimRate: 0.05,
    horizonDays: 365,
  });
  assert.ok(stressed.net < 0);
  assert.ok(Math.abs(stressed.claimLoss - 3_500) < 1e-9);
});
