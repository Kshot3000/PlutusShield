//// Shared on-chain types for PlutusShield on Cardano.
////
//// All amounts are integers in the pool asset's smallest unit (lovelace, or
//// the stablecoin's base unit). All times are POSIX milliseconds. All rates
//// are basis points (10_000 = 100%).

use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{OutputReference}

/// A native asset identifier. `AssetClass { policy_id: "", asset_name: "" }` is ada.
pub type AssetClass {
  policy_id: PolicyId,
  asset_name: AssetName,
}

/// The objective condition a parametric policy pays out on.
///
/// Depeg example: `covered_asset` = "USDM", `threshold_bps` = 9_500 (price
/// below 0.95 of peg), `window_ms` = 86_400_000 (for at least 24h).
pub type Trigger {
  covered_asset: ByteArray,
  threshold_bps: Int,
  window_ms: Int,
}

/// One product line per deployment. Mirrors `packages/sdk` PRODUCTS + quote
/// engine constants, converted to integer basis points.
pub type ProductTerms {
  /// "depeg" | "exploit" | "sla" (matches SDK ProductId)
  product_id: ByteArray,
  trigger: Trigger,
  /// Base annual premium rate, e.g. 200 = 2.00%.
  base_rate_bps: Int,
  /// Risk-tier multiplier for the covered asset: A 8_000, B 10_000, C 15_000.
  risk_mult_bps: Int,
  min_days: Int,
  max_days: Int,
  /// Premium floor in pool-asset base units.
  min_premium: Int,
  /// One policy can take at most this share of pool capital (1_000 = 10%).
  max_single_policy_bps: Int,
  /// Active cover can never exceed this share of capital (9_000 = 90%).
  max_utilization_bps: Int,
}

/// Which oracle feeds are trusted. A feed is a UTxO, used as a reference
/// input, that holds exactly one token `policy_id.<feed name>` where the feed
/// name is in `feeds`. `quorum` distinct feeds must agree.
pub type OracleConfig {
  policy_id: PolicyId,
  feeds: List<AssetName>,
  quorum: Int,
}

/// Validator parameters. Applied once at deployment; there is no admin key.
pub type CoverParams {
  /// UTxO consumed to mint the unique pool NFT (one-shot).
  seed: OutputReference,
  /// Currency for LP capital, premiums, and payouts.
  pool_asset: AssetClass,
  product: ProductTerms,
  oracle: OracleConfig,
  /// After expiry, how long a holder still has to submit a claim for a
  /// trigger window that ended on or before expiry.
  claim_grace_ms: Int,
}

/// State of the underwriting pool, carried by the UTxO holding the pool NFT.
/// Capital is the pool asset quantity in that UTxO itself.
pub type PoolDatum {
  /// Outstanding LP share tokens.
  total_shares: Int,
  /// Sum of coverage across live policies (capital locked against claims).
  active_cover: Int,
}

/// State of one policy, carried by the UTxO holding its reference token.
pub type PolicyDatum {
  /// 32 bytes: blake2b_256(cbor(pool output reference consumed at purchase)).
  /// Same id the Midnight `policy-cover` registry is keyed by.
  policy_id: ByteArray,
  product_id: ByteArray,
  coverage: Int,
  premium: Int,
  start: Int,
  expiry: Int,
  trigger: Trigger,
  /// 32-byte Midnight coverage commitment (persistentCommit(amount, salt)),
  /// mirrored into `policy-cover.compact` by `registerPolicy`.
  midnight_commitment: ByteArray,
}

pub type CoverDatum {
  Pool(PoolDatum)
  Policy(PolicyDatum)
}

/// Shape of an authenticated oracle feed datum.
pub type OracleDatum {
  covered_asset: ByteArray,
  /// Time-weighted price over the window relative to peg (10_000 = 1.00).
  price_bps: Int,
  window_start: Int,
  window_end: Int,
}

pub type MintAction {
  /// Mint the pool NFT once, consuming `seed`.
  InitPool
  /// Any LP-share or policy-token mint/burn. Validated by the pool spend.
  ViaPool
  /// A holder may always burn their own policy user tokens (e.g. after expiry).
  BurnUserTokens
}

pub type PoolAction {
  /// LP adds capital; LP shares minted pro rata.
  Deposit
  /// LP burns `shares` for their pro-rata capital, subject to the reserve rule.
  Withdraw { shares: Int }
  /// Buyer pays premium into the pool and mints a policy (ref + user token).
  Buy
  /// Holder burns the policy and receives `coverage` from the pool.
  Settle
  /// Anyone retires a policy after expiry + grace, unlocking its capital.
  Expire
}
