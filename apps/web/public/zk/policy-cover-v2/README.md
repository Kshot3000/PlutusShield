# ZK assets for policy-cover-v2 (Preprod)

Static layout matching Midnight `NodeZkConfigProvider`:

```
keys/{circuitId}.prover      # ~3MB each — local/dev only, never committed
keys/{circuitId}.verifier    # ~2KB — shipped on GitHub Pages
zkir/{circuitId}.zkir        # ~6–8KB — shipped on GitHub Pages
```

## What Pages ships

This tree commits **verifier + zkir** for `fileClaim` and `proveCover` so the
web app can probe ZK readiness (`probeDefaultZkAssets` /
`@plutusshield/sdk/fetchZkConfig`) without bundling multi-megabyte prover keys.

Compact prove in the browser still needs:

1. Verifier + zkir (here)
2. Prover keys (local — see below)
3. A midnight-js runtime implementing `BrowserCircuitProver`. Shipped: the
   holder prove bridge — `pnpm midnight:prove-bridge` runs
   `contracts/midnight/preprod/prove-bridge.mjs` on 127.0.0.1:6310, which builds
   the call with `createUnprovenCallTx` against the live Preprod v2 registry and
   proves it on your proof server; /claim/evidence finds it automatically and
   hands the unsealed tx to Lace to balance + submit. (Injection via
   `window.__PLUTUSSHIELD_CIRCUIT_PROVER__` / `registerBrowserCircuitProver`
   still takes precedence.)

No bridge running, or the first finalized File-with-Lace drill tx is still pending? Holders file with the claim kit CLI.

## Local prover keys

For Lace File-with-Lace prove experiments on your machine:

```bash
# From apps/web (or repo root with path adjusted)
SYNC_PROVER_KEYS=1 node scripts/sync-zk-assets.mjs
```

Default source: `/workspace/Midnight-GrokBot-Agent/.plutusshield-run/policy-cover-v2`
(override with `ZK_ASSET_SOURCE=/path/to/policy-cover-v2`).

Or symlink:

```bash
ln -sf /path/to/policy-cover-v2/keys/fileClaim.prover \
  public/zk/policy-cover-v2/keys/fileClaim.prover
ln -sf /path/to/policy-cover-v2/keys/proveCover.prover \
  public/zk/policy-cover-v2/keys/proveCover.prover
```

**Do not commit `.prover` files.**
