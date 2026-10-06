//// PlutusShield cover validator (Plutus V3).
////
//// One parameterised multi-validator: its hash is both the minting policy of
//// every PlutusShield token (pool NFT, LP shares, policy ref/user tokens) and
//// the payment credential that locks the pool and policy reference UTxOs.
////
////   pool UTxO      pool NFT + one capital tranche per accepted asset
////                  (e.g. ada + USDCx), datum Pool(PoolDatum)
////   policy UTxO    policy reference token, datum Policy(PolicyDatum)
////   user token     sent to the buyer; burning it is the right to claim
////
//// Every LP or policy action spends the pool UTxO, and the pool spend checks
//// the exact mint/burn, the capital movement of the one tranche it touches,
//// that every other tranche is untouched, and the next pool datum. There is
//// no admin key: all configuration is fixed in `CoverParams` at deployment.

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
  is_user_name, lp_name, policy_id_from, pool_nft, ref_name, user_name,
}
use plutusshield/oracle
use plutusshield/pricing.{bps, day_ms}
use plutusshield/types.{
  AssetClass, AssetTerms, BurnUserTokens, Buy, CoverDatum, CoverParams, Deposit,
  Expire, InitPool, MintAction, OracleConfig, OracleDatum, Policy, PolicyDatum,
  Pool, PoolAction, PoolDatum, ProductTerms, Settle, Tranche, Trigger, ViaPool,
  Withdraw,
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
  let empty = Tranche { total_shares: 0, active_cover: 0 }
  and {
    name == pool_nft,
    qty == 1,
    list.any(self.inputs, fn(i) { i.output_reference == params.seed }),
    pool_out.address.payment_credential == Script(own),
    pool_out.datum == pool_datum(
      PoolDatum { tranches: list.repeat(empty, list.length(params.assets)) },
    ),
    pool_value_ok(
      pool_out.value,
      own,
      params.assets,
      capitals(pool_out.value, params.assets),
    ),
    params_ok(params),
  }
}

/// A misconfigured deployment cannot even initialise its pool.
pub fn params_ok(params: CoverParams) -> Bool {
  let p = params.product
  let o = params.oracle
  let classes = list.map(params.assets, fn(a) { a.asset })
  and {
    // 1..=256 distinct tranche assets; tranche index must fit one byte.
    classes != [],
    list.length(classes) <= 256,
    list.length(list.unique(classes)) == list.length(classes),
    list.all(
      params.assets,
      fn(a) {
        and {
          a.min_premium >= 0,
          // ada is only ever ("", ""), never a fake "" policy with a name.
          a.asset.policy_id != assets.ada_policy_id || a.asset.asset_name == assets.ada_asset_name,
        }
      },
    ),
    o.quorum >= 1,
    o.quorum <= list.length(o.feeds),
    p.trigger.threshold_bps > 0,
    p.trigger.threshold_bps <= bps,
    p.trigger.window_ms > 0,
    p.base_rate_bps > 0,
    p.risk_mult_bps > 0,
    p.min_days >= 1,
    p.min_days <= p.max_days,
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
  let ts = params.assets
  let caps_in = capitals(pool_in.output.value, ts)
  expect [pool_out] = outputs_with(self.outputs, own, pool_nft)
  expect InlineDatum(raw) = pool_out.datum
  expect Pool(next): CoverDatum = raw
  let caps_out = capitals(pool_out.value, ts)
  let minted = own_mint(self.mint, own)
  let continuing = and {
    pool_out.address == pool_in.output.address,
    pool_value_ok(pool_out.value, own, ts, caps_out),
    // Without an ada tranche, lovelace in the pool is only min-UTxO and may
    // never be taken out.
    list.any(ts, fn(a) { is_ada(a.asset) }) || assets.lovelace_of(
      pool_out.value,
    ) >= assets.lovelace_of(pool_in.output.value),
  }
  // Every action moves exactly one tranche; the others stay as they are.
  let touch = fn(t: Int) -> (Tranche, Int, Int) {
    expect Some(tranche) = list.at(pool.tranches, t)
    expect others_untouched(ts, caps_in, caps_out, t, 0)
    (tranche, list.expect_at(caps_in, t), list.expect_at(caps_out, t))
  }
  continuing && when action is {
    Deposit { tranche: t } -> {
      let (tr, capital, out_capital) = touch(t)
      let amount = out_capital - capital
      let shares = if tr.total_shares == 0 {
        amount
      } else {
        expect capital > 0
        amount * tr.total_shares / capital
      }
      and {
        amount > 0,
        shares > 0,
        minted == [Pair(lp_name(t), shares)],
        next.tranches == set_at(
          pool.tranches,
          t,
          Tranche {
            total_shares: tr.total_shares + shares,
            active_cover: tr.active_cover,
          },
        ),
      }
    }

    Withdraw { tranche: t, shares } -> {
      let (tr, capital, out_capital) = touch(t)
      expect shares > 0 && shares <= tr.total_shares
      let payout = shares * capital / tr.total_shares
      and {
        out_capital == capital - payout,
        minted == [Pair(lp_name(t), -shares)],
        next.tranches == set_at(
          pool.tranches,
          t,
          Tranche {
            total_shares: tr.total_shares - shares,
            active_cover: tr.active_cover,
          },
        ),
        // Capital lock: remaining capital in this asset must still back this
        // tranche's active cover at the product's max utilization.
        tr.active_cover * bps <= out_capital * params.product.max_utilization_bps,
      }
    }

    Buy -> validate_buy(params, own, pool_in, pool, touch, next, minted, self)

    Settle -> {
      expect [Pair(r, rq), Pair(u, uq)] = minted
      let (policy_in, p) = policy_input(self.inputs, own, r)
      let t = tranche_of(ts, p.asset)
      let (tr, capital, out_capital) = touch(t)
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
        // The policy's own tranche pays exactly the coverage, once, in the
        // policy's asset.
        out_capital == capital - p.coverage,
        next.tranches == set_at(
          pool.tranches,
          t,
          Tranche {
            total_shares: tr.total_shares,
            active_cover: tr.active_cover - p.coverage,
          },
        ),
        policy_in.output.address.payment_credential == Script(own),
      }
    }

    Expire -> {
      expect [Pair(r, rq), ..rest] = minted
      let (_, p) = policy_input(self.inputs, own, r)
      let t = tranche_of(ts, p.asset)
      let (tr, capital, out_capital) = touch(t)
      and {
        rq == -1,
        r == ref_name(p.policy_id),
        // The holder's user token may be burned in the same tx, or later.
        rest == [] || rest == [Pair(user_name(p.policy_id), -1)],
        lower_bound(self.validity_range) > p.expiry + params.claim_grace_ms,
        out_capital == capital,
        next.tranches == set_at(
          pool.tranches,
          t,
          Tranche {
            total_shares: tr.total_shares,
            active_cover: tr.active_cover - p.coverage,
          },
        ),
      }
    }
  }
}

fn validate_buy(
  params: CoverParams,
  own: PolicyId,
  pool_in: Input,
  pool: PoolDatum,
  touch: fn(Int) -> (Tranche, Int, Int),
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
  // The policy's asset picks the tranche; it must be an accepted asset.
  let t = tranche_of(params.assets, p.asset)
  let terms = list.expect_at(params.assets, t)
  let (tr, capital, out_capital) = touch(t)
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
    // Capacity and price are per tranche: a USDC policy is backed by USDC
    // capital only, an ada policy by ada capital only.
    pricing.within_capacity(
      product.max_single_policy_bps,
      product.max_utilization_bps,
      p.coverage,
      capital,
      tr.active_cover,
    ),
    premium >= pricing.required_premium(
      product.base_rate_bps,
      product.risk_mult_bps,
      terms.min_premium,
      p.coverage,
      days,
      capital,
      tr.active_cover,
    ),
    next.tranches == set_at(
      pool.tranches,
      t,
      Tranche {
        total_shares: tr.total_shares,
        active_cover: tr.active_cover + p.coverage,
      },
    ),
  }
}

// ---------------------------------------------------------------- helpers

fn own_mint(mint: Assets, own: PolicyId) -> Pairs<AssetName, Int> {
  assets.tokens(mint, own) |> dict.to_pairs
}

fn is_ada(a: AssetClass) -> Bool {
  a.policy_id == assets.ada_policy_id
}

fn asset_qty(value: Assets, asset: AssetClass) -> Int {
  assets.quantity_of(value, asset.policy_id, asset.asset_name)
}

/// Capital per tranche, in `params.assets` order. The ada tranche's capital
/// is all lovelace in the UTxO (including its min-UTxO ada).
fn capitals(value: Assets, ts: List<AssetTerms>) -> List<Int> {
  list.map(ts, fn(a) { asset_qty(value, a.asset) })
}

/// Index of `asset` in the accepted assets. Fails for an unaccepted asset.
fn tranche_of(ts: List<AssetTerms>, asset: AssetClass) -> Int {
  expect Some(t) = list.index_of(list.map(ts, fn(a) { a.asset }), asset)
  t
}

/// Tranches other than `target` keep their capital. The ada tranche may
/// *gain* lovelace when it is not the target (min-UTxO top-ups when a token
/// tranche first receives capital); that only ever donates to ada LPs.
fn others_untouched(
  ts: List<AssetTerms>,
  ins: List<Int>,
  outs: List<Int>,
  target: Int,
  i: Int,
) -> Bool {
  when ts is {
    [] -> True
    [a, ..rest] -> {
      expect [x, ..xs] = ins
      expect [y, ..ys] = outs
      and {
        i == target || y == x || is_ada(a.asset) && y >= x,
        others_untouched(rest, xs, ys, target, i + 1),
      }
    }
  }
}

/// `xs` with element `i` replaced by `x`. Fails if `i` is out of range.
fn set_at(xs: List<a>, i: Int, x: a) -> List<a> {
  when xs is {
    [] -> fail @"tranche index out of range"
    [y, ..rest] ->
      if i == 0 {
        [x, ..rest]
      } else {
        [y, ..set_at(rest, i - 1, x)]
      }
  }
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

/// Pool UTxO carries only: ada, the pool NFT, and the token tranche assets
/// (in exactly the quantities counted as their capital). No foreign tokens.
fn pool_value_ok(
  value: Assets,
  own: PolicyId,
  ts: List<AssetTerms>,
  caps: List<Int>,
) -> Bool {
  assets.without_lovelace(value) == expected_tokens(
    ts,
    caps,
    assets.from_asset(own, pool_nft, 1),
  )
}

fn expected_tokens(ts: List<AssetTerms>, caps: List<Int>, acc: Assets) -> Assets {
  when ts is {
    [] -> acc
    [a, ..rest] -> {
      expect [c, ..cs] = caps
      let acc2 = if is_ada(a.asset) {
        acc
      } else {
        assets.add(acc, a.asset.policy_id, a.asset.asset_name, c)
      }
      expected_tokens(rest, cs, acc2)
    }
  }
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
// Fixtures: a two-tranche [ada, USDCx] depeg pool for USDM at tier B, 2-of-3
// oracle quorum, 3-day claim grace. Times are POSIX ms.
//
//   ada tranche (0)   1,000,000 ADA capital, 1,000,000 shares, 300,000 active
//   USDC tranche (1)    500,000 USDCx capital, 500,000 shares, 100,000 active

const own: PolicyId =
  #"c0fec0fec0fec0fec0fec0fec0fec0fec0fec0fec0fec0fec0fec0fe"

const oracle_policy: PolicyId =
  #"0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0a"

/// Mainnet USDCx (Circle xReserve), 6 decimals. Preview deployments use a
/// mock token instead; see contracts/cardano/deploy/README.md.
const usdc =
  AssetClass {
    policy_id: #"1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34",
    asset_name: "USDCx",
  }

const ada = AssetClass { policy_id: "", asset_name: "" }

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
    assets: [
      AssetTerms { asset: ada, min_premium: 5_000_000 },
      AssetTerms { asset: usdc, min_premium: 5_000_000 },
    ],
    product: ProductTerms {
      product_id: "depeg",
      trigger: depeg_trigger,
      base_rate_bps: 200,
      risk_mult_bps: 10_000,
      min_days: 14,
      max_days: 365,
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

const usd_capital = 500_000_000_000

const usd_active = 100_000_000_000

const usd_shares = 500_000_000_000

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

fn usd_tranche() -> Tranche {
  Tranche { total_shares: usd_shares, active_cover: usd_active }
}

/// Pool datum with the given ada tranche and the default USDC tranche.
fn ada_book(total: Int, act: Int) -> PoolDatum {
  PoolDatum {
    tranches: [
      Tranche { total_shares: total, active_cover: act },
      usd_tranche(),
    ],
  }
}

/// Pool datum with the default ada tranche and the given USDC tranche.
fn usd_book(total: Int, act: Int) -> PoolDatum {
  PoolDatum {
    tranches: [
      Tranche { total_shares: shares, active_cover: active },
      Tranche { total_shares: total, active_cover: act },
    ],
  }
}

fn base_pool() -> PoolDatum {
  ada_book(shares, active)
}

fn pool_value(ada_cap: Int, usd_cap: Int) -> Assets {
  assets.from_lovelace(ada_cap)
    |> assets.add(own, pool_nft, 1)
    |> assets.add(usdc.policy_id, usdc.asset_name, usd_cap)
}

fn pool_out_v(ada_cap: Int, usd_cap: Int, d: PoolDatum) -> Output {
  Output {
    address: address.from_script(own),
    value: pool_value(ada_cap, usd_cap),
    datum: pool_datum(d),
    reference_script: None,
  }
}

/// Pool output with the given ada tranche, default USDC tranche.
fn pool_out(cap: Int, total: Int, act: Int) -> Output {
  pool_out_v(cap, usd_capital, ada_book(total, act))
}

fn pool_in_v(ada_cap: Int, usd_cap: Int, d: PoolDatum) -> Input {
  Input { output_reference: pool_ref, output: pool_out_v(ada_cap, usd_cap, d) }
}

fn pool_in(cap: Int, total: Int, act: Int) -> Input {
  pool_in_v(cap, usd_capital, ada_book(total, act))
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

// The policy bought from `pool_ref`, so its id is derived from it.
fn bought_id() -> ByteArray {
  policy_id_from(pool_ref)
}

fn policy_in_asset(
  asset: AssetClass,
  cov: Int,
  premium: Int,
  start: Int,
  end: Int,
) -> PolicyDatum {
  PolicyDatum {
    policy_id: bought_id(),
    product_id: "depeg",
    asset,
    coverage: cov,
    premium,
    start,
    expiry: end,
    trigger: depeg_trigger,
    midnight_commitment: commitment,
  }
}

fn policy(cov: Int, premium: Int, start: Int, end: Int) -> PolicyDatum {
  policy_in_asset(ada, cov, premium, start, end)
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

fn empty_pool() -> PoolDatum {
  PoolDatum {
    tranches: [
      Tranche { total_shares: 0, active_cover: 0 },
      Tranche { total_shares: 0, active_cover: 0 },
    ],
  }
}

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
    outputs: [pool_out_v(2_000_000, 0, empty_pool())],
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

test init_pool_needs_one_tranche_per_asset() fail {
  // datum with a single tranche for a two-asset deployment
  let tx = Transaction {
    ..init_tx(True),
    outputs: [
      pool_out_v(
        2_000_000,
        0,
        PoolDatum { tranches: [Tranche { total_shares: 0, active_cover: 0 }] },
      ),
    ],
  }
  cover.mint(test_params, InitPool, own, tx)
}

test init_pool_rejects_duplicate_assets() fail {
  let dup = CoverParams {
    ..test_params,
    assets: [
      AssetTerms { asset: usdc, min_premium: 5_000_000 },
      AssetTerms { asset: usdc, min_premium: 1 },
    ],
  }
  cover.mint(dup, InitPool, own, init_tx(True))
}

test init_pool_rejects_no_assets() fail {
  let none = CoverParams { ..test_params, assets: [] }
  let tx = Transaction {
    ..init_tx(True),
    outputs: [pool_out_v(2_000_000, 0, PoolDatum { tranches: [] })],
  }
  cover.mint(none, InitPool, own, tx)
}

test usdc_only_pool_inits() {
  let only = CoverParams {
    ..test_params,
    assets: [AssetTerms { asset: usdc, min_premium: 5_000_000 }],
  }
  let tx = Transaction {
    ..init_tx(True),
    outputs: [
      pool_out_v(
        2_000_000,
        0,
        PoolDatum { tranches: [Tranche { total_shares: 0, active_cover: 0 }] },
      ),
    ],
  }
  cover.mint(only, InitPool, own, tx)
}

// ---------------------------------------------------------------- LP (ada)

fn deposit_tx(amount: Int, minted_shares: Int, next_total: Int) -> Transaction {
  Transaction {
    ..transaction.placeholder,
    inputs: [pool_in(capital, shares, active)],
    outputs: [pool_out(capital + amount, next_total, active)],
    mint: assets.from_asset(own, lp_name(0), minted_shares),
  }
}

test deposit_mints_pro_rata_shares() {
  // share price is 1.0 here, so 50k ada -> 50k ada of shares
  let tx = deposit_tx(50_000_000_000, 50_000_000_000, shares + 50_000_000_000)
  spend_pool(base_pool(), Deposit { tranche: 0 }, tx) && cover.mint(
    test_params,
    ViaPool,
    own,
    tx,
  )
}

test first_deposit_into_empty_pool() {
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [pool_in_v(2_000_000, 0, empty_pool())],
    outputs: [
      pool_out_v(
        2_000_000 + 100_000_000,
        0,
        PoolDatum {
          tranches: [
            Tranche { total_shares: 100_000_000, active_cover: 0 },
            Tranche { total_shares: 0, active_cover: 0 },
          ],
        },
      ),
    ],
    mint: assets.from_asset(own, lp_name(0), 100_000_000),
  }
  spend_pool(empty_pool(), Deposit { tranche: 0 }, tx)
}

test deposit_overminting_shares_fails() fail {
  let tx = deposit_tx(50_000_000_000, 60_000_000_000, shares + 60_000_000_000)
  spend_pool(base_pool(), Deposit { tranche: 0 }, tx)
}

test deposit_minting_other_tranche_lp_fails() fail {
  // ada deposited, but USDC-tranche LP minted
  let tx = Transaction {
    ..deposit_tx(50_000_000_000, 50_000_000_000, shares + 50_000_000_000),
    mint: assets.from_asset(own, lp_name(1), 50_000_000_000),
  }
  spend_pool(base_pool(), Deposit { tranche: 0 }, tx)
}

test deposit_into_unknown_tranche_fails() fail {
  let tx = deposit_tx(50_000_000_000, 50_000_000_000, shares + 50_000_000_000)
  spend_pool(base_pool(), Deposit { tranche: 2 }, tx)
}

fn withdraw_tx(burn: Int, out_cap: Int) -> Transaction {
  Transaction {
    ..transaction.placeholder,
    inputs: [pool_in(capital, shares, active)],
    outputs: [
      pool_out(out_cap, shares - burn, active),
      wallet_out(assets.from_lovelace(capital - out_cap)),
    ],
    mint: assets.from_asset(own, lp_name(0), -burn),
  }
}

fn withdraw0(n: Int) -> PoolAction {
  Withdraw { tranche: 0, shares: n }
}

test withdraw_pro_rata() {
  spend_pool(
    base_pool(),
    withdraw0(100_000_000_000),
    withdraw_tx(100_000_000_000, capital - 100_000_000_000),
  )
}

test withdraw_more_than_share_value_fails() fail {
  spend_pool(
    base_pool(),
    withdraw0(100_000_000_000),
    withdraw_tx(100_000_000_000, capital - 100_000_000_001),
  )
}

test withdraw_below_capital_lock_fails() fail {
  // 300k active cover needs >= 333,333.34 ada at 90% max utilization;
  // withdrawing 700k shares would leave 300k.
  spend_pool(
    base_pool(),
    withdraw0(700_000_000_000),
    withdraw_tx(700_000_000_000, capital - 700_000_000_000),
  )
}

test withdraw_up_to_capital_lock_ok() {
  // leaves 340k capital against 300k active (88% utilization)
  spend_pool(
    base_pool(),
    withdraw0(660_000_000_000),
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
    mint: assets.from_asset(own, lp_name(0), 1_000_000),
  }
  spend_pool(base_pool(), Deposit { tranche: 0 }, tx)
}

test pool_rejects_foreign_tokens() fail {
  // a deposit that also parks an unlisted token in the pool UTxO
  let tx = deposit_tx(50_000_000_000, 50_000_000_000, shares + 50_000_000_000)
  let junk = Transaction {
    ..tx,
    outputs: [
      Output {
        ..pool_out(capital + 50_000_000_000, shares + 50_000_000_000, active),
        value: pool_value(capital + 50_000_000_000, usd_capital)
          |> assets.add(
              #"bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad0",
              "x",
              1,
            ),
      },
    ],
  }
  spend_pool(base_pool(), Deposit { tranche: 0 }, junk)
}

// ---------------------------------------------------------------- LP (USDC)

fn usd_deposit_tx(
  amount: Int,
  minted_shares: Int,
  extra_ada: Int,
  usd_out: Int,
) -> Transaction {
  Transaction {
    ..transaction.placeholder,
    inputs: [pool_in(capital, shares, active)],
    outputs: [
      pool_out_v(
        capital + extra_ada,
        usd_out,
        usd_book(usd_shares + minted_shares, usd_active),
      ),
    ],
    mint: assets.from_asset(own, lp_name(1), minted_shares),
  }
    |> fn(tx) {
        expect amount == usd_out - usd_capital
        tx
      }
}

test usdc_deposit_mints_usdc_tranche_shares() {
  let tx = usd_deposit_tx(
    20_000_000_000,
    20_000_000_000,
    0,
    usd_capital + 20_000_000_000,
  )
  spend_pool(base_pool(), Deposit { tranche: 1 }, tx) && cover.mint(
    test_params,
    ViaPool,
    own,
    tx,
  )
}

test usdc_deposit_may_top_up_min_ada() {
  // extra lovelace for min-UTxO is a harmless donation to the ada tranche
  spend_pool(
    base_pool(),
    Deposit { tranche: 1 },
    usd_deposit_tx(
      20_000_000_000,
      20_000_000_000,
      1_000_000,
      usd_capital + 20_000_000_000,
    ),
  )
}

test usdc_deposit_draining_ada_tranche_fails() fail {
  // deposits USDC but sneaks 1 ADA out of the ada tranche
  spend_pool(
    base_pool(),
    Deposit { tranche: 1 },
    usd_deposit_tx(
      20_000_000_000,
      20_000_000_000,
      -1_000_000,
      usd_capital + 20_000_000_000,
    ),
  )
}

test usdc_deposit_minting_ada_lp_fails() fail {
  let tx = Transaction {
    ..usd_deposit_tx(
      20_000_000_000,
      20_000_000_000,
      0,
      usd_capital + 20_000_000_000,
    ),
    mint: assets.from_asset(own, lp_name(0), 20_000_000_000),
  }
  spend_pool(base_pool(), Deposit { tranche: 1 }, tx)
}

fn usd_withdraw_tx(burn: Int, usd_out: Int, ada_out: Int) -> Transaction {
  Transaction {
    ..transaction.placeholder,
    inputs: [pool_in(capital, shares, active)],
    outputs: [
      pool_out_v(ada_out, usd_out, usd_book(usd_shares - burn, usd_active)),
    ],
    mint: assets.from_asset(own, lp_name(1), -burn),
  }
}

test usdc_withdraw_pays_in_usdc() {
  spend_pool(
    base_pool(),
    Withdraw { tranche: 1, shares: 50_000_000_000 },
    usd_withdraw_tx(50_000_000_000, usd_capital - 50_000_000_000, capital),
  )
}

test usdc_withdraw_cannot_also_take_ada() fail {
  spend_pool(
    base_pool(),
    Withdraw { tranche: 1, shares: 50_000_000_000 },
    usd_withdraw_tx(
      50_000_000_000,
      usd_capital - 50_000_000_000,
      capital - 50_000_000_000,
    ),
  )
}

test usdc_withdraw_respects_usdc_capital_lock() fail {
  // 100k USDC active needs >= 111,111.12 USDC; burning 400k shares leaves 100k
  spend_pool(
    base_pool(),
    Withdraw { tranche: 1, shares: 400_000_000_000 },
    usd_withdraw_tx(400_000_000_000, usd_capital - 400_000_000_000, capital),
  )
}

// ---------------------------------------------------------------- buy (ada)

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
  let near_full = ada_book(shares, 850_000_000_000)
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

// ---------------------------------------------------------------- buy (USDC)

fn usd_buy_tx(p: PolicyDatum, ada_premium: Int, usd_premium: Int) -> Transaction {
  Transaction {
    ..buy_tx(p, t0),
    outputs: [
      pool_out_v(
        capital + ada_premium,
        usd_capital + usd_premium,
        usd_book(usd_shares, usd_active + p.coverage),
      ),
      policy_out(p),
      wallet_out(assets.from_asset(own, user_name(p.policy_id), 1)),
    ],
  }
}

/// 10k USDC / 30 days against the USDC tranche at 20% -> 22% utilization.
/// Floor = 17.670410 USDC (SDK golden vector in cardano.test.ts).
const usd_floor = 17_670_410

test usdc_buy_prices_against_usdc_tranche() {
  let p = policy_in_asset(usdc, coverage, usd_floor, t0, expiry)
  let tx = usd_buy_tx(p, 0, usd_floor)
  spend_pool(base_pool(), Buy, tx) && cover.mint(test_params, ViaPool, own, tx)
}

test usdc_buy_underpriced_fails() fail {
  let p = policy_in_asset(usdc, coverage, usd_floor - 1, t0, expiry)
  spend_pool(base_pool(), Buy, usd_buy_tx(p, 0, usd_floor - 1))
}

test usdc_policy_paid_in_ada_fails() fail {
  // policy says USDC, premium is sent as ada instead
  let p = policy_in_asset(usdc, coverage, usd_floor, t0, expiry)
  let tx = Transaction {
    ..usd_buy_tx(p, usd_floor, 0),
    outputs: [
      pool_out_v(
        capital + usd_floor,
        usd_capital,
        usd_book(usd_shares, usd_active + p.coverage),
      ),
      policy_out(p),
    ],
  }
  spend_pool(base_pool(), Buy, tx)
}

test usdc_buy_booked_on_ada_tranche_fails() fail {
  // USDC premium, but the cover is booked against the ada tranche's ledger
  let p = policy_in_asset(usdc, coverage, usd_floor, t0, expiry)
  let tx = Transaction {
    ..usd_buy_tx(p, 0, usd_floor),
    outputs: [
      pool_out_v(
        capital,
        usd_capital + usd_floor,
        ada_book(shares, active + coverage),
      ),
      policy_out(p),
    ],
  }
  spend_pool(base_pool(), Buy, tx)
}

test usdc_buy_capacity_is_per_tranche() fail {
  // 60k USDC is under 10% of the ada tranche but over 10% of 500k USDC
  let p = policy_in_asset(usdc, 60_000_000_000, 10_000_000_000, t0, expiry)
  spend_pool(base_pool(), Buy, usd_buy_tx(p, 0, 10_000_000_000))
}

test buy_in_unaccepted_asset_fails() fail {
  let other = AssetClass { policy_id: oracle_policy, asset_name: "USDM" }
  let p = policy_in_asset(other, coverage, 40_000_000, t0, expiry)
  spend_pool(base_pool(), Buy, usd_buy_tx(p, 0, 40_000_000))
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
  settle_policy(live_policy(), tx)
}

fn settle_policy(p: PolicyDatum, tx: Transaction) -> Bool {
  spend_pool(base_pool(), Settle, tx) && cover.spend(
    test_params,
    Some(Policy(p)),
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

fn usd_settle_tx(ada_out: Int, usd_out: Int) -> Transaction {
  let p = policy_in_asset(usdc, coverage, 40_000_000, t0, expiry)
  let tx = settle_tx(good_feeds(), capital, depeg_end + 3_600_000, burn_both())
  Transaction {
    ..tx,
    inputs: [
      pool_in(capital, shares, active),
      Input { output_reference: policy_ref, output: policy_out(p) },
    ],
    outputs: [
      pool_out_v(ada_out, usd_out, usd_book(usd_shares, usd_active - coverage)),
    ],
  }
}

test usdc_policy_settles_from_usdc_tranche() {
  settle_policy(
    policy_in_asset(usdc, coverage, 40_000_000, t0, expiry),
    usd_settle_tx(capital, usd_capital - coverage),
  )
}

test usdc_policy_cannot_be_paid_from_ada_tranche() fail {
  settle_policy(
    policy_in_asset(usdc, coverage, 40_000_000, t0, expiry),
    usd_settle_tx(capital - coverage, usd_capital),
  )
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

test expire_releases_only_the_policy_tranche() fail {
  // an ada policy expiring must not reduce USDC active cover
  let tx = Transaction {
    ..expire_tx(
      expiry + 3 * 86_400_000 + 1,
      assets.from_asset(own, ref_name(bought_id()), -1),
    ),
    outputs: [
      pool_out_v(
        capital,
        usd_capital,
        usd_book(usd_shares, usd_active - coverage),
      ),
    ],
  }
  spend_pool(base_pool(), Expire, tx)
}

// ---------------------------------------------------------------- mint guards

test mint_via_pool_requires_pool_input() fail {
  let tx = Transaction {
    ..transaction.placeholder,
    mint: assets.from_asset(own, lp_name(0), 1_000_000),
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
  let usd_policy_data: Data = Policy(
    policy_in_asset(usdc, coverage, usd_floor, t0, expiry),
  )
  let pool_data: Data = Pool(base_pool())
  let withdraw_data: Data = Withdraw { tranche: 1, shares: 100_000_000_000 }
  let deposit_data: Data = Deposit { tranche: 1 }
  let params_data: Data = test_params
  and {
    bought_id() == #"b189a9907d60e630671d5d1cf94f41a33aca2203ae5aa8926722bd65312868ed",
    cbor.serialise(policy_data) == #"d87a9fd8799f5820b189a9907d60e630671d5d1cf94f41a33aca2203ae5aa8926722bd65312868ed456465706567d8799f4040ff1b00000002540be4001a02625a001b000001a3185c50001b000001a3b2db1800d8799f445553444d19251c1a05265c00ff5820c0441700c0441700c0441700c0441700c0441700c0441700c0441700c0441700ffff",
    cbor.serialise(usd_policy_data) == #"d87a9fd8799f5820b189a9907d60e630671d5d1cf94f41a33aca2203ae5aa8926722bd65312868ed456465706567d8799f581c1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34455553444378ff1b00000002540be4001a010da10a1b000001a3185c50001b000001a3b2db1800d8799f445553444d19251c1a05265c00ff5820c0441700c0441700c0441700c0441700c0441700c0441700c0441700c0441700ffff",
    cbor.serialise(pool_data) == #"d8799fd8799f9fd8799f1b000000e8d4a510001b00000045d964b800ffd8799f1b000000746a5288001b000000174876e800ffffffff",
    cbor.serialise(withdraw_data) == #"d87a9f011b000000174876e800ff",
    cbor.serialise(deposit_data) == #"d8799f01ff",
    cbor.serialise(params_data) == #"d8799fd8799f58205eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed00ff9fd8799fd8799f4040ff1a004c4b40ffd8799fd8799f581c1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34455553444378ff1a004c4b40ffffd8799f456465706567d8799f445553444d19251c1a05265c00ff18c81927100e19016d1903e8192328ffd8799f581c0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0a9f46666565642d6146666565642d6246666565642d63ff02ff1a0f731400ff",
  }
}
