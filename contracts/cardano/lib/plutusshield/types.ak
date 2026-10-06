//// Shared on-chain types for PlutusShield on Cardano.
////
//// All amounts are integers in the smallest unit of the tranche asset they
//// belong to (lovelace for ada, the stablecoin's base unit for USDC/USDCx).
//// All times are POSIX milliseconds. All rates are basis points (10_000 = 100%).
////
//// Multi-asset: one pool holds an independent *tranche* per accepted asset
//// (e.g. ada and USDCx). Each tranche has its own capital, LP share token,
//// active cover, and utilization. A policy is denominated in exactly one
//// tranche asset: its premium is paid in that asset and its payout is made in
//// that asset. Tranches never price against each other, so no FX oracle is
//// needed and one tranche's claims can never drain another's capital.

use cardano/address.{Address}
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

/// One accepted pool currency. Its position in `CoverParams.assets` is the
/// tranche index used by redeemers, the pool datum, and the LP token name.
pub type AssetTerms {
  /// `AssetClass { "", "" }` for ada, or e.g. USDCx `1f3aec8b…7e34.USDCx`.
  asset: AssetClass,
  /// Premium floor in this asset's base units (5 ADA = 5_000_000 lovelace).
  min_premium: Int,
}

/// Sale circuit-breaker. Stops buyers from purchasing cover into a depeg that
/// is already under way (adverse selection).
pub type SaleGuard {
  /// Minimum gap between the latest moment a `Buy` can land (its validity
  /// upper bound) and the policy's `start`. A depeg that begins inside this
  /// gap is never covered, because trigger windows must start at or after
  /// `start`. 0 disables the waiting period.
  waiting_period_ms: Int,
  /// A `Buy` must reference EVERY allowlisted feed (not just a quorum, so a
  /// buyer can't omit one that shows a depeg), each reporting a healthy peg
  /// (`price_bps >= trigger.threshold_bps`) with a `window_end` no older than
  /// this, measured from the Buy's validity upper bound. Must be > 0: the
  /// check is always on.
  max_price_age_ms: Int,
}

/// Validator parameters. Applied once at deployment; there is no admin key.
pub type CoverParams {
  /// UTxO consumed to mint the unique pool NFT (one-shot).
  seed: OutputReference,
  /// Accepted currencies for LP capital, premiums, and payouts, one tranche
  /// each. Distinct, non-empty, at most 255 (tranche index fits a byte).
  assets: List<AssetTerms>,
  product: ProductTerms,
  oracle: OracleConfig,
  /// After expiry, how long a holder still has to submit a claim for a
  /// trigger window that ended on or before expiry.
  claim_grace_ms: Int,
  /// Circuit-breaker applied to every `Buy`.
  sale_guard: SaleGuard,
}

/// Ledger of one tranche. Its capital is the quantity of the tranche asset
/// held by the pool UTxO itself (for ada: all lovelace in the pool UTxO).
pub type Tranche {
  /// Outstanding LP share tokens of this tranche (`lp` ‖ tranche index byte).
  total_shares: Int,
  /// Sum of coverage across live policies in this asset.
  active_cover: Int,
}

/// State of the underwriting pool, carried by the UTxO holding the pool NFT.
/// `tranches[i]` is the ledger for `CoverParams.assets[i]`.
pub type PoolDatum {
  tranches: List<Tranche>,
}

/// State of one policy, carried by the UTxO holding its reference token.
pub type PolicyDatum {
  /// 32 bytes: blake2b_256(cbor(pool output reference consumed at purchase)).
  /// Same id the Midnight `policy-cover` registry is keyed by.
  policy_id: ByteArray,
  product_id: ByteArray,
  /// Currency of `coverage`, `premium`, and the payout. Must be one of
  /// `CoverParams.assets`; it selects the tranche the policy draws on.
  asset: AssetClass,
  coverage: Int,
  premium: Int,
  start: Int,
  expiry: Int,
  trigger: Trigger,
  /// 32-byte Midnight registration commitment made by the buyer:
  /// registrationCommitment(policy_id, holder, coverage) in
  /// `policy-cover.compact`, which `registerPolicy` checks.
  midnight_commitment: ByteArray,
  /// Who gets the policy reference UTxO's min-ada back when the policy is
  /// retired by `Expire`. Set by the buyer at purchase (normally their own
  /// wallet address). `Expire` can be submitted by anyone, but must pay this
  /// address at least the reference UTxO's lovelace.
  refund_to: Address,
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
  /// LP adds capital to `tranche`; that tranche's LP shares minted pro rata.
  Deposit { tranche: Int }
  /// LP burns `shares` of `tranche` for their pro-rata capital in that asset,
  /// subject to the tranche's capital lock.
  Withdraw { tranche: Int, shares: Int }
  /// Buyer pays the premium, in the policy's asset, into that tranche and
  /// mints a policy (ref + user token). Needs fresh healthy-peg readings
  /// from every allowlisted feed and respects the waiting period (`CoverParams.sale_guard`).
  Buy
  /// Holder burns the policy and receives `coverage` from its tranche.
  Settle
  /// Anyone retires a policy after expiry + grace, unlocking its capital.
  /// The reference UTxO's min-ada goes back to `PolicyDatum.refund_to`.
  Expire
}
