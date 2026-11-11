//// Parametric trigger evaluation against authenticated oracle feeds.
////
//// Trust model: each allowlisted feed has its own operator key and its own
//// feed-token policy. A reading counts only if it holds that feed's token
//// AND sits at the operator's key address, and readings are counted by
//// operator, so settling a claim needs `quorum` distinct operators (2-of-3
//// by default) to agree. Readings must describe the past: a window that ends
//// after the transaction's validity lower bound is ignored.

use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/primitive/bytearray
use cardano/address.{VerificationKey}
use cardano/assets
use cardano/transaction.{InlineDatum, Input, Output, OutputReference}
use plutusshield/types.{Feed, OracleConfig, OracleDatum, Trigger}

/// A well-formed oracle allowlist: at least 3 feeds, distinct operators,
/// distinct feed policies, 28-byte hashes, and a strict-majority quorum.
pub fn config_ok(config: OracleConfig) -> Bool {
  let n = list.length(config.feeds)
  let ops = list.map(config.feeds, fn(f) { f.operator })
  let pols = list.map(config.feeds, fn(f) { f.policy_id })
  and {
    n >= 3,
    n <= 32,
    list.all(
      config.feeds,
      fn(f) {
        bytearray.length(f.operator) == 28 && bytearray.length(f.policy_id) == 28
      },
    ),
    list.length(list.unique(ops)) == n,
    list.length(list.unique(pols)) == n,
    config.quorum <= n,
    // strict majority: with 3 feeds, 2 must agree; one key never suffices
    2 * config.quorum > n,
    config.quorum >= 2,
  }
}

/// The operator an output authenticates as, if any: it must hold exactly one
/// token under one allowlisted feed's policy (with that feed's name, and
/// nothing else under that policy) and sit at that feed's operator address.
pub fn feed_of(
  output: Output,
  config: OracleConfig,
) -> Option<VerificationKeyHash> {
  list.foldr(
    config.feeds,
    None,
    fn(f: Feed, acc) {
      when acc is {
        Some(_) -> acc
        None ->
          when assets.tokens(output.value, f.policy_id) |> dict.to_pairs is {
            [Pair(name, 1)] ->
              if and {
                name == f.name,
                output.address.payment_credential == VerificationKey(f.operator),
              } {
                Some(f.operator)
              } else {
                None
              }
            _ -> None
          }
      }
    },
  )
}

/// Does one oracle datum attest the trigger, fully inside the cover period,
/// for a window that has already ended by `now` (the tx's validity lower
/// bound)?
pub fn attests(
  datum: OracleDatum,
  trigger: Trigger,
  start: Int,
  expiry: Int,
  now: Int,
) -> Bool {
  and {
    datum.covered_asset == trigger.covered_asset,
    datum.price_bps < trigger.threshold_bps,
    datum.window_start < datum.window_end,
    datum.window_end - datum.window_start >= trigger.window_ms,
    datum.window_start >= start,
    datum.window_end <= expiry,
    datum.window_end <= now,
  }
}

/// Does one oracle datum attest a healthy peg recently enough to sell cover?
/// `fresh_after` is the oldest acceptable `window_end`; `now` (the tx's
/// validity lower bound) is the newest — a future-dated reading can't stay
/// "fresh" forever.
pub fn attests_peg(
  datum: OracleDatum,
  trigger: Trigger,
  fresh_after: Int,
  now: Int,
) -> Bool {
  and {
    datum.covered_asset == trigger.covered_asset,
    datum.price_bps >= trigger.threshold_bps,
    datum.window_start <= datum.window_end,
    datum.window_end >= fresh_after,
    datum.window_end <= now,
  }
}

/// How many distinct feed operators, among the reference inputs, carry a
/// well-formed datum satisfying `pred`. Unauthenticated or malformed oracle
/// UTxOs are ignored, never trusted. An operator is counted at most once.
fn agreeing_feeds(
  reference_inputs: List<Input>,
  config: OracleConfig,
  pred: fn(OracleDatum) -> Bool,
) -> Int {
  let agreeing = list.foldr(
    reference_inputs,
    [],
    fn(input, acc) {
      when feed_of(input.output, config) is {
        Some(op) ->
          if list.has(acc, op) {
            acc
          } else {
            when input.output.datum is {
              InlineDatum(raw) ->
                if raw is OracleDatum {
                  if pred(raw) {
                    [op, ..acc]
                  } else {
                    acc
                  }
                } else {
                  acc
                }
              _ -> acc
            }
          }
        None -> acc
      }
    },
  )
  list.length(agreeing)
}

fn quorum_agrees(
  reference_inputs: List<Input>,
  config: OracleConfig,
  pred: fn(OracleDatum) -> Bool,
) -> Bool {
  config_ok(config) && agreeing_feeds(reference_inputs, config, pred) >= config.quorum
}

/// Settlement: a quorum of distinct operators attests the trigger inside
/// [start, expiry], for windows that ended by `now`.
pub fn triggered(
  reference_inputs: List<Input>,
  config: OracleConfig,
  trigger: Trigger,
  start: Int,
  expiry: Int,
  now: Int,
) -> Bool {
  quorum_agrees(
    reference_inputs,
    config,
    fn(d) { attests(d, trigger, start, expiry, now) },
  )
}

/// Sale circuit-breaker: EVERY allowlisted feed reports the covered asset at
/// or above the trigger threshold, with readings no older than `fresh_after`
/// and not dated after `now`.
///
/// Unanimity, not quorum: the buyer chooses which reference inputs to attach,
/// so a quorum rule would let them leave out a feed that already shows a
/// depeg and buy with the healthy ones. Requiring all feeds fails closed: one
/// depegged, stale, or missing feed pauses sales. It never affects settlement,
/// which still uses the quorum in `triggered`.
pub fn healthy(
  reference_inputs: List<Input>,
  config: OracleConfig,
  trigger: Trigger,
  fresh_after: Int,
  now: Int,
) -> Bool {
  let all = list.length(config.feeds)
  config_ok(config) && agreeing_feeds(
    reference_inputs,
    config,
    fn(d) { attests_peg(d, trigger, fresh_after, now) },
  ) == all
}

// ---------------------------------------------------------------- tests

const op_a: VerificationKeyHash =
  #"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"

const op_b: VerificationKeyHash =
  #"b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2"

const op_c: VerificationKeyHash =
  #"c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3"

const pol_a = #"0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0a"

const pol_b = #"0bbc1e0bbc1e0bbc1e0bbc1e0bbc1e0bbc1e0bbc1e0bbc1e0bbc1e0b"

const pol_c = #"0ccc1e0ccc1e0ccc1e0ccc1e0ccc1e0ccc1e0ccc1e0ccc1e0ccc1e0c"

const trigger =
  Trigger { covered_asset: "USDM", threshold_bps: 9_500, window_ms: 86_400_000 }

const config =
  OracleConfig {
    feeds: [
      Feed { name: "feed-a", policy_id: pol_a, operator: op_a },
      Feed { name: "feed-b", policy_id: pol_b, operator: op_b },
      Feed { name: "feed-c", policy_id: pol_c, operator: op_c },
    ],
    quorum: 2,
  }

/// "now" for settlement tests: well after the depeg window below ends.
const now = 200_000_000

fn feed_at(
  name: ByteArray,
  policy: ByteArray,
  operator: ByteArray,
  d: Data,
) -> Input {
  Input {
    output_reference: OutputReference { transaction_id: #"00", output_index: 0 },
    output: Output {
      address: address.from_verification_key(operator),
      value: assets.from_lovelace(2_000_000) |> assets.add(policy, name, 1),
      datum: InlineDatum(d),
      reference_script: None,
    },
  }
}

fn fa(d: Data) -> Input {
  feed_at("feed-a", pol_a, op_a, d)
}

fn fb(d: Data) -> Input {
  feed_at("feed-b", pol_b, op_b, d)
}

fn fc(d: Data) -> Input {
  feed_at("feed-c", pol_c, op_c, d)
}

fn depeg(price: Int) -> Data {
  let d: Data = OracleDatum {
    covered_asset: "USDM",
    price_bps: price,
    window_start: 1_000,
    window_end: 1_000 + 86_400_000,
  }
  d
}

test quorum_of_two_distinct_operators_triggers() {
  triggered([fa(depeg(9_100)), fc(depeg(9_400))], config, trigger, 0, now, now)
}

test same_feed_twice_does_not_make_quorum() {
  !triggered([fa(depeg(9_100)), fa(depeg(9_100))], config, trigger, 0, now, now)
}

test malformed_oracle_datum_is_ignored() {
  !triggered([fa(depeg(9_100)), fb("garbage")], config, trigger, 0, now, now)
}

test one_key_cannot_forge_two_feeds() {
  // operator A mints its own feed token AND a token named like feed B under
  // its own policy, both at its own address: still only one operator.
  !triggered(
    [fa(depeg(9_100)), feed_at("feed-b", pol_a, op_a, depeg(9_100))],
    config,
    trigger,
    0,
    now,
    now,
  )
}

test feed_token_at_wrong_address_is_ignored() {
  // B's genuine token, but the UTxO sits at A's address (e.g. a stolen or
  // borrowed token re-published by someone else): not B's reading.
  !triggered(
    [fa(depeg(9_100)), feed_at("feed-b", pol_b, op_a, depeg(9_100))],
    config,
    trigger,
    0,
    now,
    now,
  )
}

test future_dated_depeg_window_is_ignored() {
  // window ends after the tx's lower bound: it hasn't happened yet
  !triggered(
    [fa(depeg(9_100)), fc(depeg(9_400))],
    config,
    trigger,
    0,
    now,
    1_000 + 86_400_000 - 1,
  )
}

test depeg_window_ending_exactly_now_counts() {
  triggered(
    [fa(depeg(9_100)), fc(depeg(9_400))],
    config,
    trigger,
    0,
    now,
    1_000 + 86_400_000,
  )
}

test config_needs_three_distinct_operators() {
  and {
    config_ok(config),
    !config_ok(OracleConfig { ..config, feeds: list.take(config.feeds, 2) }),
    // same operator on two feeds
    !config_ok(
      OracleConfig {
        ..config,
        feeds: [
          Feed { name: "feed-a", policy_id: pol_a, operator: op_a },
          Feed { name: "feed-b", policy_id: pol_b, operator: op_a },
          Feed { name: "feed-c", policy_id: pol_c, operator: op_c },
        ],
      },
    ),
    // shared feed policy (the old single-key setup)
    !config_ok(
      OracleConfig {
        ..config,
        feeds: [
          Feed { name: "feed-a", policy_id: pol_a, operator: op_a },
          Feed { name: "feed-b", policy_id: pol_a, operator: op_b },
          Feed { name: "feed-c", policy_id: pol_a, operator: op_c },
        ],
      },
    ),
    // quorum must be a strict majority, and at least 2
    !config_ok(OracleConfig { ..config, quorum: 1 }),
    !config_ok(OracleConfig { ..config, quorum: 4 }),
  }
}

test misconfigured_oracle_never_triggers() {
  !triggered(
    [fa(depeg(9_100)), fb(depeg(9_100)), fc(depeg(9_100))],
    OracleConfig { ..config, quorum: 1 },
    trigger,
    0,
    now,
    now,
  )
}

fn peg(price: Int, window_end: Int) -> Data {
  let d: Data = OracleDatum {
    covered_asset: "USDM",
    price_bps: price,
    window_start: window_end - 86_400_000,
    window_end,
  }
  d
}

test all_feeds_healthy_allows_sale() {
  healthy(
    [
      fa(peg(10_000, 5_000_000)),
      fb(peg(9_980, 5_000_000)),
      fc(peg(9_990, 4_500_000)),
    ],
    config,
    trigger,
    4_000_000,
    5_000_000,
  )
}

test exactly_at_threshold_counts_as_healthy() {
  healthy(
    [
      fa(peg(9_500, 5_000_000)),
      fb(peg(9_500, 5_000_000)),
      fc(peg(9_500, 5_000_000)),
    ],
    config,
    trigger,
    5_000_000,
    5_000_000,
  )
}

test future_dated_peg_reading_blocks_sale() {
  // a reading dated after "now" would otherwise stay fresh forever
  !healthy(
    [
      fa(peg(10_000, 5_000_000)),
      fb(peg(10_000, 5_000_000)),
      fc(peg(10_000, 900_000_000)),
    ],
    config,
    trigger,
    4_000_000,
    5_000_000,
  )
}

test depeg_reading_blocks_sale() {
  !healthy(
    [
      fa(peg(10_000, 5_000_000)),
      fb(peg(10_000, 5_000_000)),
      fc(peg(9_400, 5_000_000)),
    ],
    config,
    trigger,
    4_000_000,
    5_000_000,
  )
}

test omitting_a_feed_blocks_sale() {
  !healthy(
    [fa(peg(10_000, 5_000_000)), fb(peg(10_000, 5_000_000))],
    config,
    trigger,
    4_000_000,
    5_000_000,
  )
}

test no_allowlisted_feeds_blocks_sale() {
  !healthy([], OracleConfig { ..config, feeds: [] }, trigger, 0, 0)
}

test stale_reading_blocks_sale() {
  !healthy(
    [
      fa(peg(10_000, 5_000_000)),
      fb(peg(10_000, 5_000_000)),
      fc(peg(10_000, 3_999_999)),
    ],
    config,
    trigger,
    4_000_000,
    5_000_000,
  )
}

test healthy_reading_for_another_asset_is_ignored() {
  let other: Data = OracleDatum {
    covered_asset: "DJED",
    price_bps: 10_000,
    window_start: 0,
    window_end: 5_000_000,
  }
  !healthy(
    [fa(peg(10_000, 5_000_000)), fb(peg(10_000, 5_000_000)), fc(other)],
    config,
    trigger,
    4_000_000,
    5_000_000,
  )
}

test healthy_needs_distinct_feeds() {
  !healthy(
    [
      fa(peg(10_000, 5_000_000)),
      fb(peg(10_000, 5_000_000)),
      fb(peg(10_000, 5_000_000)),
    ],
    config,
    trigger,
    4_000_000,
    5_000_000,
  )
}
