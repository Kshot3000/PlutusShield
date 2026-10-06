# PlutusShield oracle relay

Turns raw price observations into the exact feed datums the PlutusShield Cardano validator accepts, and checks them against the on-chain rules before anything is signed.

## What it does

1. **Aggregates venues.** At every timestamp any venue reports, it takes the median of each venue's latest price. With three or more venues, one frozen, lagging, or manipulated source cannot move the result past an honest one.
2. **Computes TWAPs.** Prices are a step function; the time-weighted average over a window rounds down exactly like integer division on chain. A window that spans a data gap longer than `maxGapMs` (default 1 hour) is refused instead of being averaged over stale data.
3. **Finds the trigger.** `findDepegWindow` returns the earliest window of `windowMs` inside the policy's `[start, expiry]` whose TWAP is below the threshold. It checks every breakpoint of the piecewise-linear TWAP, so if any qualifying window exists, it finds one.
4. **Feeds the circuit-breaker.** `pegReading` produces the reading over the window ending now. The pool only sells cover when **every** allowlisted feed has a healthy, fresh reading (`SaleGuard.max_price_age_ms`), not just a quorum, so a buyer can't leave out the feed that shows a depeg. A relay that stops publishing pauses sales (fail closed) but never blocks settlement.
5. **Proves it before publishing.** Every datum is re-checked with the TypeScript mirrors of `oracle.attests` / `oracle.attests_peg`, and emitted as inline-datum CBOR.

The math lives in [`packages/sdk/src/oracle.ts`](../../packages/sdk/src/oracle.ts), alongside `settlementCheck`, which tells a claimant (or the app) whether a Settle transaction would pass the validator's claim-window and oracle-quorum rules, and which feed UTxOs to attach as reference inputs.

## Run it

```bash
pnpm relay:evaluate services/oracle-relay/examples/usdm-depeg.example.json
pnpm relay:evaluate services/oracle-relay/examples/usdm-depeg.example.json --json
pnpm test:relay
```

The example file is **synthetic example data** (three venues, a 36-hour USDM dip to about 0.91, one venue frozen at peg) used only to demonstrate the relay. It is not real market data.

## Trust model

- Each relay operator controls one allowlisted feed token (`OracleConfig.feeds`) and publishes from independent venue data. The validator counts each feed at most once and needs `quorum` of them to agree.
- The relay never decides payouts. It publishes a datum; the validator decides whether that datum, together with a quorum of others, proves the trigger inside the policy period.
- Publishing (minting the feed token and locking the datum UTxO) uses the deploy tooling in [`contracts/cardano/deploy`](../../contracts/cardano/deploy).

## Live venues

`src/venues.ts` turns three public, keyless APIs into relay input for Cardano USDM (`c48cbb…0014df105553444d`):

| Venue | Source | Notes |
| --- | --- | --- |
| `coingecko` | CoinGecko `usdm-2` USD market chart | Cross-venue aggregate, hourly |
| `minswap-ada-usdm` | Minswap ADA/USDM pool (GeckoTerminal OHLCV, USDM in ADA) × Kraken ADA/USD hourly candles | The ADA leg comes from a different provider than the pool leg |
| `minswap-usdcx-usdm` | Minswap USDCx/USDM pool (GeckoTerminal OHLCV) | USDM against Circle's USDCx |

AMM prices only move on trades, so no-trade hours are forward-filled from the last close, and every sample is stamped at the end of its candle so a reading can never look ahead. A venue that fails (rate limit, wrong pair side, no data) is reported and skipped; the publisher needs at least two. Free API tiers rate-limit, so requests back off and retry on HTTP 429.

```bash
pnpm relay:live            # read-only: what a relay would publish right now
pnpm relay:live --json
pnpm oracle:publish --dry-run   # Preview publisher decision, signs nothing
```

The Preview publisher (`contracts/cardano/deploy/scripts/oracle-publisher.ts`) runs this every cycle and refreshes the on-chain feeds before `max_price_age_ms` lapses. See step 12 of the [deploy runbook](../../contracts/cardano/deploy/README.md).

## Next

- More venues (a second DEX, a CEX listing) so no single provider family supplies two of three readings.
- One live UTxO per feed (a state-thread oracle) instead of recycling superseded readings.
- Post a depeg attestation automatically once a 24h trigger window is provable, after an operator review step.
