# Assessor-operator kit (`contracts/committee`)

Offline tooling for an **independent assessor** to join the PlutusShield claims
committee on both chains. Live walkthrough on the site:
[kshot3000.github.io/PlutusShield/assessors](https://kshot3000.github.io/PlutusShield/assessors/).

PlutusShield exploit claims are decided by a **2-of-3 committee**, not by one
trusted key:

| Chain | What a seat is | Where the threshold is enforced |
| --- | --- | --- |
| Cardano Preview | an ed25519 payment key; its 28-byte key hash sits in the `Committee` parameter of `validators/exploit_cover.ak` | `Settle` pays only with signatures from 2 distinct committee keys (1-of-3 is rejected by the validator) |
| Midnight Preprod | a 32-byte seat secret; the `policy-cover-v2` constructor stores only its role commitment | `voteClaim` proves knowledge of the seat secret in zero knowledge; a claim flips to PAID at 2 approvals |

**Honest status (Oct 2026):** all three Cardano Preview committee keys and all
three Midnight Preprod seats are run by the PlutusShield team. Independent
operators are the next step before mainnet; this kit is how they enroll.

The kit is offline: no network, no wallet, no chain transaction. It has no npm
dependencies (Node built-ins plus `packages/sdk` source), so a plain checkout
is enough. Not audited; Preview / Preprod test value only.

## Requirements

- Node 22.6+ (uses `--experimental-strip-types`)
- A checkout of this repo. `pnpm` is optional: every `pnpm committee …` below can
  also be run as `node --experimental-strip-types --no-warnings contracts/committee/cli.ts …`

## Enroll in five commands

```sh
git clone https://github.com/Kshot3000/PlutusShield && cd PlutusShield

# 1. Fresh identity on YOUR machine (directory 0700, secret files 0600)
pnpm committee keygen --out ~/plutusshield-assessor --handle @you --affiliation ExampleDEX

# 2. Self-check: the record verifies and your local secrets open it
pnpm committee verify ~/plutusshield-assessor/enrollment.json --secrets ~/plutusshield-assessor

# 3. Share ONLY ~/plutusshield-assessor/enrollment.json (it is public)

# 4. Once the team assigns your seat (0, 1 or 2)
pnpm committee seat --dir ~/plutusshield-assessor --seat 1

# 5. With all three records, everyone builds the same dry-run plan and compares planSha256
pnpm committee plan a.json b.json c.json --threshold 2 --out plan.json
```

`--affiliation` is repeatable: list every protocol you work for or hold a
material position in, so conflicts are visible (the plan warns when two seats
share one, because both must recuse on claims touching it). Handles are
contact-free (`@name`, letters, digits, `_ . -`); emails, URLs and phone numbers
are refused.

## What `keygen` writes

| File | Kind | Purpose |
| --- | --- | --- |
| `cardano-assessor.sk` | **secret** | Cardano Preview signing key, bech32 `ed25519_sk1…` (the format `contracts/cardano/deploy` loads) |
| `cardano-assessor.skey` | **secret** | same key as a `cardano-cli` TextEnvelope |
| `midnight-seat.json` | **secret** | Midnight Preprod seat secret in the relay's `plutusshield/midnight-committee-seat@1` format |
| `cardano-assessor.vkey` | public | verification key (TextEnvelope) |
| `enrollment.json` | public | the record you share |
| `.gitignore` | public | ignores everything except the two public files |

`keygen` refuses to overwrite an existing identity. Back up the secret files
offline. Nobody from PlutusShield will ever ask for them.

## The enrollment record

`plutusshield/assessor-enrollment@1` carries your handle and affiliations, the
Cardano vkey, key hash (blake2b-224 of the vkey) and Preview enterprise
address, the Midnight seat commitment

```
roleCommitment(sk, assessorTag()) = SHA-256(pad32("plutusshield:role:") || pad32("assessor") || sk)
```

a fixed statement (you control both secrets, you check sealed evidence yourself
before voting or signing, you recuse on conflicts), and an ed25519 signature by
the Cardano key over the canonical payload (domain
`plutusshield:assessor-enrollment:v1`). `verify` re-derives the key hash and
address, checks the signature and the encodings, and with `--secrets` checks
your local files open the record. Possession of the Midnight seat secret can't
be shown by a signature (it is a hash preimage, not a signing key); it is shown
by a `voteClaim` on a drill claim after the redeploy.

## The committee plan (dry run)

`plan` takes exactly three verified records and prints the exact
`Committee { assessors, threshold }` parameter (and its CBOR) for
`exploit_cover`, the `policy-cover-v2` constructor arguments
(`committee: Vector<3, Bytes<32>>`, `m`), a diff against the current team-run
committee (read from `contracts/cardano/deploy/deployments/preview-exploit-v2.json`
and `contracts/midnight/deployments/preprod-v2.json`; `--no-current` skips it),
warnings (shared handles, shared affiliations, thresholds of 1 or 3, keys
already on the current committee) and a `planSha256` over what a redeploy
actually fixes, so operators on any commit agree on it.

The committee is a script parameter on Cardano and a constructor argument on
Midnight, so seating new operators means a **new exploit-cover pool and a new
policy-cover-v2 contract**; the current ones stay readable as history. The
redeploy itself is not automated by this kit:

1. Each operator runs `keygen` and shares only `enrollment.json`.
2. The team runs `verify` on each record, confirms each handle out of band, then `plan`.
3. All three operators re-run `plan` on the same records and compare `planSha256`.
4. Each operator runs `seat` so their local file matches the relay's `member-<n>.json`.
5. Redeploy: exploit-cover `InitPool` with `cardano.committee` on Preview, `policy-cover-v2` with `midnight.constructorArgs` on Preprod; record both under `contracts/*/deployments`.
6. Drill: one test claim, each seat votes from its own machine on Midnight, two seats co-sign the Cardano `Settle`. Only then is the team-run committee retired.

## On a live claim

1. The claimant seals evidence at [`/claim/evidence`](https://kshot3000.github.io/PlutusShield/claim/evidence/) and files only its commitment with `fileClaim` on Midnight. The encrypted bundle and key file reach the committee privately.
2. Each assessor opens the bundle and checks it against the commitment on the ledger (the verifier on `/claim/evidence`, or the relay's `assessClaim`).
3. Each assessor casts their own vote: `relay --vote <policyId> --member <seat> --approve|--reject` (see `contracts/midnight/preprod/policy-cover-preprod.mjs`, `PLUTUSSHIELD_COVER_VERSION=2`, seat file at `$PLUTUSSHIELD_SECRETS/midnight-committee/member-<seat>.json`).
4. Once the Midnight claim is PAID, two assessors co-sign the Cardano `Settle`; its metadata (label 7732) names the Midnight decision tx.

## Tests

```sh
pnpm --filter @plutusshield/committee test
```

Keygen file modes and overwrite refusal, record verification and tamper
detection, local secret checks, and the plan (2-of-3 params for both chains,
a deterministic `planSha256`, and rejection of two records, duplicate keys,
threshold 4 or a forged record). Every key is generated into a temp dir and
deleted.
