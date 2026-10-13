/**
 * Public cover products catalog for /products. Product copy, status, currencies
 * and links come from the SDK's PRODUCTS (the same records the quote engine
 * prices from); the deployed numbers (waiting period, price age, claim grace,
 * pool address, capital) are baked at compile time from the public Preview
 * deployment records and snapshots, the same pattern as /book and /claims.
 * Nothing here is typed by hand twice, and SLA stays quote-only until an
 * uptime oracle exists.
 */
import {
  MAX_SINGLE_POLICY_SHARE,
  MAX_UTILIZATION,
  PRODUCT_ORDER,
  PRODUCTS,
  RISK_MULTIPLIER,
  STATUS_LABEL,
  type Product,
  type ProductId,
} from "@plutusshield/sdk";
import depegDeployment from "@/data/preview-deployment.json";
import { EXPLOIT_PREVIEW } from "@/lib/exploitPreview";
import { PREVIEW } from "@/lib/preview";
import { UNDERWRITING_BOOK, formatBookAmount, type BookEntry } from "@/lib/underwritingBook";

const MIN = 60_000;
const DAY = 86_400_000;

export interface Deployed {
  network: "Cardano Preview";
  /** Midnight network for the private side, when the product uses one on-chain. */
  midnight: string | null;
  address: string;
  waitingMinutes: number;
  /** Healthy-peg reading max age; null when the product has no price guard. */
  maxPriceAgeMinutes: number | null;
  claimGraceDays: number;
  quorum: string;
  /** Live tranches from the build-time pool snapshot (via the underwriting book). */
  capital: { symbol: "ADA" | "USDC"; ticker: string; amount: string; free: string }[];
  /** Anchor on /book for this pool. */
  bookId: BookEntry["id"];
  recordHref: string | null;
}

export interface CatalogEntry {
  product: Product;
  statusLabel: string;
  /** Base rate at tier B (the tier every live pool uses today), percent per year. */
  baseRatePct: number;
  tierRange: string;
  deployed: Deployed | null;
}

const capitalOf = (id: BookEntry["id"]) =>
  (UNDERWRITING_BOOK.entries.find((e) => e.id === id)?.tranches ?? []).map((t) => ({
    symbol: t.symbol,
    ticker: t.ticker,
    amount: formatBookAmount(t.capital, t.decimals, 0),
    free: formatBookAmount(t.freeCapacity, t.decimals, 0),
  }));

const p = depegDeployment.params;

const DEPLOYED: Partial<Record<ProductId, Deployed>> = {
  depeg: {
    network: "Cardano Preview",
    midnight: "Midnight Preprod (policy registry)",
    address: depegDeployment.address,
    waitingMinutes: Number(p.saleGuard.waitingPeriodMs) / MIN,
    maxPriceAgeMinutes: Number(p.saleGuard.maxPriceAgeMs) / MIN,
    claimGraceDays: Number(p.claimGraceMs) / DAY,
    quorum: `${PREVIEW.oracleQuorum} to settle · every feed healthy to sell`,
    capital: capitalOf("usdm-depeg"),
    bookId: "usdm-depeg",
    recordHref: "https://github.com/Kshot3000/PlutusShield/blob/main/contracts/cardano/deploy/deployments/preview.json",
  },
  exploit: {
    network: "Cardano Preview",
    midnight: "Midnight Preprod (evidence + votes)",
    address: EXPLOIT_PREVIEW.address,
    waitingMinutes: EXPLOIT_PREVIEW.waitingMinutes,
    maxPriceAgeMinutes: null,
    claimGraceDays: EXPLOIT_PREVIEW.graceDays,
    quorum: `${EXPLOIT_PREVIEW.quorumLabel} assessor committee`,
    capital: capitalOf("exploit-v2"),
    bookId: "exploit-v2",
    recordHref: EXPLOIT_PREVIEW.record,
  },
};

const pct = (x: number) => Math.round(x * 10_000) / 100;

export const PRODUCTS_CATALOG: CatalogEntry[] = PRODUCT_ORDER.map((id) => {
  const product = PRODUCTS[id];
  const deployed = DEPLOYED[id] ?? null;
  if (product.status === "live" && !deployed) throw new Error(`products catalog: live product ${id} has no deployment record`);
  if (product.status !== "live" && deployed) throw new Error(`products catalog: ${id} is not live but has a deployment record`);
  return {
    product,
    statusLabel: STATUS_LABEL[product.status],
    baseRatePct: pct(product.baseAnnualRate * RISK_MULTIPLIER.B),
    tierRange: `${pct(product.baseAnnualRate * RISK_MULTIPLIER.A)}–${pct(product.baseAnnualRate * RISK_MULTIPLIER.C)}% base across tiers A–C`,
    deployed,
  };
});

export const CATALOG_STATS = {
  total: PRODUCTS_CATALOG.length,
  live: PRODUCTS_CATALOG.filter((e) => e.product.status === "live").length,
  priced: PRODUCTS_CATALOG.filter((e) => e.product.status === "priced").length,
  maxSinglePolicyPct: pct(MAX_SINGLE_POLICY_SHARE),
  maxUtilizationPct: pct(MAX_UTILIZATION),
};
