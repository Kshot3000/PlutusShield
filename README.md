# PlutusShield

**DeFi and smart-contract insurance for Cardano and Midnight.**

PlutusShield is protection you can verify on-chain, with privacy where it actually matters. Cardano handles settlement, premiums, and underwriting liquidity. Midnight handles the sensitive parts: policy terms, claims evidence, and underwriter positions, using zero-knowledge proofs and selective disclosure.

**Live site:** [kshot3000.github.io/PlutusShield](https://kshot3000.github.io/PlutusShield/) — static export of `apps/web`, deployed to GitHub Pages on every push to `main`.

> **Status: Preview testnet live.** Cardano Preview pool is initialised at `addr_test1wp89ggl7ls5gwxh02w7ja6zhytqe4a6zu6m6n82s0cxw9tq4j5tgr` (see `contracts/cardano/deploy/deployments/preview.json`). Seeded ADA + tUSDCx capital and first buys are on-chain. This repo also holds the product vision and docs, a Next.js site (`apps/web`), the shared quote engine and Cardano datum codecs (`packages/sdk`), the Cardano validators (`contracts/cardano`, 131 Aiken tests + Lucid emulator e2e), and the Midnight Compact policy registry (`contracts/midnight`). Not audited. Test value only. Buy, claim and release run from a CIP-30 wallet on `/cover`. **Exploit cover payout is live on Preview too, with no single trusted key:** a separate exploit-cover pool (`contracts/cardano/validators/exploit_cover.ak`, v2 record in `contracts/cardano/deploy/deployments/preview-exploit-v2.json`) pays an approved Midnight Preprod claim only through a `Settle` signed by **2 of 3 assessors** on a committee fixed in the script parameters; 1-of-3 is rejected by the validator. The cross-chain trust point is that 2-of-3 assessor committee (three Preview keys run by the team today, not yet independent operators; the offline enrollment kit for outside assessors is in [`contracts/committee`](contracts/committee/README.md) and walked through on [`/assessors`](https://kshot3000.github.io/PlutusShield/assessors/)). The first exploit pool (v1, single assessor, `preview-exploit.json`) is kept as history.

---

## Why PlutusShield

DeFi on Cardano keeps growing. The tools for managing its risk haven't kept up. Today, users who get hit by an exploit, an oracle failure, or a stablecoin depeg mostly absorb the loss themselves. Most existing cover runs fully in public, which leaks the information that sophisticated buyers and underwriters least want exposed: position sizes, protocol exposure, and claim details.

PlutusShield is built on three principles:

1. **Settlement you can audit.** Premiums, pool capital, payouts, and policy state transitions live on Cardano and are enforced by validators, not by an operator's goodwill.
2. **Privacy by default, disclosure by choice.** Policy details, claims evidence, and underwriting books sit on Midnight. Participants prove what they need to prove, and nothing more.
3. **Cover that matches real risk.** Parametric triggers where an objective trigger exists. Evidence-based claims where it doesn't, like smart-contract exploits.

## What we insure

| Cover type | Trigger model | Example |
|---|---|---|
| **Smart-contract exploit / hack cover** | Evidence-based claim, private evidence submission, assessor review with ZK-backed disclosure | A covered DEX validator is drained through a logic bug |
| **Parametric DeFi events** | Multi-oracle objective trigger, automatic payout | A stablecoin trades below a defined peg threshold for a defined window; an oracle feed goes stale or deviates past bounds |
| **Protocol SLA cover** | Measurable service-level breach | A covered protocol's critical service (batcher, oracle, bridge) is unavailable beyond the agreed window |

See [docs/PRODUCT.md](docs/PRODUCT.md) for the full cover design.

## The dual-chain design

```
            ┌──────────────────────────┐         ┌──────────────────────────┐
            │         CARDANO          │         │         MIDNIGHT         │
            │  settlement + liquidity  │◄───────►│  privacy + ZK disclosure │
            ├──────────────────────────┤         ├──────────────────────────┤
            │ • Premium payments (ADA, │         │ • Private policy terms   │
            │   stablecoins)           │         │ • Claims evidence vault  │
            │ • Underwriting pool      │         │ • Private underwriter    │
            │ • Policy NFTs / state    │         │   positions              │
            │ • Payout execution       │         │ • Selective-disclosure   │
            │ • Aiken/Plutus V3        │         │   proofs (Compact)       │
            └──────────────────────────┘         └──────────────────────────┘
```

- **Cardano (Aiken / Plutus V3)** holds the money. Pool deposits, premium collection, policy minting, and payouts are all enforced by validators.
- **Midnight (Compact)** holds the secrets. A policyholder can prove "I hold an active policy covering protocol X with limit ≥ my claim" without publishing their wallet, position, or limit. An underwriter can prove solvency or concentration limits without exposing their whole book.

Full detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## How we compete

The closest on-chain comparison is **[Aegis](https://aegis.fluxpointstudios.com)** by Flux Point Studios, a parametric, multi-oracle insurance protocol on Cardano built on Plutus V3 ([contracts](https://github.com/Flux-Point-Studios/aegis-contracts)). Aegis is a serious project, and parametric cover is a good primitive. PlutusShield differs in four ways:

- **Exploit cover, not just parametric.** Smart-contract hacks rarely produce a clean oracle signal. We pair parametric products with an evidence-based exploit claims flow.
- **Midnight-native privacy.** Policies, claims evidence, and underwriting positions are private by default, and disclosure is cryptographically selective.
- **Underwriter-grade risk tooling.** Per-protocol exposure caps, risk tiers informed by audits, and transparent pool accounting, without exposing individual LP books.
- **Product polish.** A website and app that explain cover in plain language, quote fast, and show claim status clearly.

Full comparison: [docs/COMPETITIVE.md](docs/COMPETITIVE.md).

## Repository layout

```
PlutusShield/
├── README.md               # You are here
├── LICENSE                 # MIT (root); Midnight under contracts/midnight/LICENSE (Apache-2.0)
├── package.json            # pnpm workspace root
├── pnpm-workspace.yaml
├── docs/
│   ├── ARCHITECTURE.md     # System design, privacy boundaries, MVP scope
│   ├── PRODUCT.md          # Cover types, stakeholders, UX pillars
│   └── COMPETITIVE.md      # Landscape: builders and products
├── apps/
│   └── web/                # Marketing site + dApp shell (Next.js / TypeScript)
├── contracts/
│   ├── cardano/            # Aiken: multi-asset (ADA + USDC) pool, policy NFTs, oracle-quorum payout
│   │   └── deploy/         # Preview runbook: keys, param application, tx builders, emulator
│   ├── committee/          # Offline assessor-operator kit: keygen, signed enrollment, 2-of-3 committee plan
│   └── midnight/           # Compact: private cover registry, holder proofs, claims
├── packages/
│   └── sdk/                # Products, quote engine, Cardano datum/redeemer codecs, evidence vault
│
└── services/
    ├── oracle-relay/       # Oracle aggregation + trigger evaluation
    └── api/                # Planned: quotes, policy lifecycle, indexer
```

## Quick start

### Web (marketing site + app shell)

```bash
git clone https://github.com/Kshot3000/PlutusShield.git
cd PlutusShield
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

From `apps/web` only:

```bash
cd apps/web
pnpm install   # or: npm install
pnpm dev       # or: npm run dev
```

See [apps/web/README.md](apps/web/README.md) for routes and design notes.

### Deploy (GitHub Pages)

The site is a fully static export (`output: "export"`), so it runs without a Node server.
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) builds `apps/web` with
`NEXT_PUBLIC_BASE_PATH=/PlutusShield` and publishes `apps/web/out` with the official
`actions/deploy-pages` action on every push to `main` (or via **Run workflow**).

Public URL: **https://kshot3000.github.io/PlutusShield/**

```bash
pnpm build:pages   # static export with the /PlutusShield base path → apps/web/out
pnpm preview       # serve apps/web/out locally
```

One-time setup: repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.

### Tests

```bash
pnpm test            # SDK + Aiken validators + Midnight contract simulation
pnpm test:sdk        # quote engine, Cardano codecs, evidence vault (Node 22+)
pnpm test:cardano    # aiken check (Aiken v1.1.24)
pnpm test:deploy     # end-to-end Lucid Emulator run of the applied validator
pnpm test:midnight   # Compact compile + simulation
```

### Midnight contract

Requires the Compact toolchain (`compact` CLI with compiler 0.31.1).

```bash
cd contracts/midnight
pnpm compile         # full compile incl. prover/verifier keys
pnpm test            # fast compile + off-chain circuit tests
```

See [contracts/midnight/README.md](contracts/midnight/README.md).

### Cardano contracts

Requires [Aiken v1.1.24](https://github.com/aiken-lang/aiken/releases/tag/v1.1.24) (pinned in `aiken.toml`).

```bash
cd contracts/cardano
aiken check          # 131 unit tests: ADA/USDC tranches, pool, buy, sale circuit-breaker, settle, expire refund, oracle auth, pricing, exploit cover
aiken build          # regenerates plutus.json (CIP-57 blueprint)
```

See [contracts/cardano/README.md](contracts/cardano/README.md) for validators, datum/redeemer shapes, and trust assumptions, and [contracts/cardano/deploy/README.md](contracts/cardano/deploy/README.md) for the Cardano Preview deploy runbook.

## Midnight Buildathon

**Submission kit:** pitch deck ([PDF](docs/buildathon/PlutusShield-Wave2-deck.pdf)), 3-minute [demo video script](docs/buildathon/VIDEO_SCRIPT.md), [Wave 2 progress note](docs/buildathon/WAVE2_PROGRESS.md) (for the AKINDO progress field), the [kit checklist](docs/buildathon/README.md), and the live **[guided demo](https://kshot3000.github.io/PlutusShield/demo/)** (the script as a click-through page with every transaction linked). Judge click-throughs beyond the five demo beats: **[/products](https://kshot3000.github.io/PlutusShield/products/)** (cover products catalog), **[/book](https://kshot3000.github.io/PlutusShield/book/)** (open underwriting book), **[/claims](https://kshot3000.github.io/PlutusShield/claims/)** (claims register), **[/status](https://kshot3000.github.io/PlutusShield/status/)**. How outside assessors take the committee seats on both chains: **[/assessors](https://kshot3000.github.io/PlutusShield/assessors/)**.

PlutusShield is entered in the Midnight Foundation Buildathon (Wave 2). The Midnight half is two Compact contracts, both compiled with **compactc 0.31.1** (`compact` CLI 0.5.2, `pragma language_version >= 0.23`) and deployed on **Midnight Preprod**:

| Contract | Source | Preprod address | What it does |
|---|---|---|---|
| policy-cover v1 | [`contracts/midnight/src/policy-cover.compact`](contracts/midnight/src/policy-cover.compact) | `d84c618775ffa4d9c2e9283b6fe95319cecd708e84742c27ec4b6762925e8787` | Private policy registry: `registerPolicy`, `proveCover`, `rotateHolder`, `fileClaim`, single-assessor `resolveClaim`, `expirePolicy` |
| policy-cover v2 | [`contracts/midnight/src/policy-cover-v2.compact`](contracts/midnight/src/policy-cover-v2.compact) | `5430b803b6b3df6e6ee1d498bb02e2f2d06cb46661e72af1e6208d864feb8110` | Same registry, but claims are decided by a **2-of-3 assessor committee** (`voteClaim`, per-round tallies), matching the 2-of-3 `Settle` on Cardano |

Public deploy and transaction records: [`contracts/midnight/deployments/preprod.json`](contracts/midnight/deployments/preprod.json) and [`preprod-v2.json`](contracts/midnight/deployments/preprod-v2.json). Live site: **[kshot3000.github.io/PlutusShield](https://kshot3000.github.io/PlutusShield/)**. Testnet only, not audited.

### Run it

```bash
pnpm install
pnpm test:midnight                  # compiles both contracts (--skip-zk) + circuit tests
cd contracts/midnight && pnpm compile   # full compile with prover/verifier keys (compactc 0.31.1)
cd ../.. && pnpm --filter @plutusshield/web dev   # site on http://localhost:3000
pnpm midnight:relay:plan:v2         # dry run: which Cardano Preview policies are mirrored in v2
```

Requires Node 22+, pnpm 9, and the Compact toolchain (`compact update 0.31.1`). The dry-run relay reads the Midnight Preprod indexer; since 9 Oct 2026 that indexer is served by Blockfrost and needs a Midnight Preprod project id: set `BLOCKFROST_MIDNIGHT_PREPROD_ID` (see [contracts/midnight/README.md](contracts/midnight/README.md)). Until then the site shows its build-time snapshot of the Midnight ledger.

### Demo walkthrough

1. **Buy cover on Cardano.** On [`/cover`](https://kshot3000.github.io/PlutusShield/cover/) connect a CIP-30 wallet on Preview and buy depeg cover. The Buy tx locks a policy datum holding only a hash commitment of the holder secret and terms.
2. **Mirror it privately on Midnight.** The relay calls `registerPolicy` on Preprod with that commitment, then the holder runs `proveCover(policyId, minCoverage)`: a ZK proof that they hold an active policy with at least that coverage, without revealing who they are or the exact limit.
3. **File a sealed claim.** `fileClaim` records only an evidence commitment; the evidence itself stays encrypted off-chain (see [`/claim/evidence`](https://kshot3000.github.io/PlutusShield/claim/evidence/)).
4. **Committee decides on Midnight.** Each of three assessor seats calls `voteClaim`; the claim flips to PAID at 2 approvals (first drill: approve, reject, approve -> PAID).
5. **Cardano pays.** The exploit-cover pool pays only via a `Settle` co-signed by 2 of 3 committee keys and referencing the Midnight decision; a 1-of-3 `Settle` cannot be built. See the [`/app`](https://kshot3000.github.io/PlutusShield/app/) dashboard for the live v2 committee counters and activity.
6. **Parametric side.** The depeg oracle publishes a 24h TWAP of USDM from three venues to three Preview feeds; cover sales close automatically if the feeds go stale or the peg breaks.

## Roadmap (high level)

- [x] Vision, architecture, and product docs
- [x] Aiken validators: underwriting pool, policy mint, payout (`contracts/cardano`)
- [x] Parametric trigger: multi-oracle stablecoin depeg (on-chain quorum check)
- [x] Multi-asset pools: ADA + USDC (USDCx) tranches, premiums and payouts per policy currency
- [x] Preview deploy tooling + runbook, full flow verified in the Lucid Emulator
- [x] Testnet deployment (Preview): fund deployer, init pool, first buy (see runbook)
- [x] Real oracle feed integration: live multi-venue USDM oracle (CoinGecko + Minswap ADA/USDM and USDCx/USDM pools read on-chain, `services/oracle-relay/src/venues.ts`) publishing a 24h TWAP to the three Preview feeds on a loop, which keeps cover sales open while the peg is healthy; the live feeds, the sale circuit-breaker and every published reading with its transaction are on [`/oracle`](https://kshot3000.github.io/PlutusShield/oracle/) (independent feed operators are still to come)
- [x] Sale circuit-breaker: no buys into an active depeg (every allowlisted feed must report a fresh healthy peg, plus a waiting period)
- [x] Expiry returns the policy deposit to the buyer, not the submitter
- [x] Compact contract: private policy commitment + coverage proof (`contracts/midnight`)
- [x] Quote engine with risk tiers and utilization-kinked pricing (`packages/sdk`)
- [x] Open underwriting scorecard for pool risk tiers: exploit and depeg rubrics with points, hard stops that decline cover (no audit, unresolved loss, algorithmic stablecoin, fewer than three oracle venues) and caps (single admin key, single price source, too new), mapped to the `risk_mult_bps` a pool fixes at InitPool; interactive on [`/docs/risk-tiers`](https://kshot3000.github.io/PlutusShield/docs/risk-tiers/) (`packages/sdk/src/riskTier.ts`, 10 tests). Criteria are testnet model assumptions, not ratings of named protocols
- [x] Midnight holder registration wired into Buy: per-policy key made in the browser, its commitment in the Cardano datum, `registerPolicy` bound to it, key backup / export / restore in My policies (`packages/sdk/src/midnight.ts`)
- [x] Cardano → Midnight batch relay: every Buy publishes a public registration ticket (tx metadata 7731); `policy-cover-preprod.mjs --all` mirrors every live Preview policy whose ticket or holder key opens its datum, idempotently; `pnpm midnight:relay:plan` dry run; per-policy mirror state on `/cover` and `/app` (`packages/sdk/src/relay.ts`, `contracts/midnight/relay`)
- [x] Private evidence vault for exploit claims: canonical bundle, in-browser AES-256-GCM, evidence commitment matching the Midnight contract, assessor verification (`/claim/evidence`, `packages/sdk/src/evidence.ts`)
- [x] Exploit claims flow end to end: `fileClaim` on the Midnight Preprod registry, assessor resolution, approved payout from the Cardano Preview exploit-cover pool
- [x] Multi-assessor payouts: exploit `Settle` needs M-of-N distinct assessor-committee signatures (2-of-3 live on Preview, v2 pool; first committee payout `c35535dd…` paid 50 tADA on assessor-1 + assessor-3, a 1-of-3 Settle rejected by both the local and the Preview evaluator); malformed committees refused at InitPool
- [x] Committee-gated claim decisions on Midnight: `policy-cover-v2.compact` replaces the single-assessor `resolveClaim` with an M-of-3 `voteClaim` (one vote per member per claim round, public attributable votes, re-filed claims start a fresh round); 10 simulation tests, v1 commitments unchanged
- [x] v2 Midnight registry deployed on Preprod (`5430b803…`, `contracts/midnight/deployments/preprod-v2.json`): batch relay mirrors Preview policies into it, first committee claim decided by 2-of-3 `voteClaim`
- [x] First holder-filed claim, end to end: exploit policy `496dced8…` (25 tADA, bought on the v2 Preview pool) was claimed from a passphrase-encrypted holder claim kit (`pnpm midnight:claim-kit` / `/claim/evidence` → `policy-cover-preprod.mjs --claim … --kit …`; the operator relay never held the policy key), `fileClaim` `00989a6a…` on Midnight Preprod, seats 0 + 2 verified the sealed bundle off-ledger and voted PAID (`cefd3f5a…`, `beb6d9f5…`), and the Cardano Settle `dbf0ba7a…` paid 25 tADA on assessor-1 + assessor-3 signatures after the Settle gate (`approvedPayout`) checked the v2 committee decision in the public record
- [x] Browser Buy for exploit cover: `/cover#buy-exploit` buys smart-contract exploit cover on the v2 committee pool from a CIP-30 wallet with the same `buildBuy` as depeg cover (no oracle feeds; the waiting period guards the sale), makes the policy's Midnight key in the browser and saves it for `/claim/evidence`. The applied exploit v2 script ships in `apps/web/src/data/preview-exploit-v2-deployment.json` (`pnpm web-artifacts`, checked against the recorded script hash). Proven on Preview with the same artifact and builder: `pnpm web-buy exploit ada 10 30` landed Buy `3c1fc629…` (policy `9bdef8cb…`, 10 tADA cover, 5 tADA premium), and the saved key opens the on-chain `midnight_commitment`
- [x] My policies across both Preview pools: `/cover#my-policies` and the `/app` Active policies card read the connected wallet's policies live from the USDM depeg pool **and** the exploit-cover v2 pool (`useExploitCoverChain`, build-time fallback `apps/web/src/data/preview-exploit-v2-pool-snapshot.json`), labelled Depeg vs Exploit (v2 committee). Each row gets its own claim path: depeg rows keep the oracle `Settle`; exploit rows never offer an oracle claim and instead link to `/claim/evidence/?policy=<id>` (policy id prefilled) to seal evidence and file on Midnight (File with Lace, or the holder claim kit while the first finalized bridge-drill tx is still pending), decided by 2 of 3 assessors and paid by their Cardano `Settle`. Unclaimed exploit policies get the same third-party Release after the claim grace, since `exploit_cover.ak` keeps the `Expire` branch; the emulator e2e now covers it (step 10: exploit policy listed only from the exploit script, Expire refused in grace, released after it, deposit back to the buyer). `/policy` also finds browser-bought exploit policies from the live exploit-pool read
- [ ] Independent assessor operators (today all three Preview committee keys and all three Midnight committee seats are team-run). Shipped toward it: the offline enrollment kit ([`contracts/committee`](contracts/committee/README.md): `pnpm committee keygen` → signed public `enrollment.json` → `verify` → a dry-run `plan` with the exact Cardano `Committee` CBOR and Midnight v2 constructor args, compared by `planSha256`) and the [`/assessors`](https://kshot3000.github.io/PlutusShield/assessors/) page (why 2-of-3, assessor duties, enrollment how-to, today's seats, first committee drills). Still to do: three outside operators enroll, a new exploit-cover pool and policy-cover v2 contract with their seats, a drill claim voted and co-signed from their own machines
- [x] Marketing site + app shell (`apps/web`)
- [x] Web app: interactive quote on `/cover`
- [x] Web app: claim checker on `/claim` (oracle quorum, TWAP trigger, claim window, sale circuit-breaker)
- [x] Public claims register on [`/claims`](https://kshot3000.github.io/PlutusShield/claims/): every decided claim across both chains (approved, denied, a split 2-of-3 vote, and the refused 1-of-3 Settle), with each Cardano Buy/Settle and Midnight `fileClaim` / `resolveClaim` / `voteClaim` linked to its transaction, plus why no depeg claim has paid (lowest live TWAP vs the 95% trigger). Built from the public deployment records on every site build (`apps/web/src/lib/claimsRegister.ts`)
- [x] Public underwriting book on [`/book`](https://kshot3000.github.io/PlutusShield/book/): every live Preview pool (USDM depeg + exploit-cover v2 committee, plus the frozen v1 exploit pool as legacy) with the open scorecard answers that produce tier B, capital/utilization from pool snapshots, InitPool `risk_mult_bps` 10_000, and explorer links — baked from public deployment records (`packages/sdk/src/underwritingBook.ts` + `apps/web/src/lib/underwritingBook.ts`)
- [x] Public cover products catalog on [`/products`](https://kshot3000.github.io/PlutusShield/products/): depeg and exploit cover live on Preview (ADA or USDC premiums, no NIGHT premiums), SLA cover priced but not buyable until an uptime oracle exists; status, currencies, claim model, sale guard and buy/quote links come from the SDK `PRODUCTS` records, deployed parameters and capital from the public deployment records (`packages/sdk/src/products.ts` + `apps/web/src/lib/productsCatalog.ts`)
- [x] Portfolio cover planner on [`/plan`](https://kshot3000.github.io/PlutusShield/plan/): list several stablecoin and protocol exposures and get the depeg and exploit policies that would protect them, priced with the same `quote()` against the live Preview ADA or tUSDCx tranches. One policy never takes more than 10% of a tranche, so big exposures split into several policies, each priced on the utilization the earlier ones leave; nothing is planned past 90% utilization and the remainder is shown as uncovered; SLA cover is never planned as a buy. The URL stays in sync (`encodePlanShare` / `decodePlanShare`: `c`, `d`, repeated `x`) so a concrete portfolio is deep-linkable, with a static example at [`/api/v1/plan.json`](https://kshot3000.github.io/PlutusShield/api/v1/plan.json) (`packages/sdk/src/coverPlan.ts`, 12 tests, + `apps/web/src/lib/coverPlanner.ts`)
- [x] Open data API on [`/docs/api`](https://kshot3000.github.io/PlutusShield/docs/api/): the products catalog, claims register, underwriting book, oracle publishes and a sample cover plan as read-only JSON at [`/api/v1/*.json`](https://kshot3000.github.io/PlutusShield/api/v1/index.json) (no key, CORS open), each in a versioned `plutusshield.open-data/v1` envelope with the networks and testnet / not-audited flags, built from the same records the pages render on every deploy; `fetchOpenData` in the SDK checks the envelope before returning data, and the post-build check refuses a missing or mismatched feed (`packages/sdk/src/openData.ts`, 6 tests, + `apps/web/src/lib/openData.ts`)
- [x] Atom activity feed at [`/feed.xml`](https://kshot3000.github.io/PlutusShield/feed.xml): one entry per decided claim and refused Settle plus the newest 24 live oracle publishes, each linked to its policy or the oracle page and to its Cardano Preview / Midnight Preprod transaction, with stable `tag:` ids so readers never duplicate an entry after a rebuild; advertised in every page head, documented on [`/docs/api#feed`](https://kshot3000.github.io/PlutusShield/docs/api/#feed), and checked by the post-build guard (`packages/sdk/src/atom.ts`, 7 tests, + `apps/web/src/lib/activityFeed.ts`)
- [x] Web app: buy → manage → claim: Buy on `/cover`, My policies (claim / release actions, Midnight key backup), and a per-policy lifecycle tracker on `/policy` that stitches the Cardano Buy, the 7731 ticket, Midnight `registerPolicy` / `proveCover`, `fileClaim` and committee votes, and the Cardano Settle or release into one timeline (exploit `fileClaim`: File with Lace on `/claim/evidence` proves via the holder prove bridge and Lace balances + submits; when the bridge is not running, production filing is the holder claim kit + `policy-cover-preprod.mjs --claim … --kit …` or the operator relay, so the holder key never leaves the holder; see [Holder claim kit](contracts/midnight/README.md#holder-claim-kit))
- [x] Lace Midnight DApp Connector in the web app: discover `window.midnight` providers (never hardcode `mnLace`), connect on Preprod, show unshielded address + Lace `serviceUriConfig` (proof server / indexer / node) on `/claim/evidence`, `/app`, and the in-app header (`packages/sdk/src/lace.ts`, `@midnight-ntwrk/dapp-connector-api@4.0.1`)
- [x] Browser Lace circuit-submit path for `proveCover` / `fileClaim`: proving strategy (delegated `getProvingProvider` or Lace HTTP `proverServerUri` fallback), prover health probe, Fetch ZK asset probe (verifier + zkir for `fileClaim`/`proveCover` under `public/zk/policy-cover-v2`, Pages-safe; prover keys local/dev only), `hintUsage` for balance/submit, call prep from policy key + evidence, and `balanceUnsealedTransaction` + `submitTransaction` orchestration (`packages/sdk/src/laceCircuits.ts` + `fetchZkConfig.ts` + File with Lace on `/claim/evidence`). The Compact prover behind it is the holder prove bridge (next item)
- [x] Holder prove bridge — the `BrowserCircuitProver` for File with Lace: `pnpm midnight:prove-bridge` runs `contracts/midnight/preprod/prove-bridge.mjs` on 127.0.0.1:6310 (loopback, origin allowlist, no wallet, no seed, never submits). It builds `fileClaim` / `proveCover` with midnight-js `createUnprovenCallTx` against the live Preprod v2 registry, using the holder private state as witnesses, proves on the local proof server and returns the unsealed tx for Lace's `balanceUnsealedTransaction` + `submitTransaction`; `/claim/evidence` probes it and uses it automatically (`packages/sdk/src/proveBridge.ts`). Verified locally against Preprod v2 with a real holder key: `proveCover` 5,132-byte and `fileClaim` 5,303-byte proven txs in about 1 s each (not submitted), and the circuit's own asserts reject a wrong holder secret or an over-claimed coverage. Wire path checked over HTTP from a browser origin: CORS preflight answers 204 with the private-network header, a foreign origin gets 403, `proveCover` for the live policy `72512fac…` proves in about 1 s (5,132 bytes) with real wallet shielded keys, and an over-claimed minimum comes back 422 from the circuit. `pnpm midnight:bridge-drill --key <policy-key.json>` (`contracts/midnight/preprod/bridge-submit-drill.mjs`) runs the whole File with Lace path with a headless Preprod wallet in Lace's seat: bridge prove over HTTP, `balanceUnboundTransaction` + `finalizeRecipe` (what Lace's `balanceUnsealedTransaction` does), submit, and success only on a finalized `SucceedEntirely` tx, written to `contracts/midnight/deployments/preprod-v2-bridge-drill.json`. Drill progress (Oct 13 UTC): (1) first run — bridge preflight proved `proveCover` for `72512fac…` over HTTP (5,132 bytes, about 1 s), then stopped at `tDUST still 0` while dust sync caught up; (2) next run — dust-balance bypass cleared with tNIGHT 10 000 / tDUST 50 000, bridge re-proved `proveCover` (5,132 bytes), then `Wallet.Proving: Failed to prove transaction` during WalletFacade `balanceUnboundTransaction` + `finalizeRecipe` (Lace stand-in). Proof server `:6300` stayed healthy and took no `/prove` for the fee tx — failure is client-side while proving the DUST fee balancing tx (Compact call proofs are already present; finalize only proves the fee). The drill now steps `balanceUnboundTransaction` + `finalizeRecipe` itself (dumping the full redacted cause chain, with a dust-only retry); (3) third run — that fixed it: the wallet balanced and bound the bridge-proven `proveCover` (5,132 → 8,389 bytes, about 7 s, DUST fee proved on the local proof server `:6300`), then `submitTransaction` did not confirm — the Preprod indexer had no tx for the call identifier `00b0ff5b…` 20 minutes later, while the wallet's pending-tx service kept retrying on indexer `ServerError`s, so it is not counted. The drill now bounds submit (10 minutes by default, `PLUTUSSHIELD_DRILL_SUBMIT_MS`) and logs the balanced tx ids for an indexer check; (4) fourth run (13 Oct 13:57 UTC) — balanced and bound again (8,388 bytes), but the submit went to the retired Midnight-hosted Preprod RPC, which still answers on an old node build (1.0.400; Blockfrost's Preprod node is 2.1.0), because the endpoints resolve when the wallet facade loads and silently fall back to the retired host when the Blockfrost project id is missing; the indexer has no tx for `0098c6bf…` / `0005d5f2…`, so it is not counted. The drill now refuses the retired host before it syncs, and submits with a watched node submit (`contracts/midnight/preprod/node-watch-submit.mjs`, the same `midnight.sendMnTransaction` extrinsic the wallet sends) that logs every pool status (Ready, Future, Broadcast, InBlock, Invalid, Dropped) and the node's own rejection reason into the stall record; checked against the live Blockfrost node with a replayed Preprod tx, which is refused in about a second with `1010: Invalid Transaction: Custom error: 182`. `PLUTUSSHIELD_DRILL_SUBMIT_MODE=wallet` keeps the facade's `submitTransaction`. Next: find why submit stalls, the first finalized drill tx, then the same submit from Lace itself; the claim kit stays the proven filer until then. The [guided demo](https://kshot3000.github.io/PlutusShield/demo/), video script and deck say the same
- [ ] External audits of Cardano and Midnight contracts before any mainnet capital. Shipped toward it: a pre-audit pack ([`SECURITY.md`](SECURITY.md) and the [`/docs/security`](https://kshot3000.github.io/PlutusShield/docs/security/) page) with the in-scope components, every Cardano and Midnight invariant mapped to the tests that check it, privileged roles and who holds them today, known gaps, and private vulnerability reporting through GitHub security advisories

## Disclaimer

PlutusShield is pre-release software under active design. Nothing here is an offer of insurance, a financial product, or investment advice. Cover availability may be subject to regulatory requirements depending on jurisdiction.

## License

Dual-licensed for Midnight Buildathon compliance:

| Scope | License | Where |
|---|---|---|
| **Midnight-related code** (Compact contracts, Preprod deploy records, relay / claim-kit tooling, simulation tests) | [Apache-2.0](contracts/midnight/LICENSE) | [`contracts/midnight/`](contracts/midnight/) — see [NOTICE](contracts/midnight/NOTICE) |
| **Everything else** (Cardano validators, SDK, web app, docs, services) | [MIT](LICENSE) | Repository root |

© 2026 Kshot ([@kshot9000](https://x.com/kshot9000))

The Midnight Foundation Buildathon requires Apache-2.0 for Midnight-related code newly developed or materially extended for the program. Cardano settlement, the marketing site, and shared tooling stay MIT.
