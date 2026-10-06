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
| `registerPolicy(id, holder, coverage, expiry, cardanoCommitment)` | Issuer | Mirror a confirmed Cardano mint; refuses a holder/coverage pair that doesn't open the Cardano datum's commitment |
| `proveCover(id, minCoverage)` | Holder | Prove ACTIVE cover of at least `minCoverage` without revealing the amount or the holder |
| `rotateHolder(id, newHolderCommitment)` | Holder | Re-key an `ACTIVE` policy to a new holder commitment (wallet rotation or private transfer) |
| `fileClaim(id, evidenceCommitment)` | Holder | Move to `CLAIM_PENDING` |
| `resolveClaim(id, approved)` | Assessor | `PAID` (Cardano settles the payout) or back to `ACTIVE` |
| `expirePolicy(id)` | Issuer | Mirror Cardano expiry |

`proveCover` is the partner hook: a DEX or lending market can offer "insured-only" pools or better terms to users who prove cover, and learns nothing else.

Roles are witness-derived commitments, never `ownPublicKey()`.

Pure helpers (no proof, no keys): `roleCommitment`, `coverageCommitment`, `registrationCommitment`, `evidenceCommitment`, and the tags `issuerTag` / `holderTag` / `assessorTag` / `registrationTag` / `evidenceTag`.

### Cardano binding and policy keys

Every Buy on Cardano (the `/cover` page, `pnpm web-buy`, `pnpm preview buy` and the emulator all use the same builder, `apps/web/src/lib/tx/cover.ts`) makes a **policy key** on the buyer's device: a random 32-byte holder secret and a random 32-byte coverage salt. Only one value derived from it goes on Cardano, the policy datum's `midnight_commitment`:

```
holder       = roleCommitment(holderSecret, holderTag())        = SHA-256(pad32("plutusshield:role:") ‖ pad32("holder") ‖ holderSecret)
coverage     = coverageCommitment(amount, salt)                 = SHA-256(salt ‖ u64le(amount))      (persistentCommit<Uint<64>>)
registration = registrationCommitment(policyId, holder, coverage) = SHA-256(pad32("plutusshield:register:v1") ‖ policyId ‖ holder ‖ coverage)

PolicyDatum.midnight_commitment = registration      (policyId = the datum's policy_id, amount = its coverage)
```

`registerPolicy` takes the datum field as `cardanoCommitment` and asserts `registrationCommitment(policyId, holder, coverage) == cardanoCommitment`. The issuer can delay or skip a registration, but can't register a holder key or coverage the buyer didn't commit to. The record is public, so anyone can recompute the binding from the ledger and the Cardano datum.

`packages/sdk/src/midnight.ts` implements the three formulas in WebCrypto plus the key file (`plutusshield/policy-key@1`), a passphrase-encrypted backup (`plutusshield/policy-key-envelope@1`: PBKDF2-SHA-256 with 600k iterations, then AES-256-GCM with the policy id and commitment as AAD), `checkPolicyKey` (re-derive and compare with a datum), `holderPrivateState` (the `localSecretKey` / `coverageAmount` / `coverageSalt` witness state) and `registerPolicyArgs`. The web app saves the key to `localStorage` before the wallet prompt, offers both backups after the Buy, and shows per-policy key status, export and restore in **My policies**.

The holder secret is the private proof of ownership on Midnight: `proveCover`, `fileClaim` and `rotateHolder` check it. Losing it means you can't act on Midnight (the Cardano claim token is separate). Anyone who has the plain key file can act as you there.

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

26 tests cover:

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
- Cardano Buy to Midnight registration (imports `packages/sdk/src/midnight.ts`):
  - SDK `holderCommitment` / `roleCommitment` / `coverageCommitment` / `registrationCommitment` equal the compiled pure circuits on 24 random inputs, including `Uint<64>` edge amounts, and raw `persistentCommit`
  - the issuer registers from an SDK policy key with the datum commitment; the record recomputes to the datum; the holder proves cover with `holderPrivateState(key)` (and not above the amount) and can file a claim
  - a wrong holder secret, a wrong coverage salt, or another policy's key can't prove or claim
  - `registerPolicy` rejects a swapped holder, an inflated coverage, a replay under another policy id, and a random (pre-wiring placeholder) datum commitment
  - a key restored from an encrypted backup still proves cover

## Midnight Preprod

`policy-cover` is deployed on **Midnight Preprod** (compactc 0.31.1, proof server 8.1.0), and the first real Cardano Preview policy is mirrored into it. Public record: [`deployments/preprod.json`](deployments/preprod.json).

| | |
|---|---|
| Contract | `d84c618775ffa4d9c2e9283b6fe95319cecd708e84742c27ec4b6762925e8787` |
| Deploy tx | `00503906dc2fbaab04afe697d7e1c8074e28106a5f40a8485beb973d9833cd6290` (block 2865271, 2026-10-06 17:57 UTC) |
| Cardano Buy | Preview [`7c3365bb…1386d`](https://preview.cardanoscan.io/transaction/7c3365bb519dfdaca6e12a371b35e0c1b7ffd321bec42130021e22b47c31386d), 50 ADA cover, datum `midnight_commitment` `d9f979b5…6e62b` |
| `registerPolicy` | tx hash `151a5ede0f1a87d784d1b2a541b9bfc3b00895a36db853ccf4df036be544300e` (block 2865275, `SucceedEntirely`) |
| `proveCover(50 ADA)` | tx hash `dee4fe6cdd05eb59dd28e2787f66de2ae6198339d2f33cc4130cedd762247b6c` (block 2865279, `SucceedEntirely`) |
| Ledger after | 1 active policy, 1 cover proof; the record holds only the holder and coverage commitments |

The relay (`preprod/policy-cover-preprod.mjs`) trusts the chain, not the key file: it fetches the Buy tx from Blockfrost, decodes the policy datum with the SDK, takes policy id, coverage and expiry from the datum, and refuses a key that doesn't open the datum's `midnight_commitment`. The circuit re-checks that binding. The holder then proves cover with the secret from the same key file the `/cover` Buy saved, so the issuer never learns it. Success is only reported from finalized tx data.

```bash
PLUTUSSHIELD_REPO=$PWD/../.. PLUTUSSHIELD_SECRETS=<dir outside the repo> \
POLICY_COVER_OUT=<compiled managed/policy-cover> MIDNIGHT_WALLET_FACADE=<wallet helper> \
PRIVATE_STATE_PASSWORD=<local> BLOCKFROST_PREVIEW_ID=<id> PLUTUSSHIELD_POLICY_KEY=<policy key json> \
node policy-cover-preprod.mjs
```

It needs a funded Preprod wallet (tNIGHT plus generated tDUST) and a local proof server on `:6300`. Set `MIDNIGHT_POLICY_COVER_ADDRESS` (or keep the deploy record) to reuse the contract instead of deploying again.

## Status

Compiles, passes local simulation, and runs on Midnight Preprod (deploy, `registerPolicy`, `proveCover`). Registration is operator-run from the box today; next is relaying every Cardano Buy automatically. Not audited. Expiry here is issuer-driven and mirrors the Cardano side, where `Expire` in `contracts/cardano` is time-locked (expiry + claim grace) and callable by anyone.
