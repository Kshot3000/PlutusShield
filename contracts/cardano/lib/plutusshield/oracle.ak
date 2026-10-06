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

/// True when at least `quorum` distinct allowlisted feeds, read from
/// reference inputs, attest the trigger. Unauthenticated or malformed oracle
/// UTxOs are ignored, never trusted. A feed is counted at most once.
pub fn triggered(
  reference_inputs: List<Input>,
  config: OracleConfig,
  trigger: Trigger,
  start: Int,
  expiry: Int,
) -> Bool {
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
                  if attests(raw, trigger, start, expiry) {
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
  config.quorum >= 1 && list.length(agreeing) >= config.quorum
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
