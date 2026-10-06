# @plutusshield/web

Marketing site and dApp shell for **PlutusShield** — DeFi insurance for Cardano and Midnight.

> Design preview. No live TVL, policies, or claims. Placeholder routes mark features as coming soon.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS v4
- Dark, fintech-grade design system (CSS variables)

## Routes

| Path | Purpose |
|------|---------|
| `/` | Landing — hero, problem, dual-chain, cover types, how it works, competitive honesty, CTA |
| `/app` | dApp shell overview |
| `/cover` | Cover marketplace placeholder |
| `/pool` | Underwriting pool placeholder |
| `/docs` | Links to repo docs (`ARCHITECTURE`, `PRODUCT`, `COMPETITIVE`) |

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
  every route (`/`, `/app`, `/cover`, `/pool`, `/docs`) is pre-rendered to plain HTML. The quote
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
- Never invent live metrics — use “Coming soon” / em dashes.

## Related docs

- [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- [docs/PRODUCT.md](../../docs/PRODUCT.md)
- [docs/COMPETITIVE.md](../../docs/COMPETITIVE.md)
