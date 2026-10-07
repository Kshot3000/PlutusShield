# @plutusshield/web

Marketing site and dApp shell for **PlutusShield** — DeFi insurance for Cardano and Midnight.

> Live on testnets. The pool is deployed on Cardano Preview and the policy registry on Midnight Preprod: `/pool` and `/cover` read live chain state (Blockfrost, with a build-time snapshot fallback), and CIP-30 wallets can buy cover, deposit/withdraw LP, file claims, and release policies on Preview. The quote calculator and pool simulator still run the real SDK math (the same integer rules the Aiken validators enforce) against an example tranche. Unaudited — test value only, no mainnet anything.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS v4
- Dark, fintech-grade design system (CSS variables)

## Routes

| Path | Purpose |
|------|---------|
| `/` | Landing: hero, problem, dual-chain, cover types, how it works, competitive honesty, CTA |
| `/app` | "Your shield" dashboard: wallet state, live Preview policies and Midnight Preprod contract activity, and the launch milestone tracker (`src/lib/status.ts`) |
| `/cover` | Quote calculator (product, ADA/USDC tranche, amount and term with validation, tier, premium breakdown, policy timeline) plus the live browser Buy flow, My policies with claim/release actions, and per-policy Midnight mirror state |
| `/pool` | Live Preview pool panel (tranches, utilization, on-chain policies) with signed LP deposit/withdraw, plus the underwriter simulator: capital, tier, utilization and claims scenarios, LP shares and capital lock |
| `/claim` | Claim checker: example USDM market across three venues, venue-failure and feed-outage toggles, a time scrubber; verdicts from the SDK mirrors of `oracle.ak` (`settlementCheck`, `healthy`) and the relay window search, plus the attested `OracleDatum` CBOR |
| `/docs` | Protocol docs hub plus six pages: how cover works, pricing, underwriting pool, settlement (incl. the sale circuit-breaker), privacy, risks |
| `404` | Branded not-found page (GitHub Pages serves `404.html` for unknown paths) |

## Run locally

From the **monorepo root** (recommended):

```bash
pnpm install
pnpm dev
```

Or from this package:

```bash
cd apps/web
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### npm alternative

```bash
cd apps/web
npm install
npm run dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Static export to `out/` (served from `/`) |
| `pnpm build:pages` | Static export with `basePath=/PlutusShield` for GitHub Pages |
| `pnpm preview` | Serve `out/` locally |
| `pnpm lint` | ESLint |

## Deployment — GitHub Pages

**URL:** https://kshot3000.github.io/PlutusShield/

- `next.config.ts` sets `output: "export"`, `trailingSlash: true`, and unoptimized images, so
  every route (`/`, `/app`, `/cover`, `/pool`, `/claim`, `/docs/*`, `404`) is pre-rendered to plain HTML. The quote
  calculator and pool simulator run entirely client-side.
- `basePath` / `assetPrefix` come from `NEXT_PUBLIC_BASE_PATH`. It is empty for local dev and
  set to `/PlutusShield` by the Pages workflow (from `actions/configure-pages`). If the site
  moves to a custom domain at the root, the workflow picks up the new base path automatically.
- Workflow: [`.github/workflows/pages.yml`](../../.github/workflows/pages.yml) — build on push
  to `main` (paths: `apps/web`, `packages/sdk`, lockfile), deploy with `actions/deploy-pages`.
- Requires **Settings → Pages → Source: GitHub Actions** (one-time).

To check the Pages build locally under the sub-path:

```bash
pnpm build:pages
mkdir -p /tmp/pages && cp -r out /tmp/pages/PlutusShield
python3 -m http.server 4200 -d /tmp/pages   # → http://localhost:4200/PlutusShield/
```

## Design notes

- **Brand system — "Ink & Aurora".** Deep ink surfaces; Cardano cobalt (`--cardano`, public
  settlement) and Midnight violet (`--midnight`, shielded state) meet in a periwinkle shield
  accent (`--accent`). Plutus gold (`--gold`) is reserved for value / status signals.
- **Type.** Instrument Serif (display, italic for emphasis) + Instrument Sans (UI) +
  JetBrains Mono (labels, figures).
- **Depth & motion.** `.glass-panel` (blurred surface with a gradient hairline border),
  aurora drift, orbiting hero illustration, CSS scroll-driven `.reveal`. All motion is
  disabled under `prefers-reduced-motion`; reveals degrade to static where unsupported.
- Brand colors and typography live in `src/app/globals.css` (`:root` CSS variables).
- Shared UI: `src/components/ui/*`, chrome: `Header`, `Footer`, `Logo`, `AppShell`.
- Landing sections: `src/components/landing/*`.
- Shared form primitives: `ChoiceGroup` (native radios in a fieldset, so arrow keys and screen
  readers work), `AmountField` (string state, inline `aria-invalid` errors), `PreviewFlow`
  (a steps-and-status explainer under the simulators, collapsed content is `inert`).
- Accessibility bar: axe-core clean (WCAG 2.1 AA + best practice) on every route at 1280 and
  390 px; visible focus rings; scrollable tables and code blocks are keyboard-focusable;
  external links announce "opens in a new tab"; `--text-dim` meets AA contrast.
- Never invent live metrics. Example tranches are labelled as examples; launch status comes
  from `src/lib/status.ts`.

## Related docs

- [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- [docs/PRODUCT.md](../../docs/PRODUCT.md)
- [docs/COMPETITIVE.md](../../docs/COMPETITIVE.md)
