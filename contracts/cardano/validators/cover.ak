//// PlutusShield cover validator (Plutus V3).
////
//// One parameterised multi-validator: its hash is both the minting policy of
//// every PlutusShield token (pool NFT, LP shares, policy ref/user tokens) and
//// the payment credential that locks the pool and policy reference UTxOs.
////
////   pool UTxO      pool NFT + capital, datum Pool(PoolDatum)
////   policy UTxO    policy reference token, datum Policy(PolicyDatum)
////   user token     sent to the buyer; burning it is the right to claim
////
//// Every LP or policy action spends the pool UTxO, and the pool spend checks
//// the exact mint/burn, capital movement, and next pool datum. There is no
//// admin key: all configuration is fixed in `CoverParams` at deployment.

use aiken/cbor
use aiken/collection/dict
use aiken/collection/list
use aiken/interval.{Finite}
use aiken/primitive/bytearray
use cardano/address.{Script}
use cardano/assets.{AssetName, Assets, PolicyId}
use cardano/transaction.{
  Datum, InlineDatum, Input, Output, OutputReference, Transaction, ValidityRange,
}
use plutusshield/names.{
  is_user_name, lp_token, policy_id_from, pool_nft, ref_name, user_name,
}
use plutusshield/oracle
use plutusshield/pricing.{bps, day_ms}
use plutusshield/types.{
  AssetClass, BurnUserTokens, Buy, CoverDatum, CoverParams, Deposit, Expire,
  InitPool, MintAction, OracleConfig, OracleDatum, Policy, PolicyDatum, Pool,
  PoolAction, PoolDatum, ProductTerms, Settle, Trigger, ViaPool, Withdraw,
}

validator cover(params: CoverParams) {
  mint(redeemer: MintAction, own: PolicyId, self: Transaction) {
    when redeemer is {
      InitPool -> validate_init(params, own, self)
      // Delegated: the pool spend validates this transaction's exact mint.
      ViaPool ->
        list.any(
          self.inputs,
          fn(i) { assets.quantity_of(i.output.value, own, pool_nft) == 1 },
        )
      // Burning your own claim right is always allowed and harms no one else.
      BurnUserTokens -> {
        let minted = own_mint(self.mint, own)
        minted != [] && list.all(
          minted,
          fn(pair) {
            let Pair(name, qty) = pair
            qty < 0 && is_user_name(name)
          },
        )
      }
    }
  }

  spend(
    datum: Option<CoverDatum>,
    redeemer: PoolAction,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(d) = datum
    expect Some(own_in) = transaction.find_input(self.inputs, own_ref)
    expect Script(own) = own_in.output.address.payment_credential
    when d is {
      Pool(pool) -> and {
          // Only the genuine pool UTxO (holding the NFT) can be spent as a pool.
          assets.quantity_of(own_in.output.value, own, pool_nft) == 1,
          validate_pool(params, own, own_in, pool, redeemer, self),
        }
      // A policy UTxO is released only when its reference token is burned,
      // which in turn requires the pool spend to approve Settle or Expire.
      Policy(p) -> {
        let r = ref_name(p.policy_id)
        and {
          assets.quantity_of(own_in.output.value, own, r) == 1,
          assets.quantity_of(self.mint, own, r) == -1,
        }
      }
    }
  }

  else(_) {
    fail
  }
}

// ---------------------------------------------------------------- init

fn validate_init(params: CoverParams, own: PolicyId, self: Transaction) -> Bool {
  expect [Pair(name, qty)] = own_mint(self.mint, own)
  expect [pool_out] = outputs_with(self.outputs, own, pool_nft)
  and {
    name == pool_nft,
    qty == 1,
    list.any(self.inputs, fn(i) { i.output_reference == params.seed }),
    pool_out.address.payment_credential == Script(own),
    pool_out.datum == pool_datum(PoolDatum { total_shares: 0, active_cover: 0 }),
    pool_value_ok(
      pool_out.value,
      own,
      params.pool_asset,
      asset_qty(pool_out.value, params.pool_asset),
    ),
    params_ok(params),
  }
}

/// A misconfigured deployment cannot even initialise its pool.
pub fn params_ok(params: CoverParams) -> Bool {
  let p = params.product
  let o = params.oracle
  and {
    o.quorum >= 1,
    o.quorum <= list.length(o.feeds),
    p.trigger.threshold_bps > 0,
    p.trigger.threshold_bps <= bps,
    p.trigger.window_ms > 0,
    p.base_rate_bps > 0,
    p.risk_mult_bps > 0,
    p.min_days >= 1,
    p.min_days <= p.max_days,
    p.min_premium >= 0,
    p.max_single_policy_bps > 0,
    p.max_single_policy_bps <= p.max_utilization_bps,
    p.max_utilization_bps <= bps,
    params.claim_grace_ms >= 0,
  }
}

// ---------------------------------------------------------------- pool

fn validate_pool(
  params: CoverParams,
  own: PolicyId,
  pool_in: Input,
  pool: PoolDatum,
  action: PoolAction,
  self: Transaction,
) -> Bool {
  let pa = params.pool_asset
  let capital = asset_qty(pool_in.output.value, pa)
  expect [pool_out] = outputs_with(self.outputs, own, pool_nft)
  expect InlineDatum(raw) = pool_out.datum
  expect Pool(next): CoverDatum = raw
  let out_capital = asset_qty(pool_out.value, pa)
  let minted = own_mint(self.mint, own)
  let continuing = and {
    pool_out.address == pool_in.output.address,
    pool_value_ok(pool_out.value, own, pa, out_capital),
    pa.policy_id == assets.ada_policy_id || assets.lovelace_of(pool_out.value) >= assets.lovelace_of(
      pool_in.output.value,
    ),
  }
  continuing && when action is {
    Deposit -> {
      let amount = out_capital - capital
      let shares = if pool.total_shares == 0 {
        amount
      } else {
        expect capital > 0
        amount * pool.total_shares / capital
      }
      and {
        amount > 0,
        shares > 0,
        minted == [Pair(lp_token, shares)],
        next == PoolDatum {
          total_shares: pool.total_shares + shares,
          active_cover: pool.active_cover,
        },
      }
    }

    Withdraw { shares } -> {
      expect shares > 0 && shares <= pool.total_shares
      let payout = shares * capital / pool.total_shares
      and {
        out_capital == capital - payout,
        minted == [Pair(lp_token, -shares)],
        next == PoolDatum {
          total_shares: pool.total_shares - shares,
          active_cover: pool.active_cover,
        },
        // Capital lock: remaining capital must still back active cover at
        // the product's max utilization.
        pool.active_cover * bps <= out_capital * params.product.max_utilization_bps,
      }
    }

    Buy ->
      validate_buy(
        params,
        own,
        pool_in,
        pool,
        capital,
        out_capital,
        next,
        minted,
        self,
      )

    Settle -> {
      expect [Pair(r, rq), Pair(u, uq)] = minted
      let (policy_in, p) = policy_input(self.inputs, own, r)
      and {
        rq == -1,
        uq == -1,
        r == ref_name(p.policy_id),
        u == user_name(p.policy_id),
        // Claim window: trigger window must sit inside [start, expiry]
        // (checked by the oracle), and the claim lands before grace ends.
        upper_bound(self.validity_range) <= p.expiry + params.claim_grace_ms,
        oracle.triggered(
          self.reference_inputs,
          params.oracle,
          p.trigger,
          p.start,
          p.expiry,
        ),
        // Pool pays exactly the coverage, once.
        out_capital == capital - p.coverage,
        next == PoolDatum {
          total_shares: pool.total_shares,
          active_cover: pool.active_cover - p.coverage,
        },
        policy_in.output.address.payment_credential == Script(own),
      }
    }

    Expire -> {
      expect [Pair(r, rq), ..rest] = minted
      let (_, p) = policy_input(self.inputs, own, r)
      and {
        rq == -1,
        r == ref_name(p.policy_id),
        // The holder's user token may be burned in the same tx, or later.
        rest == [] || rest == [Pair(user_name(p.policy_id), -1)],
        lower_bound(self.validity_range) > p.expiry + params.claim_grace_ms,
        out_capital == capital,
        next == PoolDatum {
          total_shares: pool.total_shares,
          active_cover: pool.active_cover - p.coverage,
        },
      }
    }
  }
}

fn validate_buy(
  params: CoverParams,
  own: PolicyId,
  pool_in: Input,
  pool: PoolDatum,
  capital: Int,
  out_capital: Int,
  next: PoolDatum,
  minted: Pairs<AssetName, Int>,
  self: Transaction,
) -> Bool {
  let product = params.product
  let id = policy_id_from(pool_in.output_reference)
  let r = ref_name(id)
  expect [ref_out] = outputs_with(self.outputs, own, r)
  expect InlineDatum(raw) = ref_out.datum
  expect Policy(p): CoverDatum = raw
  let premium = out_capital - capital
  let duration = p.expiry - p.start
  let days = duration / day_ms
  and {
    ref_out.address.payment_credential == Script(own),
    assets.without_lovelace(ref_out.value) == assets.from_asset(own, r, 1),
    minted == [Pair(r, 1), Pair(user_name(id), 1)],
    p.policy_id == id,
    // Terms are fixed by the product, not chosen by the buyer.
    p.product_id == product.product_id,
    p.trigger == product.trigger,
    bytearray.length(p.midnight_commitment) == 32,
    p.coverage > 0,
    p.premium == premium,
    duration > 0,
    duration % day_ms == 0,
    days >= product.min_days,
    days <= product.max_days,
    // No backdating: cover starts no earlier than the tx can land.
    upper_bound(self.validity_range) <= p.start,
    pricing.within_capacity(
      product.max_single_policy_bps,
      product.max_utilization_bps,
      p.coverage,
      capital,
      pool.active_cover,
    ),
    premium >= pricing.required_premium(
      product.base_rate_bps,
      product.risk_mult_bps,
      product.min_premium,
      p.coverage,
      days,
      capital,
      pool.active_cover,
    ),
    next == PoolDatum {
      total_shares: pool.total_shares,
      active_cover: pool.active_cover + p.coverage,
    },
  }
}

// ---------------------------------------------------------------- helpers

fn own_mint(mint: Assets, own: PolicyId) -> Pairs<AssetName, Int> {
  assets.tokens(mint, own) |> dict.to_pairs
}

fn asset_qty(value: Assets, asset: AssetClass) -> Int {
  assets.quantity_of(value, asset.policy_id, asset.asset_name)
}

fn outputs_with(
  outputs: List<Output>,
  own: PolicyId,
  name: AssetName,
) -> List<Output> {
  list.filter(outputs, fn(o) { assets.quantity_of(o.value, own, name) == 1 })
}

/// The single input holding reference token `r`, with its policy datum.
fn policy_input(
  inputs: List<Input>,
  own: PolicyId,
  r: AssetName,
) -> (Input, PolicyDatum) {
  expect [input] = list.filter(
    inputs,
    fn(i) { assets.quantity_of(i.output.value, own, r) == 1 },
  )
  expect InlineDatum(raw) = input.output.datum
  expect Policy(p): CoverDatum = raw
  (input, p)
}

/// Pool UTxO carries only: ada, the pool NFT, and (if not ada) the pool asset.
fn pool_value_ok(
  value: Assets,
  own: PolicyId,
  pa: AssetClass,
  capital: Int,
) -> Bool {
  let nft = assets.from_asset(own, pool_nft, 1)
  let expected = if pa.policy_id == assets.ada_policy_id {
    nft
  } else {
    assets.add(nft, pa.policy_id, pa.asset_name, capital)
  }
  assets.without_lovelace(value) == expected
}

fn pool_datum(d: PoolDatum) -> Datum {
  let data: Data = Pool(d)
  InlineDatum(data)
}

fn upper_bound(range: ValidityRange) -> Int {
  when range.upper_bound.bound_type is {
    Finite(t) -> t
    _ -> fail @"validity range needs a finite upper bound"
  }
}

fn lower_bound(range: ValidityRange) -> Int {
  when range.lower_bound.bound_type is {
    Finite(t) -> t
    _ -> fail @"validity range needs a finite lower bound"
  }
}

// ================================================================ tests
//
// Fixtures: an ada-denominated depeg pool for USDM at tier B, 2-of-3 oracle
// quorum, 3-day claim grace. Times are POSIX ms.

const own: PolicyId =
  #"c0fec0fec0fec0fec0fec0fec0fec0fec0fec0fec0fec0fec0fec0fe"

const oracle_policy: PolicyId =
  #"0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0a"

const seed =
  OutputReference {
    transaction_id: #"5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed",
    output_index: 0,
  }

const depeg_trigger =
  Trigger { covered_asset: "USDM", threshold_bps: 9_500, window_ms: 86_400_000 }

const test_params =
  CoverParams {
    seed,
    pool_asset: AssetClass { policy_id: "", asset_name: "" },
    product: ProductTerms {
      product_id: "depeg",
      trigger: depeg_trigger,
      base_rate_bps: 200,
      risk_mult_bps: 10_000,
      min_days: 14,
      max_days: 365,
      min_premium: 5_000_000,
      max_single_policy_bps: 1_000,
      max_utilization_bps: 9_000,
    },
    oracle: OracleConfig {
      policy_id: oracle_policy,
      feeds: ["feed-a", "feed-b", "feed-c"],
      quorum: 2,
    },
    claim_grace_ms: 3 * 86_400_000,
  }

const t0 = 1_800_000_000_000

const expiry = t0 + 30 * 86_400_000

const capital = 1_000_000_000_000

const active = 300_000_000_000

const shares = 1_000_000_000_000

const coverage = 10_000_000_000

const pool_ref =
  OutputReference {
    transaction_id: #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    output_index: 1,
  }

const policy_ref =
  OutputReference {
    transaction_id: #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    output_index: 0,
  }

const holder: ByteArray =
  #"4011de4011de4011de4011de4011de4011de4011de4011de4011de40"

const commitment: ByteArray =
  #"c0441700c0441700c0441700c0441700c0441700c0441700c0441700c0441700"

fn pool_out(cap: Int, total: Int, act: Int) -> Output {
  Output {
    address: address.from_script(own),
    value: assets.from_lovelace(cap) |> assets.add(own, pool_nft, 1),
    datum: pool_datum(PoolDatum { total_shares: total, active_cover: act }),
    reference_script: None,
  }
}

fn pool_in(cap: Int, total: Int, act: Int) -> Input {
  Input { output_reference: pool_ref, output: pool_out(cap, total, act) }
}

fn wallet_out(value: Assets) -> Output {
  Output {
    address: address.from_verification_key(holder),
    value,
    datum: transaction.NoDatum,
    reference_script: None,
  }
}

fn spend_pool(d: PoolDatum, action: PoolAction, tx: Transaction) -> Bool {
  cover.spend(test_params, Some(Pool(d)), action, pool_ref, tx)
}

fn base_pool() -> PoolDatum {
  PoolDatum { total_shares: shares, active_cover: active }
}

// The policy bought from `pool_ref`, so its id is derived from it.
fn bought_id() -> ByteArray {
  policy_id_from(pool_ref)
}

fn policy(cov: Int, premium: Int, start: Int, end: Int) -> PolicyDatum {
  PolicyDatum {
    policy_id: bought_id(),
    product_id: "depeg",
    coverage: cov,
    premium,
    start,
    expiry: end,
    trigger: depeg_trigger,
    midnight_commitment: commitment,
  }
}

fn policy_out(p: PolicyDatum) -> Output {
  let data: Data = Policy(p)
  Output {
    address: address.from_script(own),
    value: assets.from_lovelace(2_000_000)
      |> assets.add(own, ref_name(p.policy_id), 1),
    datum: InlineDatum(data),
    reference_script: None,
  }
}

// ---------------------------------------------------------------- init

fn init_tx(with_seed: Bool) -> Transaction {
  Transaction {
    ..transaction.placeholder,
    inputs: if with_seed {
      [
        Input {
          output_reference: seed,
          output: wallet_out(assets.from_lovelace(10_000_000)),
        },
      ]
    } else {
      []
    },
    outputs: [pool_out(2_000_000, 0, 0)],
    mint: assets.from_asset(own, pool_nft, 1),
  }
}

test init_pool_consumes_seed() {
  cover.mint(test_params, InitPool, own, init_tx(True))
}

test init_pool_without_seed_fails() fail {
  cover.mint(test_params, InitPool, own, init_tx(False))
}

test init_pool_rejects_zero_quorum_params() fail {
  let bad = CoverParams {
    ..test_params,
    oracle: OracleConfig { ..test_params.oracle, quorum: 0 },
  }
  cover.mint(bad, InitPool, own, init_tx(True))
}

// ---------------------------------------------------------------- LP

fn deposit_tx(amount: Int, minted_shares: Int, next_total: Int) -> Transaction {
  Transaction {
    ..transaction.placeholder,
    inputs: [pool_in(capital, shares, active)],
    outputs: [pool_out(capital + amount, next_total, active)],
    mint: assets.from_asset(own, lp_token, minted_shares),
  }
}

test deposit_mints_pro_rata_shares() {
  // share price is 1.0 here, so 50k ada -> 50k ada of shares
  let tx = deposit_tx(50_000_000_000, 50_000_000_000, shares + 50_000_000_000)
  spend_pool(base_pool(), Deposit, tx) && cover.mint(
    test_params,
    ViaPool,
    own,
    tx,
  )
}

test first_deposit_into_empty_pool() {
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [pool_in(2_000_000, 0, 0)],
    outputs: [pool_out(2_000_000 + 100_000_000, 100_000_000, 0)],
    mint: assets.from_asset(own, lp_token, 100_000_000),
  }
  spend_pool(PoolDatum { total_shares: 0, active_cover: 0 }, Deposit, tx)
}

test deposit_overminting_shares_fails() fail {
  let tx = deposit_tx(50_000_000_000, 60_000_000_000, shares + 60_000_000_000)
  spend_pool(base_pool(), Deposit, tx)
}

fn withdraw_tx(burn: Int, out_cap: Int) -> Transaction {
  Transaction {
    ..transaction.placeholder,
    inputs: [pool_in(capital, shares, active)],
    outputs: [
      pool_out(out_cap, shares - burn, active),
      wallet_out(assets.from_lovelace(capital - out_cap)),
    ],
    mint: assets.from_asset(own, lp_token, -burn),
  }
}

test withdraw_pro_rata() {
  spend_pool(
    base_pool(),
    Withdraw { shares: 100_000_000_000 },
    withdraw_tx(100_000_000_000, capital - 100_000_000_000),
  )
}

test withdraw_more_than_share_value_fails() fail {
  spend_pool(
    base_pool(),
    Withdraw { shares: 100_000_000_000 },
    withdraw_tx(100_000_000_000, capital - 100_000_000_001),
  )
}

test withdraw_below_capital_lock_fails() fail {
  // 300k active cover needs >= 333,333.34 ada at 90% max utilization;
  // withdrawing 700k shares would leave 300k.
  spend_pool(
    base_pool(),
    Withdraw { shares: 700_000_000_000 },
    withdraw_tx(700_000_000_000, capital - 700_000_000_000),
  )
}

test withdraw_up_to_capital_lock_ok() {
  // leaves 340k capital against 300k active (88% utilization)
  spend_pool(
    base_pool(),
    Withdraw { shares: 660_000_000_000 },
    withdraw_tx(660_000_000_000, capital - 660_000_000_000),
  )
}

test pool_cannot_be_spent_without_its_nft() fail {
  let fake = Input {
    output_reference: pool_ref,
    output: Output {
      ..pool_out(capital, shares, active),
      value: assets.from_lovelace(capital),
    },
  }
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [fake],
    outputs: [pool_out(capital + 1_000_000, shares + 1_000_000, active)],
    mint: assets.from_asset(own, lp_token, 1_000_000),
  }
  spend_pool(base_pool(), Deposit, tx)
}

// ---------------------------------------------------------------- buy

fn buy_tx(p: PolicyDatum, valid_until: Int) -> Transaction {
  Transaction {
    ..transaction.placeholder,
    inputs: [pool_in(capital, shares, active)],
    outputs: [
      pool_out(capital + p.premium, shares, active + p.coverage),
      policy_out(p),
      wallet_out(assets.from_asset(own, user_name(p.policy_id), 1)),
    ],
    mint: assets.from_asset(own, ref_name(p.policy_id), 1)
      |> assets.add(own, user_name(p.policy_id), 1),
    validity_range: interval.between(valid_until - 600_000, valid_until),
  }
}

test buy_cover_pays_premium_and_mints_policy() {
  // on-chain floor for 10k ada / 30 days at 30% -> 31% utilization is
  // 18.228493 ada (SDK quote: 18.23); paying exactly the floor is accepted
  let p = policy(coverage, 18_228_493, t0, expiry)
  let tx = buy_tx(p, t0)
  spend_pool(base_pool(), Buy, tx) && cover.mint(test_params, ViaPool, own, tx)
}

test buy_underpriced_premium_fails() fail {
  // one lovelace under the floor
  let p = policy(coverage, 18_228_492, t0, expiry)
  spend_pool(base_pool(), Buy, buy_tx(p, t0))
}

test buy_above_single_policy_cap_fails() fail {
  // 10% of 1M ada = 100k; ask for 150k with a generous premium
  let p = policy(150_000_000_000, 10_000_000_000, t0, expiry)
  spend_pool(base_pool(), Buy, buy_tx(p, t0))
}

test buy_beyond_utilization_cap_fails() fail {
  let near_full = PoolDatum {
    total_shares: shares,
    active_cover: 850_000_000_000,
  }
  let p = policy(90_000_000_000, 10_000_000_000, t0, expiry)
  let tx = Transaction {
    ..buy_tx(p, t0),
    inputs: [pool_in(capital, shares, 850_000_000_000)],
    outputs: [
      pool_out(capital + p.premium, shares, 850_000_000_000 + p.coverage),
      policy_out(p),
    ],
  }
  spend_pool(near_full, Buy, tx)
}

test buy_backdated_start_fails() fail {
  // tx may land up to t0 + 1h but cover claims to start at t0
  let p = policy(coverage, 40_000_000, t0, expiry)
  spend_pool(base_pool(), Buy, buy_tx(p, t0 + 3_600_000))
}

test buy_with_custom_trigger_fails() fail {
  // buyer tries a 99.9% threshold that would trigger on noise
  let p = PolicyDatum {
    ..policy(coverage, 40_000_000, t0, expiry),
    trigger: Trigger { ..depeg_trigger, threshold_bps: 9_990 },
  }
  spend_pool(base_pool(), Buy, buy_tx(p, t0))
}

test buy_term_shorter_than_product_minimum_fails() fail {
  let p = policy(coverage, 40_000_000, t0, t0 + 7 * 86_400_000)
  spend_pool(base_pool(), Buy, buy_tx(p, t0))
}

// ---------------------------------------------------------------- settle

fn feed(
  name: ByteArray,
  policy_id: PolicyId,
  price: Int,
  start: Int,
  end: Int,
) -> Input {
  let d: Data = OracleDatum {
    covered_asset: "USDM",
    price_bps: price,
    window_start: start,
    window_end: end,
  }
  Input {
    output_reference: OutputReference {
      transaction_id: #"0aac1e0000000000000000000000000000000000000000000000000000000000",
      output_index: 0,
    },
    output: Output {
      address: address.from_verification_key(#"0aac1e"),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(policy_id, name, 1),
      datum: InlineDatum(d),
      reference_script: None,
    },
  }
}

// Depeg to 0.91 from day 10 for 26h
const depeg_start = t0 + 10 * 86_400_000

const depeg_end = depeg_start + 26 * 3_600_000

fn good_feeds() -> List<Input> {
  [
    feed("feed-a", oracle_policy, 9_100, depeg_start, depeg_end),
    feed("feed-b", oracle_policy, 9_150, depeg_start, depeg_end),
  ]
}

fn live_policy() -> PolicyDatum {
  policy(coverage, 40_000_000, t0, expiry)
}

fn settle_tx(
  feeds: List<Input>,
  out_cap: Int,
  claim_at: Int,
  mint: Assets,
) -> Transaction {
  let p = live_policy()
  Transaction {
    ..transaction.placeholder,
    inputs: [
      pool_in(capital, shares, active),
      Input { output_reference: policy_ref, output: policy_out(p) },
      Input {
        output_reference: seed,
        output: wallet_out(assets.from_asset(own, user_name(p.policy_id), 1)),
      },
    ],
    reference_inputs: feeds,
    outputs: [
      pool_out(out_cap, shares, active - p.coverage),
      wallet_out(assets.from_lovelace(capital - out_cap)),
    ],
    mint,
    validity_range: interval.between(claim_at - 600_000, claim_at),
  }
}

fn burn_both() -> Assets {
  let id = bought_id()
  assets.from_asset(own, ref_name(id), -1) |> assets.add(own, user_name(id), -1)
}

fn settle(tx: Transaction) -> Bool {
  spend_pool(base_pool(), Settle, tx) && cover.spend(
    test_params,
    Some(Policy(live_policy())),
    Settle,
    policy_ref,
    tx,
  ) && cover.mint(test_params, ViaPool, own, tx)
}

test settle_pays_coverage_on_oracle_quorum() {
  settle(
    settle_tx(
      good_feeds(),
      capital - coverage,
      depeg_end + 3_600_000,
      burn_both(),
    ),
  )
}

test settle_within_grace_after_expiry_ok() {
  settle(
    settle_tx(
      good_feeds(),
      capital - coverage,
      expiry + 86_400_000,
      burn_both(),
    ),
  )
}

test settle_after_grace_fails() fail {
  settle(
    settle_tx(
      good_feeds(),
      capital - coverage,
      expiry + 4 * 86_400_000,
      burn_both(),
    ),
  )
}

test settle_event_after_expiry_fails() fail {
  // depeg starts the day after the policy expired
  let late = [
    feed(
      "feed-a",
      oracle_policy,
      9_100,
      expiry + 86_400_000,
      expiry + 2 * 86_400_000,
    ),
    feed(
      "feed-b",
      oracle_policy,
      9_100,
      expiry + 86_400_000,
      expiry + 2 * 86_400_000,
    ),
  ]
  settle(
    settle_tx(late, capital - coverage, expiry + 2 * 86_400_000, burn_both()),
  )
}

test settle_event_before_start_fails() fail {
  let early = [
    feed("feed-a", oracle_policy, 9_100, t0 - 86_400_000, t0 + 3_600_000),
    feed("feed-b", oracle_policy, 9_100, t0 - 86_400_000, t0 + 3_600_000),
  ]
  settle(settle_tx(early, capital - coverage, t0 + 7_200_000, burn_both()))
}

test settle_unauthenticated_oracle_fails() fail {
  // second feed carries a look-alike token from another policy
  let forged = [
    feed("feed-a", oracle_policy, 9_100, depeg_start, depeg_end),
    feed(
      "feed-b",
      #"bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0",
      9_100,
      depeg_start,
      depeg_end,
    ),
  ]
  settle(
    settle_tx(forged, capital - coverage, depeg_end + 3_600_000, burn_both()),
  )
}

test settle_unlisted_feed_name_fails() fail {
  let rogue = [
    feed("feed-a", oracle_policy, 9_100, depeg_start, depeg_end),
    feed("feed-z", oracle_policy, 9_100, depeg_start, depeg_end),
  ]
  settle(
    settle_tx(rogue, capital - coverage, depeg_end + 3_600_000, burn_both()),
  )
}

test settle_single_oracle_below_quorum_fails() fail {
  let one = [feed("feed-a", oracle_policy, 9_100, depeg_start, depeg_end)]
  settle(settle_tx(one, capital - coverage, depeg_end + 3_600_000, burn_both()))
}

test settle_trigger_not_met_fails() fail {
  // 0.96 is above the 0.95 threshold
  let calm = [
    feed("feed-a", oracle_policy, 9_600, depeg_start, depeg_end),
    feed("feed-b", oracle_policy, 9_600, depeg_start, depeg_end),
  ]
  settle(
    settle_tx(calm, capital - coverage, depeg_end + 3_600_000, burn_both()),
  )
}

test settle_window_too_short_fails() fail {
  // below peg, but only for 12h of the required 24h
  let blip = [
    feed(
      "feed-a",
      oracle_policy,
      9_100,
      depeg_start,
      depeg_start + 12 * 3_600_000,
    ),
    feed(
      "feed-b",
      oracle_policy,
      9_100,
      depeg_start,
      depeg_start + 12 * 3_600_000,
    ),
  ]
  settle(
    settle_tx(blip, capital - coverage, depeg_end + 3_600_000, burn_both()),
  )
}

test settle_overpaying_pool_fails() fail {
  settle(
    settle_tx(
      good_feeds(),
      capital - 2 * coverage,
      depeg_end + 3_600_000,
      burn_both(),
    ),
  )
}

test double_claim_keeping_policy_alive_fails() fail {
  // claim but burn only the user token, trying to keep the ref UTxO for a
  // second payout later
  let id = bought_id()
  settle(
    settle_tx(
      good_feeds(),
      capital - coverage,
      depeg_end + 3_600_000,
      assets.from_asset(own, user_name(id), -1),
    ),
  )
}

test second_claim_after_payout_fails() fail {
  // the policy ref UTxO is gone after the first payout; replaying the claim
  // with only the pool input finds no policy to pay
  let tx = settle_tx(
    good_feeds(),
    capital - coverage,
    depeg_end + 3_600_000,
    burn_both(),
  )
  let replay = Transaction {
    ..tx,
    inputs: list.filter(tx.inputs, fn(i) { i.output_reference != policy_ref }),
  }
  spend_pool(base_pool(), Settle, replay)
}

test policy_utxo_unlocks_only_with_ref_burn() fail {
  let p = live_policy()
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [Input { output_reference: policy_ref, output: policy_out(p) }],
    outputs: [wallet_out(assets.from_asset(own, ref_name(p.policy_id), 1))],
  }
  cover.spend(test_params, Some(Policy(p)), Settle, policy_ref, tx)
}

// ---------------------------------------------------------------- expire

fn expire_tx(at: Int, mint: Assets) -> Transaction {
  let p = live_policy()
  Transaction {
    ..transaction.placeholder,
    inputs: [
      pool_in(capital, shares, active),
      Input { output_reference: policy_ref, output: policy_out(p) },
    ],
    outputs: [pool_out(capital, shares, active - p.coverage)],
    mint,
    validity_range: interval.between(at, at + 600_000),
  }
}

test expire_after_grace_releases_capital() {
  let tx = expire_tx(
    expiry + 3 * 86_400_000 + 1,
    assets.from_asset(own, ref_name(bought_id()), -1),
  )
  spend_pool(base_pool(), Expire, tx) && cover.spend(
    test_params,
    Some(Policy(live_policy())),
    Expire,
    policy_ref,
    tx,
  )
}

test expire_during_grace_fails() fail {
  let tx = expire_tx(
    expiry + 86_400_000,
    assets.from_asset(own, ref_name(bought_id()), -1),
  )
  spend_pool(base_pool(), Expire, tx)
}

// ---------------------------------------------------------------- mint guards

test mint_via_pool_requires_pool_input() fail {
  let tx = Transaction {
    ..transaction.placeholder,
    mint: assets.from_asset(own, lp_token, 1_000_000),
  }
  cover.mint(test_params, ViaPool, own, tx)
}

test holder_can_burn_own_user_token() {
  let tx = Transaction {
    ..transaction.placeholder,
    mint: assets.from_asset(own, user_name(bought_id()), -1),
  }
  cover.mint(test_params, BurnUserTokens, own, tx)
}

test burn_user_tokens_cannot_burn_ref_token() fail {
  let tx = Transaction {
    ..transaction.placeholder,
    mint: assets.from_asset(own, ref_name(bought_id()), -1),
  }
  cover.mint(test_params, BurnUserTokens, own, tx)
}

// ---------------------------------------------------------------- SDK parity

/// Golden vectors asserted byte-for-byte in packages/sdk/test/cardano.test.ts.
test sdk_golden_vectors() {
  let policy_data: Data = Policy(live_policy())
  let pool_data: Data = Pool(base_pool())
  let withdraw_data: Data = Withdraw { shares: 100_000_000_000 }
  let params_data: Data = test_params
  and {
    bought_id() == #"b189a9907d60e630671d5d1cf94f41a33aca2203ae5aa8926722bd65312868ed",
    cbor.serialise(policy_data) == #"d87a9fd8799f5820b189a9907d60e630671d5d1cf94f41a33aca2203ae5aa8926722bd65312868ed4564657065671b00000002540be4001a02625a001b000001a3185c50001b000001a3b2db1800d8799f445553444d19251c1a05265c00ff5820c0441700c0441700c0441700c0441700c0441700c0441700c0441700c0441700ffff",
    cbor.serialise(pool_data) == #"d8799fd8799f1b000000e8d4a510001b00000045d964b800ffff",
    cbor.serialise(withdraw_data) == #"d87a9f1b000000174876e800ff",
    cbor.serialise(params_data) == #"d8799fd8799f58205eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed00ffd8799f4040ffd8799f456465706567d8799f445553444d19251c1a05265c00ff18c81927100e19016d1a004c4b401903e8192328ffd8799f581c0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0a9f46666565642d6146666565642d6246666565642d63ff02ff1a0f731400ff",
  }
}
