//// Token naming and policy-id derivation.

use aiken/cbor
use aiken/crypto
use aiken/primitive/bytearray
use cardano/assets.{AssetName}
use cardano/transaction.{OutputReference}

/// Unique pool state token (one per deployment).
pub const pool_nft: AssetName = "pool"

/// Fungible LP share token.
pub const lp_token: AssetName = "lp"

/// CIP-67 label (100): reference token, locked at the script with the datum.
pub const ref_label: ByteArray = #"000643b0"

/// CIP-67 label (222): user token, held by the policyholder (bearer claim right).
pub const user_label: ByteArray = #"000de140"

/// Policy id = blake2b_256(cbor(pool output reference spent by the purchase)).
/// Every pool UTxO is spent exactly once, so ids are unique.
pub fn policy_id_from(pool_ref: OutputReference) -> ByteArray {
  crypto.blake2b_256(cbor.serialise(pool_ref))
}

pub fn ref_name(policy_id: ByteArray) -> AssetName {
  bytearray.concat(ref_label, bytearray.take(policy_id, 28))
}

pub fn user_name(policy_id: ByteArray) -> AssetName {
  bytearray.concat(user_label, bytearray.take(policy_id, 28))
}

pub fn is_user_name(name: AssetName) -> Bool {
  bytearray.length(name) == 32 && bytearray.starts_with(name, user_label)
}

// ---------------------------------------------------------------- tests

/// Golden vector shared with packages/sdk (cardano.test.ts).
test policy_id_golden_vector() {
  let oref = OutputReference {
    transaction_id: #"0101010101010101010101010101010101010101010101010101010101010101",
    output_index: 0,
  }
  and {
    cbor.serialise(oref) == #"d8799f5820010101010101010101010101010101010101010101010101010101010101010100ff",
    policy_id_from(oref) == #"f548355b76a9d34c085f05020ac0437fa82804e72b3d9660710dbb78daea9aa4",
  }
}

test token_names_are_32_bytes_and_distinct() {
  let id = #"aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899"
  and {
    bytearray.length(ref_name(id)) == 32,
    bytearray.length(user_name(id)) == 32,
    ref_name(id) != user_name(id),
    is_user_name(user_name(id)),
    !is_user_name(ref_name(id)),
    !is_user_name(pool_nft),
  }
}
