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
├── LICENSE                 # MIT
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

**Submission kit:** pitch deck ([PDF](docs/buildathon/PlutusShield-Wave2-deck.pdf)), 3-minute [demo video script](docs/buildathon/VIDEO_SCRIPT.md), the [kit checklist](docs/buildathon/README.md), and the live **[guided demo](https://kshot3000.github.io/PlutusShield/demo/)** (the script as a click-through page with every transaction linked). How outside assessors take the committee seats on both chains: **[/assessors](https://kshot3000.github.io/PlutusShield/assessors/)**.

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
- [x] Real oracle feed integration: live multi-venue USDM oracle (CoinGecko + Minswap ADA/USDM and USDCx/USDM pools read on-chain, `services/oracle-relay/src/venues.ts`) publishing a 24h TWAP to the three Preview feeds on a loop, which keeps cover sales open while the peg is healthy (independent feed operators are still to come)
- [x] Sale circuit-breaker: no buys into an active depeg (every allowlisted feed must report a fresh healthy peg, plus a waiting period)
- [x] Expiry returns the policy deposit to the buyer, not the submitter
- [x] Compact contract: private policy commitment + coverage proof (`contracts/midnight`)
- [x] Quote engine with risk tiers and utilization-kinked pricing (`packages/sdk`)
- [x] Midnight holder registration wired into Buy: per-policy key made in the browser, its commitment in the Cardano datum, `registerPolicy` bound to it, key backup / export / restore in My policies (`packages/sdk/src/midnight.ts`)
- [x] Cardano → Midnight batch relay: every Buy publishes a public registration ticket (tx metadata 7731); `policy-cover-preprod.mjs --all` mirrors every live Preview policy whose ticket or holder key opens its datum, idempotently; `pnpm midnight:relay:plan` dry run; per-policy mirror state on `/cover` and `/app` (`packages/sdk/src/relay.ts`, `contracts/midnight/relay`)
- [x] Private evidence vault for exploit claims: canonical bundle, in-browser AES-256-GCM, evidence commitment matching the Midnight contract, assessor verification (`/claim/evidence`, `packages/sdk/src/evidence.ts`)
- [x] Exploit claims flow end to end: `fileClaim` on the Midnight Preprod registry, assessor resolution, approved payout from the Cardano Preview exploit-cover pool
- [x] Multi-assessor payouts: exploit `Settle` needs M-of-N distinct assessor-committee signatures (2-of-3 live on Preview, v2 pool; first committee payout `c35535dd…` paid 50 tADA on assessor-1 + assessor-3, a 1-of-3 Settle rejected by both the local and the Preview evaluator); malformed committees refused at InitPool
- [x] Committee-gated claim decisions on Midnight: `policy-cover-v2.compact` replaces the single-assessor `resolveClaim` with an M-of-3 `voteClaim` (one vote per member per claim round, public attributable votes, re-filed claims start a fresh round); 10 simulation tests, v1 commitments unchanged
- [x] v2 Midnight registry deployed on Preprod (`5430b803…`, `contracts/midnight/deployments/preprod-v2.json`): batch relay mirrors Preview policies into it, first committee claim decided by 2-of-3 `voteClaim`
- [ ] Independent assessor operators (today all three Preview committee keys and all three Midnight committee seats are team-run). Shipped toward it: the offline enrollment kit ([`contracts/committee`](contracts/committee/README.md): `pnpm committee keygen` → signed public `enrollment.json` → `verify` → a dry-run `plan` with the exact Cardano `Committee` CBOR and Midnight v2 constructor args, compared by `planSha256`) and the [`/assessors`](https://kshot3000.github.io/PlutusShield/assessors/) page (why 2-of-3, assessor duties, enrollment how-to, today's seats, first committee drills). Still to do: three outside operators enroll, a new exploit-cover pool and policy-cover v2 contract with their seats, a drill claim voted and co-signed from their own machines
- [x] Marketing site + app shell (`apps/web`)
- [x] Web app: interactive quote on `/cover`
- [x] Web app: claim checker on `/claim` (oracle quorum, TWAP trigger, claim window, sale circuit-breaker)
- [x] Web app: buy → manage → claim: Buy on `/cover`, My policies (claim / release actions, Midnight key backup), and a per-policy lifecycle tracker on `/policy` that stitches the Cardano Buy, the 7731 ticket, Midnight `registerPolicy` / `proveCover`, `fileClaim` and committee votes, and the Cardano Settle or release into one timeline (exploit `fileClaim` is still submitted by the Preprod relay CLI, not from the browser)
- [ ] External audits of Cardano and Midnight contracts before any mainnet capital

## Disclaimer

PlutusShield is pre-release software under active design. Nothing here is an offer of insurance, a financial product, or investment advice. Cover availability may be subject to regulatory requirements depending on jurisdiction.

## License

[MIT](LICENSE) © 2026 Kshot ([@kshot9000](https://x.com/kshot9000))
