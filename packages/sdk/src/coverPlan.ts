/**
 * Cover planner: turn a list of on-chain exposures into the set of PlutusShield
 * policies that would protect them, priced by the same quote engine and held to
 * the same pool limits the validators and /cover enforce.
 *
 * - Each exposure maps to one product (depeg or exploit; SLA is quote-only).
 * - One policy can take at most MAX_SINGLE_POLICY_SHARE of the tranche's capital,
 *   so a large exposure is split into several policies.
 * - Policies draw on a shared tranche: each one raises utilization for the next,
 *   so later policies price higher, and nothing is planned past MAX_UTILIZATION.
 * - Whatever the pool cannot take is reported as uncovered, never hidden.
 *
 * Amounts are in the tranche's own currency (whole ADA or whole USDC), the unit a
 * policy is both paid for and paid out in. Model assumptions, not an offer.
 */
import { MAX_SINGLE_POLICY_SHARE, MAX_UTILIZATION, quote, type PoolState } from "./quote.ts";
import { PRODUCTS, isBuyable, type ProductId, type RiskTier } from "./products.ts";

export interface Exposure {
  id: string;
  /** What the holder calls it ("USDM in wallet", "Minswap LP"). */
  label: string;
  product: ProductId;
  /** Value at risk, in the tranche currency. */
  amount: number;
  /** Share of the amount to protect, 0–1. Defaults to 1. */
  protectShare?: number;
}

export interface PlanInput {
  exposures: Exposure[];
  days: number;
  riskTier: RiskTier;
  /** Tranche each product draws on (same currency for all). null = no pool deployed. */
  pools: Partial<Record<ProductId, PoolState | null>>;
  minPremium?: number;
}

export interface PlannedPolicy {
  exposureId: string;
  product: ProductId;
  coverAmount: number;
  premium: number;
  annualRate: number;
  utilizationAfter: number;
}

export type ExposureStatus = "covered" | "partial" | "not-buyable" | "no-capacity" | "invalid";

export interface ExposurePlan {
  exposure: Exposure;
  target: number;
  covered: number;
  uncovered: number;
  premium: number;
  status: ExposureStatus;
  policies: PlannedPolicy[];
  /** Plain-language reason for anything short of full cover. */
  note: string | null;
}

export interface CoverPlan {
  ok: boolean;
  reason: string | null;
  exposures: ExposurePlan[];
  policies: PlannedPolicy[];
  totals: {
    atRisk: number;
    target: number;
    covered: number;
    uncovered: number;
    premium: number;
    /** covered / target, 0–1 (1 when there is nothing to cover). */
    coverageRatio: number;
    /** Annualised premium / covered, 0 when nothing is covered. */
    effectiveAnnualRate: number;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Smallest policy worth planning; below this the leftover is reported as uncovered. */
export const MIN_PLANNED_COVER = 1;

export function planCover(input: PlanInput): CoverPlan {
  const { days, riskTier } = input;
  const empty = (reason: string): CoverPlan => ({
    ok: false,
    reason,
    exposures: [],
    policies: [],
    totals: { atRisk: 0, target: 0, covered: 0, uncovered: 0, premium: 0, coverageRatio: 0, effectiveAnnualRate: 0 },
  });
  if (!Number.isInteger(days) || days <= 0) return empty("Term must be a whole number of days");
  const ids = new Set<string>();
  for (const e of input.exposures) {
    if (ids.has(e.id)) return empty(`Duplicate exposure id ${e.id}`);
    ids.add(e.id);
  }

  // Running active cover per product tranche, so each policy prices on the
  // utilization left by the ones planned before it.
  const active = new Map<ProductId, number>();
  const plans: ExposurePlan[] = [];

  for (const exposure of input.exposures) {
    const share = exposure.protectShare ?? 1;
    const base: Omit<ExposurePlan, "status" | "note"> = {
      exposure,
      target: 0,
      covered: 0,
      uncovered: 0,
      premium: 0,
      policies: [],
    };
    if (!(exposure.amount > 0) || !(share > 0 && share <= 1)) {
      plans.push({ ...base, status: "invalid", note: "Amount must be positive and the protected share between 0 and 100%" });
      continue;
    }
    const target = round2(exposure.amount * share);
    const product = PRODUCTS[exposure.product];
    if (!product || !isBuyable(exposure.product)) {
      plans.push({
        ...base,
        target,
        uncovered: target,
        status: "not-buyable",
        note: product?.blocker ?? "Unknown product",
      });
      continue;
    }
    if (days < product.minDays || days > product.maxDays) {
      plans.push({
        ...base,
        target,
        uncovered: target,
        status: "invalid",
        note: `${product.name} terms run ${product.minDays}–${product.maxDays} days`,
      });
      continue;
    }
    const pool = input.pools[exposure.product];
    if (!pool || !(pool.capital > 0)) {
      plans.push({ ...base, target, uncovered: target, status: "no-capacity", note: "No live pool capital for this product" });
      continue;
    }

    const maxSingle = pool.capital * MAX_SINGLE_POLICY_SHARE;
    let remaining = target;
    const policies: PlannedPolicy[] = [];
    let premium = 0;
    let used = active.get(exposure.product) ?? pool.activeCover;
    // Bounded: each pass plans at least MIN_PLANNED_COVER or stops.
    for (let guard = 0; guard < 1000 && remaining >= MIN_PLANNED_COVER; guard++) {
      const room = pool.capital * MAX_UTILIZATION - used;
      // Floor to cents so float noise never tips a policy over a cap.
      const size = Math.floor(Math.min(remaining, maxSingle, room) * 100) / 100;
      if (size < MIN_PLANNED_COVER) break;
      const q = quote({
        product: exposure.product,
        coverAmount: size,
        days,
        riskTier,
        pool: { capital: pool.capital, activeCover: used },
        minPremium: input.minPremium,
      });
      if (!q.ok) break;
      policies.push({
        exposureId: exposure.id,
        product: exposure.product,
        coverAmount: size,
        premium: q.premium,
        annualRate: q.annualRate,
        utilizationAfter: q.breakdown.utilizationAfter,
      });
      premium += q.premium;
      used += size;
      remaining = round2(remaining - size);
    }
    active.set(exposure.product, used);
    const covered = round2(target - remaining);
    const status: ExposureStatus = covered === 0 ? "no-capacity" : remaining > 0 ? "partial" : "covered";
    const note =
      status === "covered"
        ? policies.length > 1
          ? `Split into ${policies.length} policies: one policy can take at most ${MAX_SINGLE_POLICY_SHARE * 100}% of pool capital`
          : null
        : `The pool can take ${covered} of ${target} before the ${MAX_UTILIZATION * 100}% utilization cap`;
    plans.push({ ...base, target, covered, uncovered: remaining, premium: round2(premium), policies, status, note });
  }

  const policies = plans.flatMap((p) => p.policies);
  const sum = (f: (p: ExposurePlan) => number) => round2(plans.reduce((s, p) => s + f(p), 0));
  const atRisk = sum((p) => (p.status === "invalid" ? 0 : p.exposure.amount));
  const target = sum((p) => p.target);
  const covered = sum((p) => p.covered);
  const premium = sum((p) => p.premium);
  return {
    ok: true,
    reason: null,
    exposures: plans,
    policies,
    totals: {
      atRisk,
      target,
      covered,
      uncovered: round2(target - covered),
      premium,
      coverageRatio: target > 0 ? covered / target : 1,
      effectiveAnnualRate: covered > 0 ? (premium / covered) * (365 / days) : 0,
    },
  };
}
