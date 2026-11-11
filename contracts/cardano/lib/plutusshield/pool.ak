//// Pool accounting shared by `cover.ak` and `exploit_cover.ak`.

use aiken/collection/list
use aiken/interval.{Finite}
use aiken/primitive/bytearray
use cardano/assets.{AssetName, Assets, PolicyId}
use cardano/transaction.{InlineDatum, Input, Output, Transaction, ValidityRange}
use plutusshield/names.{ref_label, ref_name, user_name}
use plutusshield/types.{
  AssetClass, AssetTerms, CoverDatum, Policy, PolicyDatum, PoolDatum, Tranche,
}

pub fn is_ada(a: AssetClass) -> Bool {
  a.policy_id == assets.ada_policy_id
}

pub fn asset_qty(value: Assets, asset: AssetClass) -> Int {
  assets.quantity_of(value, asset.policy_id, asset.asset_name)
}

/// Capital per tranche, in `ts` order. The ada tranche's capital is the
/// UTxO's lovelace MINUS the pool's own min-UTxO (`pool_min_lovelace`), so
/// the initializer's min-ada is never LP capital: it isn't donated to the
/// first LP, and the last LP can withdraw everything without pushing the
/// pool output below the ledger's min-UTxO.
pub fn capitals(
  value: Assets,
  ts: List<AssetTerms>,
  pool_min_lovelace: Int,
) -> List<Int> {
  list.map(
    ts,
    fn(a) {
      if is_ada(a.asset) {
        assets.lovelace_of(value) - pool_min_lovelace
      } else {
        asset_qty(value, a.asset)
      }
    },
  )
}

/// Index of `asset` in the accepted assets. Fails for an unaccepted asset.
pub fn tranche_of(ts: List<AssetTerms>, asset: AssetClass) -> Int {
  expect Some(t) = list.index_of(list.map(ts, fn(a) { a.asset }), asset)
  t
}

/// Tranches other than `target` keep their capital. The ada tranche may
/// *gain* lovelace when it is not the target (min-UTxO top-ups when a token
/// tranche first receives capital); that only ever donates to ada LPs.
/// `target = -1` checks every tranche.
pub fn others_untouched(
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
pub fn set_at(xs: List<a>, i: Int, x: a) -> List<a> {
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

pub fn upper_bound(range: ValidityRange) -> Int {
  when range.upper_bound.bound_type is {
    Finite(t) -> t
    _ -> fail @"validity range needs a finite upper bound"
  }
}

pub fn lower_bound(range: ValidityRange) -> Int {
  when range.lower_bound.bound_type is {
    Finite(t) -> t
    _ -> fail @"validity range needs a finite lower bound"
  }
}

/// The single input holding reference token `r`, with its policy datum.
pub fn policy_input(
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

/// The inline datum an `Expire` refund output must carry: the policy id. It
/// ties each refund to exactly one policy, so a batch that retires several
/// policies needs one refund per policy (no double satisfaction).
pub fn refund_tag(policy_id: ByteArray) -> Data {
  let d: Data = policy_id
  d
}

/// `Expire`, for one or more policies in one transaction.
///
///   - every burned reference token belongs to a policy input whose claim
///     window (expiry + grace) closed before the tx's validity lower bound;
///   - each such policy's min-ada goes back to its own `refund_to`, in an
///     output tagged with its id (`refund_tag`), at least the reference
///     UTxO's lovelace;
///   - the only other burns allowed are those policies' user tokens (-1);
///   - no tranche's capital moves (ada may only gain);
///   - each tranche's active cover drops by exactly its expired coverage.
pub fn validate_expire(
  ts: List<AssetTerms>,
  claim_grace_ms: Int,
  own: PolicyId,
  pool: PoolDatum,
  caps_in: List<Int>,
  caps_out: List<Int>,
  next: PoolDatum,
  minted: Pairs<AssetName, Int>,
  self: Transaction,
) -> Bool {
  let refs = list.filter(
    minted,
    fn(pair) {
      let Pair(n, _) = pair
      bytearray.starts_with(n, ref_label)
    },
  )
  let others = list.filter(
    minted,
    fn(pair) {
      let Pair(n, _) = pair
      !bytearray.starts_with(n, ref_label)
    },
  )
  expect refs != []
  let now = lower_bound(self.validity_range)
  let policies = list.map(
    refs,
    fn(pair) {
      let Pair(r, q) = pair
      expect q == -1
      let (policy_in, p) = policy_input(self.inputs, own, r)
      expect r == ref_name(p.policy_id)
      expect now > p.expiry + claim_grace_ms
      let deposit = assets.lovelace_of(policy_in.output.value)
      expect
        list.any(
          self.outputs,
          fn(o: Output) {
            and {
              o.address == p.refund_to,
              assets.lovelace_of(o.value) >= deposit,
              o.datum == InlineDatum(refund_tag(p.policy_id)),
            }
          },
        )
      p
    },
  )
  let users_ok = list.all(
    others,
    fn(pair) {
      let Pair(u, q) = pair
      q == -1 && list.any(policies, fn(p) { u == user_name(p.policy_id) })
    },
  )
  let reduced = list.foldl(
    policies,
    pool.tranches,
    fn(p, trs) {
      let t = tranche_of(ts, p.asset)
      expect Some(tr) = list.at(trs, t)
      set_at(
        trs,
        t,
        Tranche { ..tr, active_cover: tr.active_cover - p.coverage },
      )
    },
  )
  and {
    users_ok,
    others_untouched(ts, caps_in, caps_out, -1, 0),
    next.tranches == reduced,
  }
}
