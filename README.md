# PlutusShield

**DeFi and smart-contract insurance for Cardano and Midnight.**

PlutusShield is protection you can verify on-chain, with privacy where it actually matters. Cardano handles settlement, premiums, and underwriting liquidity. Midnight handles the sensitive parts: policy terms, claims evidence, and underwriter positions, using zero-knowledge proofs and selective disclosure.

> **Status: pre-testnet.** This repo holds the product vision and docs, a Next.js site and app shell (`apps/web`) with a working cover quote calculator, the shared quote engine (`packages/sdk`), and the first Midnight Compact contract (`contracts/midnight`, compiles and passes off-chain simulation tests). Nothing is deployed, no pools are live, and no policies are on sale yet. Quote figures use model parameters against an example pool.

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
│   └── midnight/           # Compact: private cover registry, holder proofs, claims
├── packages/
│   └── sdk/                # Products, risk tiers, kinked-utilization quote engine
│
│   # Planned (not yet present):
├── contracts/cardano/      # Aiken validators: pool, policy, claims, payout
└── services/
    ├── api/                # TypeScript API: quotes, policy lifecycle, indexer
    └── oracle-relay/       # Oracle aggregation + trigger evaluation
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

### Tests

```bash
pnpm test            # SDK quote engine + Midnight contract simulation
pnpm test:sdk        # quote engine only (Node 22+)
```

### Midnight contract

Requires the Compact toolchain (`compact` CLI with compiler 0.31.1).

```bash
cd contracts/midnight
pnpm compile         # full compile incl. prover/verifier keys
pnpm test            # fast compile + off-chain circuit tests
```

See [contracts/midnight/README.md](contracts/midnight/README.md).

### Cardano contracts (planned)

```bash
# cd contracts/cardano && aiken check && aiken build
```

## Roadmap (high level)

- [x] Vision, architecture, and product docs
- [ ] Aiken validators: underwriting pool, policy mint, payout
- [ ] Parametric trigger: multi-oracle stablecoin depeg (first product)
- [x] Compact contract: private policy commitment + coverage proof (`contracts/midnight`)
- [x] Quote engine with risk tiers and utilization-kinked pricing (`packages/sdk`)
- [ ] Exploit claims flow with private evidence vault
- [x] Marketing site + app shell (`apps/web`)
- [x] Web app: interactive quote on `/cover`
- [ ] Web app: buy → manage → claim
- [ ] External audits of Cardano and Midnight contracts before any mainnet capital

## Disclaimer

PlutusShield is pre-release software under active design. Nothing here is an offer of insurance, a financial product, or investment advice. Cover availability may be subject to regulatory requirements depending on jurisdiction.

## License

[MIT](LICENSE) © 2026 Kshot ([@kshot9000](https://x.com/kshot9000))
