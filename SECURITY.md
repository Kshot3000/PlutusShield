# Security policy

PlutusShield is **not audited** and runs on testnets only (Cardano Preview, Midnight Preprod) with test value. No mainnet deployment and no mainnet capital happen before an external audit of both the Cardano validators and the Midnight circuits.

## Reporting a vulnerability

Please report privately through a [GitHub security advisory](https://github.com/Kshot3000/PlutusShield/security/advisories/new) rather than a public issue. Include:

- the component (validator, circuit, SDK module, oracle relay, relay CLI),
- the test, transaction, or steps that show the problem,
- the Preview or Preprod tx hash if you reproduced it on a testnet.

Only testnet value is at stake today. Test against Preview and Preprod, never against anyone's mainnet funds. There is no paid bug bounty yet.

## Audit scope

The full scope, with every invariant mapped to the tests that check it, the privileged roles and who holds them today, and the known gaps, is on the site: [Security & audit scope](https://kshot3000.github.io/PlutusShield/docs/security/) (source: `apps/web/src/app/docs/security/page.tsx`).

In short:

| Component | Path |
| --- | --- |
| Depeg cover validator | `contracts/cardano/validators/cover.ak` |
| Exploit cover validator (M-of-N committee Settle) | `contracts/cardano/validators/exploit_cover.ak` |
| Oracle, pricing, naming, types | `contracts/cardano/lib/plutusshield/` |
| Midnight registry v2 (live) and v1 (history) | `contracts/midnight/src/policy-cover-v2.compact`, `contracts/midnight/src/policy-cover.compact` |
| Off-chain code a payout depends on | `packages/sdk/src`, `services/oracle-relay/src`, `contracts/midnight/relay` |

## Reproducing the test suite

With Node 20+, pnpm 9, Aiken v1.1.24 and the Compact toolchain (compactc 0.31.1):

```sh
pnpm install && pnpm test
```

<!-- test-counts -->
On main today that runs 131 Aiken checks, the Lucid-emulator end-to-end flow (36 steps, 12 of them checks that a bad transaction or setup is refused), 60 Midnight simulation tests, 193 SDK tests, 14 oracle-relay tests and 3 committee-kit tests.
<!-- /test-counts -->

That sentence, and every test count on the site, comes from `apps/web/src/data/test-report.json`, written by `pnpm test:report` from each suite's own summary after a fully green run. `pnpm check:counts` (also the first step of the web build) fails if this file or the README quotes a count that differs from the report.
