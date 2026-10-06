//// Parametric trigger evaluation against authenticated oracle feeds.

use aiken/collection/dict
use aiken/collection/list
use cardano/address
use cardano/assets.{AssetName}
use cardano/transaction.{InlineDatum, Input, Output, OutputReference}
use plutusshield/types.{OracleConfig, OracleDatum, Trigger}

/// The allowlisted feed name an output authenticates as, if any: it must hold
/// exactly one token under the oracle policy whose name is in `feeds`.
pub fn feed_of(output: Output, config: OracleConfig) -> Option<AssetName> {
  let tokens = assets.tokens(output.value, config.policy_id) |> dict.to_pairs
  when tokens is {
    [Pair(name, 1)] ->
      if list.has(config.feeds, name) {
        Some(name)
      } else {
        None
      }
    _ -> None
  }
}

/// Does one oracle datum attest the trigger, fully inside the cover period?
pub fn attests(
  datum: OracleDatum,
  trigger: Trigger,
  start: Int,
  expiry: Int,
) -> Bool {
  and {
    datum.covered_asset == trigger.covered_asset,
    datum.price_bps < trigger.threshold_bps,
    datum.window_end - datum.window_start >= trigger.window_ms,
    datum.window_start >= start,
    datum.window_end <= expiry,
  }
}

/// Does one oracle datum attest a healthy peg recently enough to sell cover?
/// `fresh_after` is the oldest acceptable `window_end`.
pub fn attests_peg(
  datum: OracleDatum,
  trigger: Trigger,
  fresh_after: Int,
) -> Bool {
  and {
    datum.covered_asset == trigger.covered_asset,
    datum.price_bps >= trigger.threshold_bps,
    datum.window_end >= fresh_after,
  }
}

/// True when at least `quorum` distinct allowlisted feeds, read from
/// reference inputs, have a datum satisfying `pred`. Unauthenticated or
/// malformed oracle UTxOs are ignored, never trusted. A feed is counted at
/// most once.
/// How many distinct allowlisted feeds, among the reference inputs, carry a
/// well-formed datum satisfying `pred`. A feed referenced twice counts once.
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
        Some(name) ->
          if list.has(acc, name) {
            acc
          } else {
            when input.output.datum is {
              InlineDatum(raw) ->
                if raw is OracleDatum {
                  if pred(raw) {
                    [name, ..acc]
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
  config.quorum >= 1 && agreeing_feeds(reference_inputs, config, pred) >= config.quorum
}

/// Settlement: a quorum of feeds attests the trigger inside [start, expiry].
pub fn triggered(
  reference_inputs: List<Input>,
  config: OracleConfig,
  trigger: Trigger,
  start: Int,
  expiry: Int,
) -> Bool {
  quorum_agrees(
    reference_inputs,
    config,
    fn(d) { attests(d, trigger, start, expiry) },
  )
}

/// Sale circuit-breaker: EVERY allowlisted feed reports the covered asset at
/// or above the trigger threshold, with readings no older than `fresh_after`.
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
) -> Bool {
  let all = list.length(config.feeds)
  all >= 1 && agreeing_feeds(
    reference_inputs,
    config,
    fn(d) { attests_peg(d, trigger, fresh_after) },
  ) == all
}

// ---------------------------------------------------------------- tests

const oracle_policy =
  #"0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0aac1e0a"

const trigger =
  Trigger { covered_asset: "USDM", threshold_bps: 9_500, window_ms: 86_400_000 }

const config =
  OracleConfig {
    policy_id: oracle_policy,
    feeds: ["feed-a", "feed-b", "feed-c"],
    quorum: 2,
  }

fn feed(name: ByteArray, policy: ByteArray, d: Data) -> Input {
  Input {
    output_reference: OutputReference { transaction_id: #"00", output_index: 0 },
    output: Output {
      address: address.from_verification_key(#"01"),
      value: assets.from_lovelace(2_000_000) |> assets.add(policy, name, 1),
      datum: InlineDatum(d),
      reference_script: None,
    },
  }
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

test quorum_of_two_distinct_feeds_triggers() {
  triggered(
    [
      feed("feed-a", oracle_policy, depeg(9_100)),
      feed("feed-c", oracle_policy, depeg(9_400)),
    ],
    config,
    trigger,
    0,
    200_000_000,
  )
}

test same_feed_twice_does_not_make_quorum() {
  !triggered(
    [
      feed("feed-a", oracle_policy, depeg(9_100)),
      feed("feed-a", oracle_policy, depeg(9_100)),
    ],
    config,
    trigger,
    0,
    200_000_000,
  )
}

test malformed_oracle_datum_is_ignored() {
  !triggered(
    [
      feed("feed-a", oracle_policy, depeg(9_100)),
      feed("feed-b", oracle_policy, "garbage"),
    ],
    config,
    trigger,
    0,
    200_000_000,
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
      feed("feed-a", oracle_policy, peg(10_000, 5_000_000)),
      feed("feed-b", oracle_policy, peg(9_980, 5_000_000)),
      feed("feed-c", oracle_policy, peg(9_990, 4_500_000)),
    ],
    config,
    trigger,
    4_000_000,
  )
}

test exactly_at_threshold_counts_as_healthy() {
  healthy(
    [
      feed("feed-a", oracle_policy, peg(9_500, 5_000_000)),
      feed("feed-b", oracle_policy, peg(9_500, 5_000_000)),
      feed("feed-c", oracle_policy, peg(9_500, 5_000_000)),
    ],
    config,
    trigger,
    5_000_000,
  )
}

test depeg_reading_blocks_sale() {
  // two feeds healthy (a quorum), the third already below the threshold
  !healthy(
    [
      feed("feed-a", oracle_policy, peg(10_000, 5_000_000)),
      feed("feed-b", oracle_policy, peg(10_000, 5_000_000)),
      feed("feed-c", oracle_policy, peg(9_400, 5_000_000)),
    ],
    config,
    trigger,
    4_000_000,
  )
}

test omitting_a_feed_blocks_sale() {
  // a quorum of healthy feeds is not enough: a buyer could otherwise leave out
  // the feed that already shows the depeg
  !healthy(
    [
      feed("feed-a", oracle_policy, peg(10_000, 5_000_000)),
      feed("feed-b", oracle_policy, peg(10_000, 5_000_000)),
    ],
    config,
    trigger,
    4_000_000,
  )
}

test no_allowlisted_feeds_blocks_sale() {
  !healthy([], OracleConfig { ..config, feeds: [] }, trigger, 0)
}

test stale_reading_blocks_sale() {
  !healthy(
    [
      feed("feed-a", oracle_policy, peg(10_000, 5_000_000)),
      feed("feed-b", oracle_policy, peg(10_000, 5_000_000)),
      feed("feed-c", oracle_policy, peg(10_000, 3_999_999)),
    ],
    config,
    trigger,
    4_000_000,
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
    [
      feed("feed-a", oracle_policy, peg(10_000, 5_000_000)),
      feed("feed-b", oracle_policy, peg(10_000, 5_000_000)),
      feed("feed-c", oracle_policy, other),
    ],
    config,
    trigger,
    4_000_000,
  )
}

test healthy_needs_distinct_feeds() {
  !healthy(
    [
      feed("feed-a", oracle_policy, peg(10_000, 5_000_000)),
      feed("feed-b", oracle_policy, peg(10_000, 5_000_000)),
      feed("feed-b", oracle_policy, peg(10_000, 5_000_000)),
    ],
    config,
    trigger,
    4_000_000,
  )
}
