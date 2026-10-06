/** Single source of truth for the in-site protocol docs: order, titles, summaries. */
export type DocSlug =
  | "how-cover-works"
  | "pricing"
  | "underwriting-pool"
  | "settlement"
  | "privacy"
  | "risks";

export interface DocPage {
  slug: DocSlug;
  title: string;
  summary: string;
  tag: string;
  tone: "accent" | "cardano" | "midnight" | "gold";
}

export const DOC_PAGES: DocPage[] = [
  {
    slug: "how-cover-works",
    title: "How cover works",
    summary: "Policy lifecycle from pool init to payout or expiry. Tokens, redeemers, and the rules a purchase must satisfy.",
    tag: "Lifecycle",
    tone: "accent",
  },
  {
    slug: "pricing",
    title: "Pricing",
    summary: "The quote engine, the kinked utilization curve, and the integer premium floor the validator enforces.",
    tag: "Premiums",
    tone: "cardano",
  },
  {
    slug: "underwriting-pool",
    title: "Underwriting pool",
    summary: "LP shares, deposits, withdrawals, and the capital lock that keeps every live policy fully backed.",
    tag: "Capital",
    tone: "cardano",
  },
  {
    slug: "settlement",
    title: "Settlement & claims",
    summary: "Oracle-quorum depeg settlement on Cardano and the assessed claim flow on Midnight.",
    tag: "Claims",
    tone: "accent",
  },
  {
    slug: "privacy",
    title: "Privacy on Midnight",
    summary: "Holder and coverage commitments, the proveCover partner hook, evidence commitments, and holder rotation.",
    tag: "Midnight",
    tone: "midnight",
  },
  {
    slug: "risks",
    title: "Risks & disclosures",
    summary: "What is and isn't built, what you would be trusting, and what can go wrong. Read this first.",
    tag: "Disclosures",
    tone: "gold",
  },
];

export const REPO = "https://github.com/Kshot3000/PlutusShield";
export const src = (path: string) => `${REPO}/blob/main/${path}`;

export const SOURCE_DOCS = [
  {
    title: "Architecture",
    href: src("docs/ARCHITECTURE.md"),
    summary: "Dual-chain system design, privacy boundaries, MVP scope, and trust assumptions.",
    tag: "System",
  },
  {
    title: "Product",
    href: src("docs/PRODUCT.md"),
    summary: "Stakeholders, cover types, UX pillars, and pricing principles (design stage).",
    tag: "Product",
  },
  {
    title: "Competitive landscape",
    href: src("docs/COMPETITIVE.md"),
    summary: "Honest comparison vs Aegis parametric cover and how PlutusShield aims to win.",
    tag: "Market",
  },
  {
    title: "Repository README",
    href: REPO,
    summary: "Vision, dual-chain story, roadmap, and monorepo layout.",
    tag: "Repo",
  },
];

export const SOURCE_CODE = [
  { label: "validators/cover.ak", href: src("contracts/cardano/validators/cover.ak"), note: "Cardano validator (mint + spend)" },
  { label: "lib/plutusshield/pricing.ak", href: src("contracts/cardano/lib/plutusshield/pricing.ak"), note: "On-chain premium floor" },
  { label: "lib/plutusshield/oracle.ak", href: src("contracts/cardano/lib/plutusshield/oracle.ak"), note: "Oracle auth + trigger" },
  { label: "lib/plutusshield/types.ak", href: src("contracts/cardano/lib/plutusshield/types.ak"), note: "Params, datums, redeemers" },
  { label: "src/policy-cover.compact", href: src("contracts/midnight/src/policy-cover.compact"), note: "Midnight private registry" },
  { label: "packages/sdk/src", href: `${REPO}/tree/main/packages/sdk/src`, note: "Quote engine, pool ledger, codecs" },
];
