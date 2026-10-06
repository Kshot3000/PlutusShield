import { PRODUCTS, RISK_MULTIPLIER, type ProductId, type RiskTier } from "./products.ts";

export interface PoolState {
  /** Capital in the policy's currency tranche (whole ADA or whole USDC). */
  capital: number;
  /** Capital already locked against active cover. */
  activeCover: number;
}

export interface QuoteInput {
  product: ProductId;
  coverAmount: number;
  days: number;
  riskTier: RiskTier;
  /** Pool tranche the policy draws on, in the policy's currency (ADA or USDC units). */
  pool: PoolState;
  /** Premium floor in the policy's currency. Defaults to MIN_PREMIUM (5 units). */
  minPremium?: number;
}

export interface QuoteBreakdown {
  baseAnnualRate: number;
  riskMultiplier: number;
  utilizationBefore: number;
  utilizationAfter: number;
  utilizationMultiplier: number;
  annualRate: number;
}

export type QuoteResult =
  | { ok: true; premium: number; annualRate: number; breakdown: QuoteBreakdown }
  | { ok: false; reason: string };

/** Utilization kink: past this point, pricing steepens to protect solvency. */
export const UTILIZATION_KINK = 0.7;
/** Cover can never push pool utilization above this. */
export const MAX_UTILIZATION = 0.9;
/** One policy can take at most this share of total pool capital. */
export const MAX_SINGLE_POLICY_SHARE = 0.1;
export const MIN_PREMIUM = 5;

/**
 * Kinked utilization curve (same idea as lending-market rate models):
 * gentle slope to the kink, then steep, so the last units of capacity are expensive.
 */
export function utilizationMultiplier(u: number): number {
  const clamped = Math.min(Math.max(u, 0), 1);
  if (clamped <= UTILIZATION_KINK) return 1 + 0.25 * (clamped / UTILIZATION_KINK);
  return 1.25 + 1.5 * ((clamped - UTILIZATION_KINK) / (1 - UTILIZATION_KINK));
}

export function quote(input: QuoteInput): QuoteResult {
  const product = PRODUCTS[input.product];
  if (!product) return { ok: false, reason: "Unknown product" };
  const { coverAmount, days, pool } = input;
  if (!(coverAmount > 0)) return { ok: false, reason: "Cover amount must be positive" };
  if (!Number.isInteger(days) || days < product.minDays || days > product.maxDays)
    return { ok: false, reason: `Term must be ${product.minDays}–${product.maxDays} days` };
  if (!(pool.capital > 0)) return { ok: false, reason: "Pool has no capital" };
  if (coverAmount > pool.capital * MAX_SINGLE_POLICY_SHARE)
    return { ok: false, reason: "Exceeds single-policy cap (10% of pool capital)" };

  const utilizationBefore = pool.activeCover / pool.capital;
  const utilizationAfter = (pool.activeCover + coverAmount) / pool.capital;
  if (utilizationAfter > MAX_UTILIZATION)
    return { ok: false, reason: "Pool capacity reached (90% utilization cap)" };

  // Price on the average utilization across the policy's own capacity draw.
  const uMult = (utilizationMultiplier(utilizationBefore) + utilizationMultiplier(utilizationAfter)) / 2;
  const riskMultiplier = RISK_MULTIPLIER[input.riskTier];
  const annualRate = product.baseAnnualRate * riskMultiplier * uMult;
  const premium = Math.max(input.minPremium ?? MIN_PREMIUM, coverAmount * annualRate * (days / 365));

  return {
    ok: true,
    premium: round2(premium),
    annualRate,
    breakdown: {
      baseAnnualRate: product.baseAnnualRate,
      riskMultiplier,
      utilizationBefore,
      utilizationAfter,
      utilizationMultiplier: uMult,
      annualRate,
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
