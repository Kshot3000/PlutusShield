# PlutusShield on Midnight

`src/policy-cover.compact` is the private side of every PlutusShield policy. Each Cardano policy NFT is mirrored here by its 32-byte policy id, but the record holds only commitments:

| Field | What's stored | Why |
|---|---|---|
| `holder` | `persistentHash("plutusshield:role:" ‖ "holder" ‖ sk)` | Ownership without a public key on-ledger |
| `coverage` | `persistentCommit(amount, salt)` | Coverage size stays hidden |
| `evidence` | Commitment to the claim evidence bundle | Exploit writeups and tx dumps stay off-ledger |
| `status` | `ACTIVE`, `CLAIM_PENDING`, `PAID`, `EXPIRED` | Public lifecycle |

## Circuits

| Circuit | Caller | Effect |
|---|---|---|
| `registerPolicy(id, holder, coverage, expiry)` | Issuer | Mirror a confirmed Cardano mint |
| `proveCover(id, minCoverage)` | Holder | Prove ACTIVE cover of at least `minCoverage` without revealing the amount or the holder |
| `fileClaim(id, evidenceCommitment)` | Holder | Move to `CLAIM_PENDING` |
| `resolveClaim(id, approved)` | Assessor | `PAID` (Cardano settles the payout) or back to `ACTIVE` |
| `expirePolicy(id)` | Issuer | Mirror Cardano expiry |

`proveCover` is the partner hook: a DEX or lending market can offer "insured-only" pools or better terms to users who prove cover, and learns nothing else.

Roles are witness-derived commitments, never `ownPublicKey()`.

## Build and test

```bash
pnpm compile        # compactc 0.31.1, generates prover/verifier keys for all 5 circuits
pnpm test           # --skip-zk compile, then node:test simulation via @midnight-ntwrk/compact-runtime 0.16.0
```

The tests cover issuer-only registration, duplicate ids, threshold proofs, forged openings, non-holder rejection, the full claim lifecycle, rejected claims, and expiry.

## Status

Compiles and passes local simulation. Not deployed to any Midnight network, not audited. Expiry is issuer-driven for now; time-locked self-expiry comes with the Cardano validators.
