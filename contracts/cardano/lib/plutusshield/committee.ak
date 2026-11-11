//// Assessor committee for exploit cover: who may approve a payout, and how
//// that list rotates.
////
//// The committee is no longer a validator parameter. It lives in the datum
//// of a single UTxO holding the committee NFT, managed by
//// `validators/committee.ak`, and `exploit_cover` reads it as a reference
//// input at `Settle`. Changing it is a two-step, time-delayed process in the
//// style of ContractsLibrary's Settings contract: the current committee
//// (threshold signatures) proposes a new one, and it can only be applied
//// after `delay_ms` has passed, giving LPs and policyholders time to react
//// (or the current committee time to cancel a proposal made with a leaked
//// key quorum).

use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/primitive/bytearray
use cardano/address.{Script}
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{InlineDatum, Input}

/// Token name of the committee NFT (under the committee validator's policy).
pub const committee_nft: AssetName = "committee"

/// `threshold` distinct signatures out of `assessors` release a payout.
pub type Committee {
  assessors: List<VerificationKeyHash>,
  threshold: Int,
}

/// A proposed committee and the earliest time it may be applied.
pub type PendingChange {
  next: Committee,
  effective_at: Int,
}

/// Datum of the committee UTxO.
pub type CommitteeState {
  current: Committee,
  pending: Option<PendingChange>,
}

pub type CommitteeAction {
  /// Current committee (threshold signatures) proposes `next`.
  Propose { next: Committee }
  /// Anyone applies the pending change once its delay has passed.
  Apply
  /// Current committee (threshold signatures) withdraws a pending change.
  Cancel
}

pub type CommitteeMint {
  /// Mint the committee NFT once, consuming the seed UTxO.
  InitCommittee
}

/// A committee is well formed when it lists at least one assessor, every
/// entry is a 28-byte key hash, no key appears twice (a duplicate would let
/// one signature count twice), and 1 <= threshold <= number of assessors.
pub fn committee_ok(c: Committee) -> Bool {
  let n = list.length(c.assessors)
  and {
    n >= 1,
    n <= 32,
    list.all(c.assessors, fn(k) { bytearray.length(k) == 28 }),
    list.length(list.unique(c.assessors)) == n,
    c.threshold >= 1,
    c.threshold <= n,
  }
}

/// How many distinct committee members signed. Counts committee entries, not
/// signatures, so a signer listed twice in `extra_signatories` counts once and
/// non-members never count.
pub fn committee_signatures(
  c: Committee,
  signatories: List<VerificationKeyHash>,
) -> Int {
  list.count(c.assessors, fn(k) { list.has(signatories, k) })
}

/// The authorization: at least `threshold` distinct members signed.
pub fn committee_approves(
  c: Committee,
  signatories: List<VerificationKeyHash>,
) -> Bool {
  committee_ok(c) && committee_signatures(c, signatories) >= c.threshold
}

/// The committee currently in force, read from the one reference input that
/// holds the committee NFT under `policy` and sits at that script's address.
/// A pending (not yet applied) change has no effect.
pub fn current_committee(
  reference_inputs: List<Input>,
  policy: PolicyId,
) -> Committee {
  expect [input] = list.filter(
    reference_inputs,
    fn(i) { assets.quantity_of(i.output.value, policy, committee_nft) == 1 },
  )
  expect input.output.address.payment_credential == Script(policy)
  expect InlineDatum(raw) = input.output.datum
  expect state: CommitteeState = raw
  state.current
}
