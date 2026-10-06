//// Integer mirror of the `packages/sdk` quote engine.
////
//// The SDK quotes in floating point; on-chain we enforce a floor computed
//// with integer basis points and floor division, so an SDK quote for the
//// same inputs is always >= the on-chain minimum.

use aiken/math

pub const bps: Int = 10_000

pub const day_ms: Int = 86_400_000

/// SDK `UTILIZATION_KINK` = 0.7
pub const utilization_kink_bps: Int = 7_000

/// Kinked utilization curve in bps: 1.00x -> 1.25x at the kink, then
/// 1.25x -> 2.75x at 100% utilization. Same shape as SDK `utilizationMultiplier`.
pub fn utilization_multiplier_bps(u_bps: Int) -> Int {
  let u = math.clamp(u_bps, 0, bps)
  if u <= utilization_kink_bps {
    bps + 2_500 * u / utilization_kink_bps
  } else {
    12_500 + 15_000 * ( u - utilization_kink_bps ) / (
      bps - utilization_kink_bps
    )
  }
}

/// Minimum premium the pool accepts for `coverage` over `days`, given the
/// pool's capital and active cover *before* this policy.
pub fn required_premium(
  base_rate_bps: Int,
  risk_mult_bps: Int,
  min_premium: Int,
  coverage: Int,
  days: Int,
  capital: Int,
  active_cover: Int,
) -> Int {
  let u_before = active_cover * bps / capital
  let u_after = ( active_cover + coverage ) * bps / capital
  // Average of the two multipliers, like the SDK (sum here, /2 folded below).
  let m_sum = utilization_multiplier_bps(u_before) + utilization_multiplier_bps(
    u_after,
  )
  let priced = coverage * base_rate_bps * risk_mult_bps * m_sum * days / (
    bps * bps * 2 * bps * 365
  )
  math.max(min_premium, priced)
}

/// Single-policy cap and utilization cap, both against pre-purchase capital.
pub fn within_capacity(
  max_single_policy_bps: Int,
  max_utilization_bps: Int,
  coverage: Int,
  capital: Int,
  active_cover: Int,
) -> Bool {
  and {
    capital > 0,
    coverage * bps <= capital * max_single_policy_bps,
    ( active_cover + coverage ) * bps <= capital * max_utilization_bps,
  }
}

// ---------------------------------------------------------------- tests

test multiplier_endpoints() {
  and {
    utilization_multiplier_bps(0) == 10_000,
    utilization_multiplier_bps(7_000) == 12_500,
    utilization_multiplier_bps(10_000) == 27_500,
    // clamped
    utilization_multiplier_bps(-5) == 10_000,
    utilization_multiplier_bps(20_000) == 27_500,
  }
}

test multiplier_steeper_after_kink() {
  let before = utilization_multiplier_bps(6_000) - utilization_multiplier_bps(
    5_000,
  )
  let after = utilization_multiplier_bps(8_500) - utilization_multiplier_bps(
    7_500,
  )
  after > before * 3
}

/// Golden vector shared with packages/sdk (cardano.test.ts): depeg, tier B,
/// 10_000 units (6 decimals) for 365 days against a 1_000_000 / 300_000 pool.
/// SDK float quote = 221.79 units; on-chain floor = 221.78 units.
test premium_golden_vector_matches_sdk() {
  required_premium(
    200,
    10_000,
    5_000_000,
    10_000_000_000,
    365,
    1_000_000_000_000,
    300_000_000_000,
  ) == 221_780_000
}

test premium_floor_applies_to_tiny_policies() {
  required_premium(150, 8_000, 5_000_000, 100_000_000, 7, 1_000_000_000_000, 0) == 5_000_000
}

test capacity_rules_match_sdk_caps() {
  and {
    within_capacity(1_000, 9_000, 100_000, 1_000_000, 300_000),
    // > 10% of capital in one policy
    !within_capacity(1_000, 9_000, 150_000, 1_000_000, 300_000),
    // would push utilization past 90%
    !within_capacity(1_000, 9_000, 90_000, 1_000_000, 850_000),
    // empty pool sells nothing
    !within_capacity(1_000, 9_000, 1, 0, 0),
  }
}
