# PlutusShield on Midnight

`src/policy-cover.compact` is the private side of every PlutusShield policy. Each Cardano policy NFT is mirrored here by its 32-byte policy id, but the record holds only commitments:

| Field | What's stored | Why |
|---|---|---|
| `holder` | `persistentHash("plutusshield:role:" ‖ "holder" ‖ sk)` | Ownership without a public key on-ledger |
| `coverage` | `persistentCommit(amount, salt)` | Coverage size stays hidden |
| `evidence` | `evidenceCommitment(SHA-256(bundle), salt)` | Exploit writeups and tx dumps stay off-ledger |
| `status` | `ACTIVE`, `CLAIM_PENDING`, `PAID`, `EXPIRED` | Public lifecycle |

## Circuits

| Circuit | Caller | Effect |
|---|---|---|
| `registerPolicy(id, holder, coverage, expiry)` | Issuer | Mirror a confirmed Cardano mint |
| `proveCover(id, minCoverage)` | Holder | Prove ACTIVE cover of at least `minCoverage` without revealing the amount or the holder |
| `rotateHolder(id, newHolderCommitment)` | Holder | Re-key an `ACTIVE` policy to a new holder commitment (wallet rotation or private transfer) |
| `fileClaim(id, evidenceCommitment)` | Holder | Move to `CLAIM_PENDING` |
| `resolveClaim(id, approved)` | Assessor | `PAID` (Cardano settles the payout) or back to `ACTIVE` |
| `expirePolicy(id)` | Issuer | Mirror Cardano expiry |

`proveCover` is the partner hook: a DEX or lending market can offer "insured-only" pools or better terms to users who prove cover, and learns nothing else.

Roles are witness-derived commitments, never `ownPublicKey()`.

Pure helpers (no proof, no keys): `roleCommitment`, `coverageCommitment`, `evidenceCommitment`, and the tags `issuerTag` / `holderTag` / `assessorTag` / `evidenceTag`.

### Evidence commitments

`fileClaim` stores whatever non-zero 32 bytes the holder passes, so the contract publishes the scheme claimants and assessors use:

```
evidenceCommitment(digest, salt) = persistentHash<Vector<3, Bytes<32>>>([pad(32, "plutusshield:evidence:v1"), digest, salt])
                                 = SHA-256(tag ‖ digest ‖ salt)
digest = SHA-256(canonical JSON of the evidence bundle), salt = 32 random bytes
```

`packages/sdk/src/evidence.ts` mirrors it in WebCrypto, builds the canonical bundle, encrypts it with AES-256-GCM, and verifies an opening for assessors. The web app's `/claim/evidence` page runs it in the browser. The circuit can't check the opening (the bundle never enters it); the assessor checks it off-ledger before `resolveClaim`. A fresh salt per filing keeps the commitment hiding and makes a re-filed bundle unlinkable to a rejected one.

### Holder rotation

`rotateHolder` lets the current holder replace the record's `holder` commitment, for a lost or compromised device, a wallet migration, or a private transfer of the cover. Rules:

- Only the current holder can call it (same `assertHolder` witness check as `proveCover` and `fileClaim`).
- Only while `ACTIVE`. A policy with a pending claim, a paid claim, or an expired term is frozen to its holder of record.
- The new commitment must be non-zero and different from the current one.
- Only `holder` changes. Coverage, expiry, and evidence are untouched, and `holderRotations` is incremented.
- Effect is immediate: the old key fails `proveCover`, `fileClaim`, and `rotateHolder`; the new key passes them.

Neither key is revealed. The rotation itself is visible (the policy id is public and the commitment changes). The new holder also needs the coverage opening `(amount, salt)`, handed over off-ledger. They can check it against the public `coverage` commitment before accepting. On Cardano the claim right is the policy user token (CIP-67 label 222), a bearer asset, so a full transfer also moves that token. The two chains are not linked trustlessly yet.

## Build and test

```bash
pnpm compile        # compactc 0.31.1, generates prover/verifier keys for all 6 circuits (~16 s locally)
pnpm test           # --skip-zk compile, then node:test simulation via @midnight-ntwrk/compact-runtime 0.16.0
```

21 tests cover:

- issuer-only registration and duplicate ids
- threshold proofs and forged openings
- non-holder rejection, the full claim lifecycle, rejected claims, and expiry
- holder rotation:
  - only the holder field changes
  - afterwards the old key can't prove, claim, or rotate
  - the new key can prove and claim
  - chained rotations work
  - non-holders (including the issuer) can't rotate
  - empty, unchanged, or unknown-id rotations are rejected
  - no rotation while a claim is pending, after payout, or after expiry
- evidence vault (imports `packages/sdk/src/evidence.ts`, so Node 22.6+ for type stripping):
  - SDK `evidenceCommitment` equals the compiled pure circuit on random inputs, and raw `persistentHash`
  - an SDK-sealed bundle filed with `fileClaim` verifies against the stored record, then is paid with its commitment kept
  - a rejected claim clears the commitment; re-sealing the same evidence gives a new commitment, and the old bundle no longer matches the ledger

## Status

Compiles and passes local simulation. Not deployed to any Midnight network, not audited. Expiry here is issuer-driven and mirrors the Cardano side, where `Expire` in `contracts/cardano` is time-locked (expiry + claim grace) and callable by anyone.
