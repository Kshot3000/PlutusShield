# PlutusShield — Wave 2 progress (Midnight Buildathon)

**Paste into the AKINDO “progress this Wave” field.** Window: 27 Sep – 17 Oct 2026.  
**Live site:** https://kshot3000.github.io/PlutusShield/  
**Repo:** https://github.com/Kshot3000/PlutusShield (`midnightntwrk` topic)  
**License:** Midnight Compact + evaluation tooling under `contracts/midnight/` is **Apache-2.0**; Cardano / site / SDK remain MIT.

Testnet only (Cardano Preview + Midnight Preprod). Not audited.

## What shipped in Wave 2

### Midnight (privacy + ZK)

- **policy-cover v2 on Preprod** (`5430b803…`): same private registry as v1, but claims decided by an **M-of-3 `voteClaim`** so no single Midnight key can approve a payout. Matches the Cardano exploit pool’s 2-of-3 `Settle`.
- **Batch relay** mirrors Cardano Preview Buys into the v2 registry (`registerPolicy`); dry-run plan via `pnpm midnight:relay:plan:v2`. Preprod indexer moved to **Blockfrost** after the retired Midnight-hosted endpoints went 410/503 — site panels, snapshots, and relay all read Blockfrost.
- **Holder claim kit:** passphrase-encrypted kit from `/claim/evidence`; holder files `fileClaim` from their own machine so the operator relay never holds the policy key. First holder-filed claim paid end to end (policy `496dced8…`, Midnight `00989a6a…`, Cardano Settle `dbf0ba7a…`, 25 tADA).
- **Lace Midnight connector** in the web app (`window.midnight`, never hardcode `mnLace`) plus a **holder prove bridge** for File with Lace (`proveCover` / `fileClaim` proven locally, Lace balances + submits). Bridge-submit drill balances and binds; first finalized Lace submit still in progress — claim kit remains the proven filer until then.
- Explorer links use **https://preprod.midnightexplorer.com** (the old `explorer.preprod.midnight.network` host is dead).

### Cardano (settlement)

- **Browser Buy for exploit cover** on `/cover` (same CIP-30 path as depeg) against the **2-of-3 committee** exploit pool on Preview.
- Live **oracle publisher** keeps USDM depeg sales open while the peg is healthy (multi-venue 24h TWAP → three Preview feeds); sales close on stale feeds or a broken peg. Public history on `/oracle`.
- **Assessor enrollment kit** + `/assessors` for outside operators to take the three seats (today still team-run).

### Product surfaces judges can click (no wallet required for most)

| Route | What it shows |
|---|---|
| [/demo](https://kshot3000.github.io/PlutusShield/demo/) | Guided 5-beat walkthrough with every Cardano + Midnight receipt |
| [/cover](https://kshot3000.github.io/PlutusShield/cover/) | Buy depeg or exploit cover; My policies across both pools |
| [/claim/evidence](https://kshot3000.github.io/PlutusShield/claim/evidence/) | Seal evidence, File with Lace / claim kit, live committee |
| [/products](https://kshot3000.github.io/PlutusShield/products/) | Cover catalog: depeg + exploit live (ADA/USDC), SLA priced not buyable |
| [/book](https://kshot3000.github.io/PlutusShield/book/) | Open underwriting book: live Preview pools, tier B scorecard, capital |
| [/claims](https://kshot3000.github.io/PlutusShield/claims/) | Public claims register (approved, denied, split votes, refused 1-of-3) |
| [/status](https://kshot3000.github.io/PlutusShield/status/) | Preview + Preprod systems honesty |
| [/policy](https://kshot3000.github.io/PlutusShield/policy/) | One policy, both chains, one timeline |
| [/plan](https://kshot3000.github.io/PlutusShield/plan/) | Portfolio cover planner: price several exposures against live Preview tranches; deep-link any portfolio via URL (`encodePlanShare`) |
| [/docs/api](https://kshot3000.github.io/PlutusShield/docs/api/) | Open data API: products, claims, book, oracle and a sample cover plan as versioned JSON (`/api/v1/*.json`) |
| [/feed.xml](https://kshot3000.github.io/PlutusShield/feed.xml) | Atom activity feed: every claim decision, refused Settle and the newest oracle publishes, for feed readers and Discord/Telegram bots |

### Submission kit

- Deck: `docs/buildathon/PlutusShield-Wave2-deck.pdf`
- Video script: `docs/buildathon/VIDEO_SCRIPT.md` (~3 min)
- Checklist: `docs/buildathon/README.md`

## Still honest about gaps

- Three assessor seats are team-run until independent operators enroll.
- First finalized File-with-Lace submit on Preprod is still the next drill; holders file with the claim kit today.
- Not audited; no mainnet capital.

## How judges can evaluate Midnight

```bash
pnpm install
pnpm test:midnight                  # compile (--skip-zk) + circuit tests
cd contracts/midnight && pnpm compile   # compactc 0.31.1 + keys
```

Compact sources: `contracts/midnight/src/policy-cover.compact` and `policy-cover-v2.compact` (Apache-2.0).
