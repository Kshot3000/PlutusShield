import type { Currency } from "./assets.ts";

export type ProductId = "depeg" | "exploit" | "sla";
export type RiskTier = "A" | "B" | "C";

/**
 * Where a product line stands today, stated honestly:
 *   live     a deployed pool takes real (testnet) premiums from a browser wallet
 *   priced   the quote engine prices it, but nothing on-chain sells it yet
 *   planned  on the roadmap, not even priced
 */
export type ProductStatus = "live" | "priced" | "planned";

/** How a claim is decided: from an oracle reading, or by the assessor committee. */
export type SettlementModel = "parametric" | "assessed";

export interface ProductLink {
  href: string;
  label: string;
}

export interface Product {
  id: ProductId;
  name: string;
  chain: "Cardano" | "Cardano + Midnight";
  /** Base annual premium rate before risk and utilization adjustments (0.02 = 2%). */
  baseAnnualRate: number;
  minDays: number;
  maxDays: number;
  trigger: string;
  privacy: string;

  // ── Catalog metadata: the /products page and docs read these, so copy lives in one place. ──
  status: ProductStatus;
  /** One-line pitch for the catalog card. */
  tagline: string;
  /** What loss the product pays for. */
  covers: string;
  settlementModel: SettlementModel;
  /** Which chain does what for this product. */
  settlement: string;
  /** How a claim becomes a payout, in one line. */
  claimModel: string;
  /** What the trigger reads (oracle feeds, committee, or the missing uptime oracle). */
  source: string;
  /**
   * Currencies a buyer can pay the premium (and is paid out) in today. Empty
   * for a product that cannot be bought yet. NIGHT is never listed: Midnight
   * carries privacy and claims, not premiums.
   */
  premiumCurrencies: readonly Currency[];
  /** Currencies the product is designed for once it ships (same as premiumCurrencies when live). */
  plannedCurrencies: readonly Currency[];
  /** Sale guard / waiting-period rule, in words. Exact values come from the deployment record. */
  saleGuard: string;
  /** Buy deep link, or null when the product is quote-only. */
  buy: ProductLink | null;
  /** Where to price it without buying. */
  quote: ProductLink;
  /** What blocks a non-live product from being bought (null when live). */
  blocker: string | null;
  /** Further reading and live surfaces for this product. */
  related: readonly ProductLink[];
}

/** NIGHT premiums are not supported anywhere today; the catalog says so rather than implying it. */
export const NIGHT_PREMIUMS_SUPPORTED = false;

/**
 * Model parameters for the testnet quote engine. These are PlutusShield's
 * starting assumptions, not market data; governance will tune them.
 */
export const PRODUCTS: Record<ProductId, Product> = {
  depeg: {
    id: "depeg",
    name: "Stablecoin depeg cover",
    chain: "Cardano",
    baseAnnualRate: 0.02,
    minDays: 14,
    maxDays: 365,
    trigger: "Parametric: multi-oracle TWAP below 0.95 for 24h",
    privacy: "Coverage size committed on Midnight",
    status: "live",
    tagline: "Pays the full coverage if USDM trades below $0.95 for a day. No claim form, no vote.",
    covers: "A Cardano stablecoin (USDM on Preview) losing its peg during your term.",
    settlementModel: "parametric",
    settlement:
      "Cardano holds the pool, the policy and the payout. The policy carries only a commitment to the holder's private Midnight key.",
    claimModel:
      "Parametric: once 2 of 3 authenticated oracle feeds show the 24h TWAP below 0.95, the holder's Settle pays the full coverage from the pool.",
    source: "Three oracle feeds on Cardano Preview (2-of-3 quorum), fed by a multi-venue 24h TWAP.",
    premiumCurrencies: ["ADA", "USDC"],
    plannedCurrencies: ["ADA", "USDC"],
    saleGuard:
      "Every allowlisted feed must show a fresh healthy-peg reading, so sales close on a stale feed or a broken peg; cover starts only after a waiting period.",
    buy: { href: "/cover#buy-depeg", label: "Buy depeg cover" },
    quote: { href: "/cover#quote", label: "Model a quote" },
    blocker: null,
    related: [
      { href: "/oracle", label: "Live oracle" },
      { href: "/docs/settlement#parametric", label: "Parametric settlement" },
      { href: "/docs/settlement#sale-guard", label: "Sale guard" },
      { href: "/book", label: "Underwriting book" },
      { href: "/docs/terms#depeg", label: "Cover wording" },
    ],
  },
  exploit: {
    id: "exploit",
    name: "Smart-contract exploit cover",
    chain: "Cardano + Midnight",
    baseAnnualRate: 0.045,
    minDays: 30,
    maxDays: 365,
    trigger: "Assessed: evidence vault on Midnight + assessor vote",
    privacy: "Evidence and coverage private by default",
    status: "live",
    tagline: "Covers a Cardano DeFi contract exploit. Evidence stays sealed on Midnight; payout needs 2 of 3 assessors.",
    covers: "Funds lost to an exploit of a covered Cardano DeFi contract during your term.",
    settlementModel: "assessed",
    settlement:
      "Midnight holds the sealed evidence commitment and the committee's private votes; Cardano holds the pool and releases the payout.",
    claimModel:
      "Assessed: the holder files a sealed evidence commitment on Midnight, the 3-seat committee votes, and the Cardano Settle needs 2 of 3 assessor signatures.",
    source: "A 3-seat assessor committee voting on Midnight Preprod; no price oracle is involved.",
    premiumCurrencies: ["ADA", "USDC"],
    plannedCurrencies: ["ADA", "USDC"],
    saleGuard:
      "No peg circuit-breaker, since there is no price trigger: only the waiting period between purchase and cover start guards the sale.",
    buy: { href: "/cover#buy-exploit", label: "Buy exploit cover" },
    quote: { href: "/cover#quote", label: "Model a quote" },
    blocker: null,
    related: [
      { href: "/claim/evidence", label: "File evidence" },
      { href: "/docs/settlement#assessed", label: "Assessed settlement" },
      { href: "/claims", label: "Claims register" },
      { href: "/assessors", label: "Assessors" },
      { href: "/docs/terms#exploit", label: "Cover wording" },
    ],
  },
  sla: {
    id: "sla",
    name: "Protocol SLA cover",
    chain: "Cardano",
    baseAnnualRate: 0.015,
    minDays: 7,
    maxDays: 180,
    trigger: "Parametric: uptime oracle below SLA threshold",
    privacy: "Coverage size committed on Midnight",
    status: "priced",
    tagline: "Planned cover for protocol downtime. Priced in the quote engine today; not for sale until an uptime oracle exists.",
    covers: "A protocol's measured uptime falling below its stated SLA during your term.",
    settlementModel: "parametric",
    settlement:
      "Planned to settle on Cardano like depeg cover, from an uptime oracle in place of a price oracle, with the coverage committed on Midnight.",
    claimModel:
      "Planned parametric: an uptime oracle reading below the SLA threshold would let the holder settle. No uptime oracle or pool is deployed.",
    source: "None yet. An authenticated uptime oracle has to be built and run before this can sell.",
    premiumCurrencies: [],
    plannedCurrencies: ["ADA", "USDC"],
    saleGuard: "Not deployed. It would reuse the same freshness guard against the uptime oracle.",
    buy: null,
    quote: { href: "/cover#quote", label: "Price SLA cover" },
    blocker: "No uptime oracle and no SLA pool are deployed, so SLA cover cannot be bought, on testnet or anywhere else.",
    related: [
      { href: "/docs/how-cover-works#products", label: "Product lines" },
      { href: "/docs/pricing", label: "Pricing" },
    ],
  },
};

/** Catalog order: live first, then priced, then planned (stable within a status). */
export const PRODUCT_ORDER: readonly ProductId[] = ["depeg", "exploit", "sla"];

export const STATUS_LABEL: Record<ProductStatus, string> = {
  live: "Live on testnet",
  priced: "Priced, not buyable",
  planned: "Planned",
};

export const productsByStatus = (status: ProductStatus): Product[] =>
  PRODUCT_ORDER.map((id) => PRODUCTS[id]).filter((p) => p.status === status);

/** True only for products a wallet can buy today (a deployed pool and a buy link). */
export const isBuyable = (id: ProductId): boolean => PRODUCTS[id].status === "live" && PRODUCTS[id].buy !== null;

export const RISK_MULTIPLIER: Record<RiskTier, number> = { A: 0.8, B: 1.0, C: 1.5 };
