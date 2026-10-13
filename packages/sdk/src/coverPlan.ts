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
/** Currency the planner prices a shared portfolio in (matches /plan UI). */
export type PlanCurrency = "ADA" | "USDC";

export interface PlanShareExposure {
  label: string;
  product: ProductId;
  /** Value at risk in the tranche currency. */
  amount: number;
  /** Percent of the amount to protect, 1–100. */
  protectPct: number;
}

/** Portable planner inputs: enough to rebuild /plan from a deep link. */
export interface PlanShareState {
  currency: PlanCurrency;
  days: number;
  exposures: PlanShareExposure[];
}

export type PlanShareResult =
  | { ok: true; state: PlanShareState }
  | { ok: false; reason: string };

/** Matches the /plan UI cap so a share URL never encodes more than the page can edit. */
export const PLAN_SHARE_MAX_EXPOSURES = 8;
export const PLAN_SHARE_CURRENCIES = ["ADA", "USDC"] as const;
export const PLAN_SHARE_DEFAULTS: PlanShareState = { currency: "ADA", days: 90, exposures: [] };

const FIELD = "|";
const PRODUCTS_OK = new Set<ProductId>(["depeg", "exploit", "sla"]);

const isCurrency = (c: string): c is PlanCurrency => (PLAN_SHARE_CURRENCIES as readonly string[]).includes(c);

/** One exposure → `label|product|amount|protectPct` (label may contain `|`; we split from the right). */
const encodeExposure = (e: PlanShareExposure): string =>
  [e.label, e.product, String(e.amount), String(e.protectPct)].join(FIELD);

const decodeExposure = (raw: string): PlanShareExposure | string => {
  const parts = raw.split(FIELD);
  if (parts.length < 4) return "each x must be label|product|amount|protectPct";
  const protectRaw = parts.pop()!;
  const amountRaw = parts.pop()!;
  const productRaw = parts.pop()!;
  const label = parts.join(FIELD);
  const product = productRaw as ProductId;
  if (!PRODUCTS_OK.has(product)) return `unknown product ${productRaw}`;
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || !(amount > 0)) return "exposure amount must be a positive number";
  const protectPct = Number(protectRaw);
  if (!Number.isInteger(protectPct) || protectPct < 1 || protectPct > 100) return "protectPct must be an integer 1–100";
  return { label, product, amount, protectPct };
};

/** Turn a plan into URLSearchParams: `c`, `d`, and one `x` per exposure. */
export function encodePlanShare(state: PlanShareState): URLSearchParams {
  if (!isCurrency(state.currency)) throw new Error(`plan share: currency must be ADA or USDC`);
  if (!Number.isInteger(state.days) || state.days <= 0) throw new Error("plan share: days must be a positive integer");
  if (state.exposures.length > PLAN_SHARE_MAX_EXPOSURES) {
    throw new Error(`plan share: at most ${PLAN_SHARE_MAX_EXPOSURES} exposures`);
  }
  const p = new URLSearchParams();
  p.set("c", state.currency);
  p.set("d", String(state.days));
  for (const e of state.exposures) {
    if (!PRODUCTS_OK.has(e.product)) throw new Error(`plan share: unknown product ${e.product}`);
    if (!Number.isFinite(e.amount) || !(e.amount > 0)) throw new Error("plan share: amount must be positive");
    if (!Number.isInteger(e.protectPct) || e.protectPct < 1 || e.protectPct > 100) {
      throw new Error("plan share: protectPct must be an integer 1–100");
    }
    p.append("x", encodeExposure(e));
  }
  return p;
}

/** Query string without a leading `?`, suitable for `/plan/?${planShareQuery(state)}`. */
export const planShareQuery = (state: PlanShareState): string => encodePlanShare(state).toString();

type ParamSource = URLSearchParams | string | Record<string, string | string[] | undefined | null>;

const asParams = (input: ParamSource): URLSearchParams => {
  if (input instanceof URLSearchParams) return input;
  if (typeof input === "string") {
    const s = input.startsWith("?") ? input.slice(1) : input;
    return new URLSearchParams(s);
  }
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(input)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
    else p.set(k, v);
  }
  return p;
};

/**
 * Restore a plan from share query params. Missing `c` / `d` fall back to ADA / 90;
 * unknown keys are ignored. Malformed currency, days or any `x` fails closed.
 */
export function decodePlanShare(input: ParamSource): PlanShareResult {
  const p = asParams(input);
  const cRaw = p.get("c");
  const currency: PlanCurrency = cRaw === null || cRaw === "" ? PLAN_SHARE_DEFAULTS.currency : (cRaw as PlanCurrency);
  if (!isCurrency(currency)) return { ok: false, reason: `currency must be ADA or USDC, got ${cRaw}` };
  const dRaw = p.get("d");
  let days = PLAN_SHARE_DEFAULTS.days;
  if (dRaw !== null && dRaw !== "") {
    days = Number(dRaw);
    if (!Number.isInteger(days) || days <= 0) return { ok: false, reason: "days must be a positive integer" };
  }
  const xs = p.getAll("x");
  if (xs.length > PLAN_SHARE_MAX_EXPOSURES) {
    return { ok: false, reason: `at most ${PLAN_SHARE_MAX_EXPOSURES} exposures` };
  }
  const exposures: PlanShareExposure[] = [];
  for (const raw of xs) {
    const e = decodeExposure(raw);
    if (typeof e === "string") return { ok: false, reason: e };
    exposures.push(e);
  }
  return { ok: true, state: { currency, days, exposures } };
}
