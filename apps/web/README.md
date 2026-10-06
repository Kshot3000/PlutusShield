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
| `pnpm build` | Production build |
| `pnpm start` | Serve production build |
| `pnpm lint` | ESLint |

## Design notes

- Brand colors and typography live in `src/app/globals.css` (`:root` CSS variables).
- Shared UI: `src/components/ui/*`, chrome: `Header`, `Footer`, `Logo`, `AppShell`.
- Landing sections: `src/components/landing/*`.
- Never invent live metrics — use “Coming soon” / em dashes.

## Related docs

- [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- [docs/PRODUCT.md](../../docs/PRODUCT.md)
- [docs/COMPETITIVE.md](../../docs/COMPETITIVE.md)
