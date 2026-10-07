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
| `resolveClaim(id, approved)` | Assessor | `PAID` (Cardano settles the payout once 2 of 3 assessor-committee keys co-sign the exploit `Settle`) or back to `ACTIVE` |
| `expirePolicy(id)` | Issuer | Mirror Cardano expiry |

`proveCover` is the partner hook: a DEX or lending market can offer "insured-only" pools or better terms to users who prove cover, and learns nothing else.

Roles are witness-derived commitments, never `ownPublicKey()`.

## v2: committee-gated claims (`src/policy-cover-v2.compact`)

v1 resolves a claim with one assessor key. v2 is the same registry (same circuits, same holder, coverage, registration and evidence commitments, byte for byte) with `resolveClaim` replaced by an **M-of-3 assessor committee vote**, so no single key on either chain can approve a claim. It matches the Cardano exploit-cover v2 pool, whose `Settle` needs 2 of 3 committee signatures.

| | v1 (`policy-cover.compact`, live on Preprod) | v2 (`policy-cover-v2.compact`) |
|---|---|---|
| Constructor | `(assessorCommitment)` | `(committee: Vector<3, Bytes<32>>, m: Uint<8>)`; refuses `m` outside 1..3, an empty member, or a repeated member |
| Claim decision | `resolveClaim(id, approved)` by the one assessor | `voteClaim(id, approve)` by any committee member; `m` approvals → `PAID`, `m` rejections → `ACTIVE` with evidence cleared |
| Double voting | n/a | one vote per member per claim round (`claimVotes` keyed by `voteKey(id, round, member)`) |
| Re-filed claims | n/a | each `fileClaim` opens a new `round` on the record, so votes on a rejected filing never count toward the next one |
| Audit trail | resolve tx only | every vote is public and attributable to a committee commitment; `approvals` / `rejections` tallies per round, `votesCast`, `claimsRejected` |

A member proves membership by opening one of the three public role commitments (`roleCommitment(sk, assessorTag())`) inside the circuit, the same witness pattern as the issuer and holder roles. A split vote (1 approve, 1 reject under 2-of-3) stays `CLAIM_PENDING` until the third member decides. The full compile (prover and verifier keys for all 6 v2 circuits, including `voteClaim`) succeeds with compactc 0.31.1. `test/policy-cover-v2.test.mjs` covers the logic (10 tests), including that v2's commitment circuits equal v1's and the SDK's on random inputs, so Cardano datums, policy keys and sealed evidence made for v1 are valid against v2 unchanged.

v1 stays deployed for its history; v2 is now the current registry. The batch relay mirrors Preview Buys into v2 (`--all` with `PLUTUSSHIELD_COVER_VERSION=2`), and the site's `/app` panel leads with v2: its counters (mirrored, cover proofs, claims filed, committee votes), the relay status line and every policy's Midnight badge read the v2 registry live, with v1's totals shown underneath and the activity feed merging both contracts, each row tagged `v1` or `v2`. The committee seats are still team-held on Preprod; handing them to independent operators is the next step.

#### Running v2 on Preprod

The Preprod relay runs v2 when `PLUTUSSHIELD_COVER_VERSION=2` and `POLICY_COVER_OUT` points at the compiled `managed/policy-cover-v2` (with `keys/`). Each committee seat gets its own secret file under `$PLUTUSSHIELD_SECRETS/midnight-committee/member-<seat>.json`, so a seat can be handed to a different operator; the constructor receives only the three role commitments and the threshold (`PLUTUSSHIELD_COMMITTEE_M`, default 2). `--resolve` is refused under v2; a seat votes with:

```
--vote <policyId> --member <0|1|2> --approve|--reject [--envelope <file> --evidence-key <file>]
```

Before every vote the seat opens the sealed evidence off-ledger (`assessClaim`), the relay predicts the outcome with `applyVote` (relay/claims.ts, the circuit's tally rules in TypeScript, unit-tested), and after the tx it reads the ledger back and refuses to report success if the status differs. With `--register-first` and no v2 deploy record, one wallet sync covers deploy, registerPolicy, proveCover, fileClaim and the votes. Public results go to `deployments/preprod-v2.json` (the relay refuses to write v2 data into the v1 record). The drill on Preprod is a split vote: seat 0 approves, seat 1 rejects (still `CLAIM_PENDING` under 2-of-3), seat 2 approves (`PAID`).

**Live on Preprod (2026-10-07):** v2 contract `5430b803b6b3df6e6ee1d498bb02e2f2d06cb46661e72af1e6208d864feb8110` (deploy `00532855…aba6d4`, block 2,870,317, 2-of-3). Policy `7c24be86…` (Cardano Preview Buy `94c4dc05…`): registerPolicy `ec1e22e7…` → proveCover `4b0e0fc2…` → fileClaim `96e17dfa…` → seat 0 approve `db60e9d7…` (1·0, pending) → seat 1 reject `b0271165…` (1·1, pending) → seat 2 approve `bd62e689…` (2·1, **PAID**), blocks 2,870,321 to 2,870,341. Full record: `deployments/preprod-v2.json`. Demo evidence, test policy.

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
pnpm compile        # compactc 0.31.1, v1 and v2, prover/verifier keys for each contract's 6 circuits
pnpm test           # --skip-zk compile, then node:test simulation via @midnight-ntwrk/compact-runtime 0.16.0
```

26 v1 tests cover:

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

`test/relay-plan.test.mjs` (4 more) runs the relay plan against real public Preview UTxOs (fixture) with Koios mocked: 8 pre-binding, 1 mirrored and 2 ticketed policies classify correctly, a forged ticket is flagged and ignored, a local key that doesn't open the datum never makes a policy provable, and the plan fails closed when Koios is down.

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

### Batch relay: every Cardano Buy

`registerPolicy` needs the holder and coverage commitments, but the datum only holds their hash. So every Buy (same shared builder: `/cover`, `pnpm web-buy`, `pnpm preview buy`, the emulator) also publishes a **registration ticket** as Cardano tx metadata:

```
label 7731: { "v": 1, "p": policyId, "h": holderCommitment, "c": coverageCommitment }      // 64-hex strings, no secrets
```

Both values are hiding commitments and are public on Midnight as soon as the policy is registered, so the ticket reveals nothing new. It lets the issuer relay register a policy from chain data alone; `proveCover` still needs the holder secret, which stays with the buyer.

`packages/sdk/src/relay.ts` has the ticket codec and `classifyMirror`; `relay/plan.ts` builds the plan from Koios (live policy datums at the cover script, then `tx_metadata` of each Buy), local policy key files, and the contract's state. Each live Preview policy is one of:

| State | Meaning | Relay action |
|---|---|---|
| `mirrored` | policy id is in the contract's `policies` map | none |
| `ready` | a ticket or a local policy key reproduces the datum's `midnight_commitment` | `registerPolicy`, plus `proveCover` if the holder key is local |
| `awaiting-key` | bound policy, but no valid ticket and no key | none; reported |
| `pre-binding` | bought before the binding shipped (Preview, 2026-10-06 17:23 UTC): random placeholder commitment, which `registerPolicy` rejects by design | none; reported |

A ticket that doesn't open the datum is flagged (`badTicket`) and never used.

First batch run (2026-10-06 20:00 UTC): plan = 11 live Preview policies, 1 mirrored, 2 ready, 8 pre-binding. Both ready policies were relayed (holder keys local, so registered and proven), every tx confirmed `SUCCESS` on the Preprod indexer:

| Cardano Buy (Preview) | `registerPolicy` | `proveCover` |
|---|---|---|
| [`1e70f089…0f321f`](https://preview.cardanoscan.io/transaction/1e70f0895de64c50dbbc39df0e8d23af362a29e476d1bdfb1e2068ff780f321f) 20 ADA | `c2aafffc20cf3b2349a92f15247fbc5b95826f9d830a477d137b18b4fe088647` (block 2866500) | `d81ba90c719113c99b7b3596f499d93c10967f750153eb495e43298590d60084` (block 2866504) |
| [`94c4dc05…1325ff`](https://preview.cardanoscan.io/transaction/94c4dc052711c6eec5b2942da768b151b9f1dd9519cf11bcd55982a6bd1325ff) 25 USDC | `0fa8b01e9dbec394e5afffa65b6183d19509b9acabd9a852091a534587611f3b` (block 2866508) | `c6905d13b2ab87a2818a7f482359df6826227ff761ffad3cd7ba250efdb10a26` (block 2866511) |

Ledger after: 3 active policies, 3 cover proofs, so all 3 mirrorable Preview policies are mirrored; a dry run afterwards plans 0 ready.

```bash
pnpm midnight:relay:plan            # dry run: no wallet, no proof server, no txs (Koios + public Preprod indexer); --json for machine output
# live, from the midnight-js workspace (same env as above, plus):
PLUTUSSHIELD_PUBLIC_RECORD=$REPO/contracts/midnight/deployments/preprod.json \
PLUTUSSHIELD_POLICY_KEY_DIRS=<dirs with plutusshield/policy-key@1 files> \
node policy-cover-preprod.mjs --all
```

`--all` syncs the issuer wallet once, plans against the decoded ledger, then relays `ready` policies oldest first, one at a time: it re-checks `policies.member(id)` right before each call (idempotent, safe to re-run), re-verifies the ticket or key against the datum, records only finalized `SucceedEntirely` txs, recomputes the binding from the stored record, writes both records after every policy, and stops at the first failure. `/cover` My policies shows the per-policy state (live "Mirrored on Midnight", otherwise the build-time plan: "Relay pending", "Awaiting holder key", "Pre-binding"), and `/app` shows how many mirrorable Preview policies are mirrored.

### Reading it live

The web app reads the registry straight from the public Preprod indexer (GraphQL v4), with no wallet, keys or WASM: `apps/web/src/lib/midnightIndexer.ts` streams `contractActions` for the contract over the indexer's `graphql-transport-ws` socket from the deploy block (history, then new calls as they land) and fetches the latest serialized state over HTTP.

- `/app` shows live counters (successful `registerPolicy`, `proveCover`, `fileClaim` calls) and a contract activity feed with circuit, tx hash and block.
- `/cover` My policies marks each policy **Mirrored on Midnight** when its 32-byte policy id is a key in the contract's public `policies` map (ids are serialized verbatim in the state).
- `pnpm build` runs `apps/web/scripts/snapshot-midnight.mjs` first, baking the same data into `apps/web/src/data/midnight-preprod-activity.json` so the static site still shows real Midnight state if a browser can't reach the indexer.

## Status

Compiles, passes local simulation, and runs on Midnight Preprod (deploy, `registerPolicy`, `proveCover`). Every Buy carries a registration ticket and the batch relay mirrors every relayable Preview policy; it is operator-run (`--all`) from the box today. Next: run it on a schedule, and `proveCover` from the browser with the key the Buy saved. Not audited. Expiry here is issuer-driven and mirrors the Cardano side, where `Expire` in `contracts/cardano` is time-locked (expiry + claim grace) and callable by anyone.

### Assessor trust: Midnight decision, Cardano committee

On the live v1 registry `resolveClaim` is gated by one assessor role commitment. The money side is stricter: the Cardano exploit-cover pool (v2) pays only on a `Settle` signed by 2 of the 3 assessor-committee keys fixed in its script parameters (`contracts/cardano/validators/exploit_cover.ak`), and each assessor signs only after checking this registry shows the claim PAID. So a single v1 Midnight key can mark a claim PAID, but can't release Cardano capital alone. `policy-cover-v2.compact` (above) closes that gap on the Midnight side with an M-of-3 `voteClaim`; next is deploying it on Preprod and moving the committee keys to independent operators.
