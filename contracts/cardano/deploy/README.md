# PlutusShield on Cardano Preview: deploy runbook

Scripts to take the `cover` validator from `plutus.json` to a live pool on the
**Cardano Preview testnet**, with **ADA and USDC tranches**. Everything here
runs without funds, except one human step: funding the deployer address
from the faucet.

> **Status:** **live on Cardano Preview.** Pool at `addr_test1wp89ggl7ls5gwxh02w7ja6zhytqe4a6zu6m6n82s0cxw9tq4j5tgr` (script `4e5423fefc28871aef53bd2ee85722c19af742e6b7a99d507e0ce2ac`), InitPool `fc2a3ca252051a41589f58b612e08427b512a2cf17e0b3fa5a53500f162ca236`. Seeded with 2,000 ADA + 100,000 tUSDCx; first ADA and USDC buys landed. Emulator e2e still the CI check. Not audited. Test value only.

## What gets deployed

| Item | Preview | Mainnet (placeholder, not deployed) |
|---|---|---|
| Validator | `cover.cover` from `../plutus.json`, applied with `CoverParams` | same |
| Tranche 0 | ada (`""`.`""`), LP token `lp00` | ada |
| Tranche 1 | **mock tUSDCx**: `<deployer native-script policy>`.`745553444378` ("tUSDCx"), 6 decimals | **USDCx** `1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34`.`5553444378`, 6 decimals |
| Oracle | test oracle: native script `sig(oracle key)`, feeds `feed-a/b/c`, quorum 2 | independent operators / policies (TBD) |
| Product | depeg, tier B, USDM, TWAP < 0.95 for 24h, 14–365 days, 3-day claim grace | same model |
| Sale guard | 60 min waiting period, healthy-peg readings ≤ 120 min old | 24h / 120 min (SDK default) |

**Which USDC.** On Cardano, PlutusShield's "USDC" is **USDCx**, Circle's USDC-backed native asset issued through xReserve (on mainnet since 2026-02-27). Circle also publishes a **Preprod** USDCx (`31dde3db98ad05feb688d4dbb146b3b6054e1246cbcef98c79b0bf66`.`5553444378`). Circle has **no Preview USDCx**, so on Preview the deployer mints a mock **tUSDCx** under a single-key native script. The mock has the same 6 decimals, so all base-unit math is identical. Anyone holding the deployer key can mint more, so it only exists for testing. Asset classes live in `packages/sdk/src/assets.ts`.

Current Preview identities (from `pnpm keygen`, public values, in `deployments/preview.json`):

```
deployer address   addr_test1vr0zk5tv56j2xaaefl4qrzzgxtdvcr6hhssa94fwh72fd5ccklyuz
mock tUSDCx unit   e5c5ae166089e4d907cabf8456dea8aebb76a2d5c65458c8e1e632ef.745553444378
oracle policy      d8365e107288ee8c1e313505cf2c754386eef7c95b2cd75b1fa1dd93  (feeds 666565642d61/62/63)
```

The script hash, pool address, and pool NFT depend on the **seed UTxO**, so they are only final after funding and `pnpm plan`. The dry run (`deployments/preview.dryrun.json`) uses a placeholder seed and is **not** a usable address.

## Files

```
preview.config.json        public deployment settings (assets, oracle allowlist + quorum, product, grace)
lib/keys.ts                local keys (.keys/, gitignored) and native-script policies
lib/cover.ts               CoverParams from config, parameter application, datum decoding
lib/actions.ts             tx builders: mint tUSDCx, InitPool, Deposit, Withdraw, Buy (+ healthy-feed selection), feeds, Settle, Expire (+ refund)
lib/chain.ts               Koios (default) / Blockfrost provider, deployments/preview.json I/O
scripts/keygen.ts          step 1: keys + derived ids
scripts/plan.ts            step 3: apply params, cross-check against `aiken blueprint apply`, publish addresses
scripts/preview.ts         live commands
scripts/emulator.ts        the whole flow in the Lucid Emulator (CI)
deployments/preview.json   published addresses (commit after each step)
deployments/preview.env    NEXT_PUBLIC_* for apps/web (written by plan)
```

All datum and redeemer bytes come from `@plutusshield/sdk` (`packages/sdk/src/cardano.ts`). The SDK tests pin those encoders byte for byte to the Aiken golden vectors, so the off-chain code builds exactly what the validator decodes.

## Checklist

Run from `contracts/cardano/deploy` (or use the root aliases `pnpm preview:keygen`, `pnpm preview:plan`, `pnpm cardano:preview …`).

- [x] **0. Build + test.** `aiken check && aiken build` in `contracts/cardano` (92 tests), then `pnpm test:sdk` and `pnpm emulator` from here.
- [x] **1. Keys.** `pnpm keygen` creates `.keys/deployer.sk` and `.keys/oracle.sk` (mode 600, gitignored), then writes the deployer address, the mock tUSDCx policy, and the oracle policy to `deployments/preview.json`. Running it again reuses the existing keys.
- [x] **2. 🧍 HUMAN STEP: fund the deployer.** Open <https://docs.cardano.org/cardano-testnets/tools/faucet>, choose **Preview**, and paste the deployer address. One faucet drip (about 10,000 tADA) is plenty. The faucet has a captcha, so this step can't be scripted. Then check with `pnpm preview status`.
- [x] **3. Mock USDC.** `pnpm preview mint-usdc 1000000` mints 1,000,000 tUSDCx to the deployer. Do this **before** planning, so the seed UTxO is never spent by an unrelated transaction.
- [x] **4. Parameterise.** `pnpm plan` picks a pure-ada deployer UTxO as the seed and applies `CoverParams`: the oracle allowlist and quorum from `preview.config.json`, plus `[ada, tUSDCx]` tranches with a 5-unit premium floor each. It checks that Lucid's applied hash equals `aiken blueprint apply`'s, then writes `deployments/preview.{json,env,plutus.json}`. Don't spend the seed before step 5. If you do, run `pnpm plan` again.
- [x] **5. Mint the pool NFT.** `pnpm preview init` submits `InitPool`. It consumes the seed, mints `<hash>.706f6f6c` ("pool"), and locks 3 ADA with `PoolDatum { tranches: [{0,0},{0,0}] }`.
- [x] **6. Publish addresses.** Commit `deployments/preview.json` and `deployments/preview.env`. Copy the env values into the web build (`apps/web/.env.local` or the Pages workflow env) so `/cover` shows the real tUSDCx policy.
- [x] **7. Seed capital.** Run `pnpm preview deposit ada 2000` and `pnpm preview deposit usdc 100000`. Each tranche mints its own LP token (`lp00`, `lp01`).
- [x] **8. First buy.** The circuit-breaker needs fresh healthy-peg readings first: `pnpm preview peg` publishes `feed-a` and `feed-b` at 1.00 for the last 24h to the oracle key's address (fresh for 120 min). Then `pnpm preview buy usdc 1000 14` buys 1,000 tUSDCx of cover for 14 days. The premium is the validator floor, paid in tUSDCx. Then `pnpm preview buy ada 150 14` (at most 10% of the 2,000 ADA tranche). Each prints the `policyId`. Cover starts 60 min after the buy (waiting period), and the expiry refund address is the deployer.
- [x] **10. Browser LP (CIP-30).** `/pool` deposits and withdraws from a connected wallet (Lace, Eternl, Typhon). It uses `apps/web/src/lib/tx/lp.ts`, the same builder `pnpm web-lp <deposit|withdraw> <ada|usdc> <amount>` runs here with the deployer key. `pnpm web-artifacts` exports the applied script and pool identity the browser needs to `apps/web/src/data/preview-deployment.json` (public data only). `pnpm browser-e2e deposit 5 0` drives the real static build in headless Chromium with a mock CIP-30 wallet whose signing is bridged to Node, so keys never enter the page.
- [x] **11. Browser buy (CIP-30).** `/cover` buys depeg cover from a connected wallet, premium in tADA or tUSDCx, and lists the wallet's policies ("My policies"). One Buy builder serves everything: `apps/web/src/lib/tx/cover.ts` (`buildBuy`, the `saleCheck` oracle circuit-breaker, `listWalletPolicies`). `lib/actions.ts` `buy` (emulator + `pnpm preview buy`) delegates to it, and `pnpm web-buy buy <ada|usdc> <coverage> [days]` runs it here with the deployer key; `pnpm web-buy oracle` shows each feed's sale status and `pnpm web-buy policies` the wallet's policies. If the readings are stale, `web-buy buy` first publishes fresh healthy-peg readings with the Preview test-oracle key (it refuses if a feed reports a depeg). The browser can't publish feeds, so `/cover` shows "Sales paused" until the operator refreshes them (`pnpm preview peg`, fresh for 120 min). `pnpm browser-e2e buy 50 0 14` drives the real static build's Buy panel with the mock wallet. `pnpm web-artifacts` now also exports the full `CoverParams` and the oracle feed address.
- [ ] **9. (Optional) Claim drill.** `pnpm preview feeds 9100 <startMs> <endMs> feed-a,feed-b` publishes a depeg inside the policy term (window ≥ 24h). Then run `pnpm preview settle <policyId>`. Or let the policy run out and use `pnpm preview expire <policyId>` after expiry plus 3 days. The 2.5 ADA deposit goes back to the buyer's `refund_to` address, whoever submits. Feed UTxOs live at the oracle key's address, so wallet coin selection never touches them.

`.env` example for the web app (`deployments/preview.env` after step 4):

```
NEXT_PUBLIC_CARDANO_NETWORK=preview
NEXT_PUBLIC_PREVIEW_SCRIPT_HASH=<from plan>
NEXT_PUBLIC_PREVIEW_POOL_ADDRESS=<from plan>
NEXT_PUBLIC_PREVIEW_POOL_NFT=<hash>706f6f6c
NEXT_PUBLIC_PREVIEW_USDC_POLICY_ID=e5c5ae166089e4d907cabf8456dea8aebb76a2d5c65458c8e1e632ef
NEXT_PUBLIC_PREVIEW_ORACLE_POLICY_ID=d8365e107288ee8c1e313505cf2c754386eef7c95b2cd75b1fa1dd93
```

Provider: Koios (`https://preview.koios.rest/api/v1`, no key) by default. `pnpm preview` falls back to raw `/tx_info` when Lucid's `awaitTx` hits a Koios schema quirk (`collateral_output.asset_list` as the string `"[]"`). Set `BLOCKFROST_PROJECT_ID` to use Blockfrost, or `KOIOS_URL` to use another Koios instance. Set `PLUTUSSHIELD_KEYS_DIR` to keep keys somewhere other than `.keys/`.

## Known gaps before this is more than a testnet demo

1. ~~**Sale during a depeg.**~~ **Fixed.** `Buy` needs a fresh healthy-peg reading from **every** allowlisted feed (not just a quorum, so a buyer can't leave out the feed that already shows a depeg), and cover starts after `sale_guard.waiting_period_ms`. *Residual:* each reading is its own UTxO, so a superseded healthy reading stays usable until it is `max_price_age_ms` old (the off-chain client uses only the newest reading per feed; the fix is a state-thread oracle with one live UTxO per feed). Also oracle latency (a depeg visible off-chain before feeds update) and TWAP smoothing. The waiting period limits both, because a depeg must persist past `start` plus a full trigger window. On Preview the single test-oracle key can attest anything, so the breaker is only as honest as the oracle (see 5).
2. **Coverage amounts are public.** `coverage` and `premium` sit in plaintext in `PolicyDatum`, and per-tranche `active_cover` sits in `PoolDatum`, because the pool must lock capital against them. Midnight's `midnight_commitment` only adds holder unlinkability and partner proofs. The Preview `buy` command writes a **random placeholder** commitment, because Midnight registration isn't wired in yet. *Fix:* bucketed or batched cover sizes, or private pool accounting.
3. ~~**Expiry deposit recipient.**~~ **Fixed.** `PolicyDatum.refund_to` is set at purchase, and `Expire` must pay it at least the reference UTxO's lovelace. *Residual:* the refund goes to the original buyer even if the user token was transferred, and third parties have no fee incentive to expire (LPs do).
4. **Single-pool concurrency.** Every LP and policy action spends the one pool UTxO, so only one action can land per block. Two buyers racing will get "input already spent", and one has to rebuild. *Fix:* order or batcher UTxOs that a keeper folds into the pool, or several pool shards per product.
5. **Test oracle is one key.** On Preview, one oracle key signs all three feed tokens, so a 2-of-3 quorum proves nothing there. Real feeds (Charli3, Orcfax) publish their own datum formats, not `OracleDatum`. Production needs independent operators/policies or an adapter feed.
6. **ada tranche min-UTxO dust.** The pool's 3 ADA min-UTxO counts as ada-tranche capital, and the first ada LP effectively owns it. If the ada tranche is fully withdrawn, the ledger rejects the pool output for being under min-UTxO, which leaves dust. In a pool without an ada tranche, that ada is locked for good. Harmless, but untidy.
7. **Correlated collateral isn't enforced.** `Trigger.covered_asset` is a ticker, not an asset class. The validator therefore cannot stop a USDCx-depeg product from being backed by a USDCx tranche. Deployers must not configure that.
8. **No cross-currency premiums.** Paying ada for USDC cover would need an FX price on-chain, so a policy's premium and payout share its tranche asset. This is by design.
9. **Browser buy flow not live yet.** LP deposit and withdraw are signed in the browser (step 10). Buying cover still goes through this CLI, because the browser needs a feed indexer to pick the healthy-peg oracle reference inputs.
11. **Browser chain API.** Public Koios now only sends CORS headers to its own origin, so a browser on the Pages site can't read Preview through it. Set `NEXT_PUBLIC_BLOCKFROST_PREVIEW_ID` (a Preview-only Blockfrost project id) in the Pages build to make live reads and LP transactions work for visitors. Without it, `/pool` shows the build-time snapshot and LP actions explain that the API was blocked. The site also strips Lucid's `traceparent` header, which no Cardano API allows in a CORS preflight.
10. **Not audited.** Not for mainnet capital.
