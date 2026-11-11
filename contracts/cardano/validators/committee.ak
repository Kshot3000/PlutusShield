//// PlutusShield assessor committee registry (Plutus V3).
////
//// One NFT-threaded UTxO whose datum is the exploit-cover assessor
//// committee. `exploit_cover` reads it as a reference input, so members and
//// threshold can rotate without redeploying the pool. Changes follow the
//// ContractsLibrary Settings pattern: propose (current committee signs) ->
//// wait `delay_ms` -> apply (anyone). The current committee can cancel a
//// pending change during the delay.
////
//// Parameters: `seed` (one-shot NFT mint) and `delay_ms` (minimum time
//// between a proposal landing and it taking effect).

use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/interval
use cardano/address.{Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use plutusshield/committee.{
  Apply, Cancel, Committee, CommitteeAction, CommitteeMint, CommitteeState,
  InitCommittee, PendingChange, Propose, committee_approves, committee_nft,
  committee_ok,
}
use plutusshield/pool.{lower_bound, upper_bound}

validator assessor_committee(seed: OutputReference, delay_ms: Int) {
  mint(redeemer: CommitteeMint, own: PolicyId, self: Transaction) {
    let InitCommittee = redeemer
    expect [Pair(name, 1)] = assets.tokens(self.mint, own) |> dict.to_pairs
    expect [out] = nft_outputs(self.outputs, own)
    expect InlineDatum(raw) = out.datum
    expect state: CommitteeState = raw
    and {
      name == committee_nft,
      delay_ms >= 0,
      list.any(self.inputs, fn(i) { i.output_reference == seed }),
      out.address.payment_credential == Script(own),
      assets.without_lovelace(out.value) == assets.from_asset(
        own,
        committee_nft,
        1,
      ),
      committee_ok(state.current),
      state.pending == None,
    }
  }

  spend(
    datum: Option<CommitteeState>,
    redeemer: CommitteeAction,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(state) = datum
    expect Some(own_in) = transaction.find_input(self.inputs, own_ref)
    expect Script(own) = own_in.output.address.payment_credential
    expect [out] = nft_outputs(self.outputs, own)
    expect InlineDatum(raw) = out.datum
    expect next: CommitteeState = raw
    let sigs = self.extra_signatories
    let continuing = and {
      assets.quantity_of(own_in.output.value, own, committee_nft) == 1,
      out.address == own_in.output.address,
      assets.without_lovelace(out.value) == assets.from_asset(
        own,
        committee_nft,
        1,
      ),
      assets.lovelace_of(out.value) >= assets.lovelace_of(own_in.output.value),
      assets.tokens(self.mint, own) == dict.empty,
    }
    continuing && when redeemer is {
      Propose { next: proposed } -> {
        expect Some(PendingChange { next: n, effective_at }) = next.pending
        and {
          committee_approves(state.current, sigs),
          committee_ok(proposed),
          n == proposed,
          next.current == state.current,
          effective_at >= upper_bound(self.validity_range) + delay_ms,
        }
      }
      Apply -> {
        expect Some(PendingChange { next: n, effective_at }) = state.pending
        and {
          lower_bound(self.validity_range) >= effective_at,
          next == CommitteeState { current: n, pending: None },
        }
      }
      Cancel -> and {
          committee_approves(state.current, sigs),
          state.pending != None,
          next == CommitteeState { current: state.current, pending: None },
        }
    }
  }

  else(_) {
    fail
  }
}

fn nft_outputs(outputs: List<Output>, own: PolicyId) -> List<Output> {
  list.filter(
    outputs,
    fn(o) { assets.quantity_of(o.value, own, committee_nft) == 1 },
  )
}

// ================================================================ tests

const own: PolicyId =
  #"cc11cc11cc11cc11cc11cc11cc11cc11cc11cc11cc11cc11cc11cc11"

const seed_ref =
  OutputReference {
    transaction_id: #"5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed",
    output_index: 0,
  }

const state_ref =
  OutputReference {
    transaction_id: #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    output_index: 0,
  }

const a1: VerificationKeyHash =
  #"a55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e5501"

const a2: VerificationKeyHash =
  #"a55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e5502"

const a3: VerificationKeyHash =
  #"a55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e5503"

const a4: VerificationKeyHash =
  #"a55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e55a55e5504"

const delay = 7 * 86_400_000

const t0 = 1_800_000_000_000

const old = Committee { assessors: [a1, a2, a3], threshold: 2 }

const new = Committee { assessors: [a2, a3, a4], threshold: 2 }

fn state_out(st: CommitteeState) -> Output {
  let d: Data = st
  Output {
    address: address.from_script(own),
    value: assets.from_lovelace(2_000_000)
      |> assets.add(own, committee_nft, 1),
    datum: InlineDatum(d),
    reference_script: None,
  }
}

fn change_tx(
  from: CommitteeState,
  to: CommitteeState,
  signers: List<VerificationKeyHash>,
  lo: Int,
  hi: Int,
) -> Transaction {
  Transaction {
    ..transaction.placeholder,
    inputs: [Input { output_reference: state_ref, output: state_out(from) }],
    outputs: [state_out(to)],
    extra_signatories: signers,
    validity_range: interval.between(lo, hi),
  }
}

fn run(
  from: CommitteeState,
  action: CommitteeAction,
  to: CommitteeState,
  signers: List<VerificationKeyHash>,
  lo: Int,
  hi: Int,
) -> Bool {
  assessor_committee.spend(
    seed_ref,
    delay,
    Some(from),
    action,
    state_ref,
    change_tx(from, to, signers, lo, hi),
  )
}

const settled = CommitteeState { current: old, pending: None }

fn pending_at(at: Int) -> CommitteeState {
  CommitteeState {
    current: old,
    pending: Some(PendingChange { next: new, effective_at: at }),
  }
}

test init_committee_ok() {
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [Input { output_reference: seed_ref, output: state_out(settled) }],
    outputs: [state_out(settled)],
    mint: assets.from_asset(own, committee_nft, 1),
  }
  assessor_committee.mint(seed_ref, delay, InitCommittee, own, tx)
}

test init_committee_without_seed_fails() fail {
  let tx = Transaction {
    ..transaction.placeholder,
    outputs: [state_out(settled)],
    mint: assets.from_asset(own, committee_nft, 1),
  }
  assessor_committee.mint(seed_ref, delay, InitCommittee, own, tx)
}

test init_committee_rejects_duplicate_key() fail {
  let bad = CommitteeState {
    current: Committee { assessors: [a1, a1, a2], threshold: 2 },
    pending: None,
  }
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [Input { output_reference: seed_ref, output: state_out(bad) }],
    outputs: [state_out(bad)],
    mint: assets.from_asset(own, committee_nft, 1),
  }
  assessor_committee.mint(seed_ref, delay, InitCommittee, own, tx)
}

test propose_by_current_quorum_with_delay_ok() {
  run(
    settled,
    Propose { next: new },
    pending_at(t0 + delay),
    [a1, a3],
    t0 - 600_000,
    t0,
  )
}

test propose_by_one_member_fails() fail {
  run(
    settled,
    Propose { next: new },
    pending_at(t0 + delay),
    [a1],
    t0 - 600_000,
    t0,
  )
}

test propose_with_short_delay_fails() fail {
  run(
    settled,
    Propose { next: new },
    pending_at(t0 + delay - 1),
    [a1, a3],
    t0 - 600_000,
    t0,
  )
}

test propose_cannot_change_current_immediately() fail {
  run(
    settled,
    Propose { next: new },
    CommitteeState { ..pending_at(t0 + delay), current: new },
    [a1, a3],
    t0 - 600_000,
    t0,
  )
}

test propose_malformed_committee_fails() fail {
  let bad = Committee { assessors: [a4], threshold: 2 }
  run(
    settled,
    Propose { next: bad },
    CommitteeState {
      current: old,
      pending: Some(PendingChange { next: bad, effective_at: t0 + delay }),
    },
    [a1, a3],
    t0 - 600_000,
    t0,
  )
}

test apply_after_delay_ok() {
  run(
    pending_at(t0 + delay),
    Apply,
    CommitteeState { current: new, pending: None },
    [],
    t0 + delay,
    t0 + delay + 600_000,
  )
}

test apply_before_delay_fails() fail {
  run(
    pending_at(t0 + delay),
    Apply,
    CommitteeState { current: new, pending: None },
    [],
    t0 + delay - 1,
    t0 + delay + 600_000,
  )
}

test apply_something_else_fails() fail {
  run(
    pending_at(t0 + delay),
    Apply,
    CommitteeState {
      current: Committee { assessors: [a4], threshold: 1 },
      pending: None,
    },
    [],
    t0 + delay,
    t0 + delay + 600_000,
  )
}

test cancel_by_current_quorum_ok() {
  run(pending_at(t0 + delay), Cancel, settled, [a2, a3], t0, t0 + 600_000)
}

test cancel_by_proposed_members_only_fails() fail {
  // a4 is only in the pending committee; it has no power yet
  run(pending_at(t0 + delay), Cancel, settled, [a4], t0, t0 + 600_000)
}

test committee_nft_cannot_leave_script() fail {
  let tx = Transaction {
    ..change_tx(settled, settled, [a1, a2], t0, t0 + 600_000),
    outputs: [
      Output {
        ..state_out(settled),
        address: address.from_verification_key(a1),
      },
    ],
  }
  assessor_committee.spend(
    seed_ref,
    delay,
    Some(settled),
    Cancel,
    state_ref,
    tx,
  )
}

test current_committee_ignores_pending() {
  let d: Data = pending_at(t0)
  let ref = Input {
    output_reference: state_ref,
    output: Output { ..state_out(settled), datum: InlineDatum(d) },
  }
  committee.current_committee([ref], own) == old
}
