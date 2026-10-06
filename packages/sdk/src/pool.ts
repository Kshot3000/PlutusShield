/**
 * Underwriting pool ledger for PlutusShield on Cardano.
 *
 * An exact bigint mirror of the pool spend rules in
 * contracts/cardano/validators/cover.ak (Deposit, Withdraw, Buy, Settle,
 * Expire). Every function returns the next pool state the validator would
 * accept, or the reason it would reject the transaction. The dApp uses this
 * to preview LP actions before building a transaction, so what the UI shows
 * is what the chain enforces.
 *
 * Multi-asset: the pool UTxO carries one tranche per accepted asset
 * (`CoverParams.assets`, e.g. [ada, USDCx]). Each tranche is an independent
 * `PoolLedger` in that asset's base units; `PoolBook` bundles them and maps
 * 1:1 onto the on-chain `PoolDatum { tranches }`. The single-ledger
 * functions below are exactly the per-tranche rules the validator applies.
 *
 * Amounts are base units (lovelace or a stablecoin's smallest unit).
 */
import {
  BPS,
  premiumTerms,
  requiredPremium,
  sameAsset,
  trancheOf,
  withinCapacity,
  type AssetClass,
  type AssetTerms,
  type PoolDatum,
  type ProductTerms,
} from "./cardano.ts";
import { PRODUCTS, RISK_MULTIPLIER, type ProductId, type RiskTier } from "./products.ts";
import { MAX_UTILIZATION, utilizationMultiplier } from "./quote.ts";

export interface PoolLedger {
  /** Quantity of this tranche's asset held by the pool UTxO (ada: all its lovelace). */
  capital: bigint;
  /** LP shares outstanding (PoolDatum.total_shares). */
  totalShares: bigint;
  /** Sum of coverage over live policies (PoolDatum.active_cover). */
  activeCover: bigint;
}

export type Step<T> = ({ ok: true; pool: PoolLedger } & T) | { ok: false; reason: string };

export const EMPTY_POOL: PoolLedger = { capital: 0n, totalShares: 0n, activeCover: 0n };

const fail = (reason: string) => ({ ok: false as const, reason });

/** Utilization in bps (active cover / capital), 0 for an empty pool. */
export const utilizationBps = (p: PoolLedger): bigint =>
  p.capital > 0n ? (p.activeCover * BPS) / p.capital : 0n;

/** Smallest capital that still backs active cover at `maxUtilizationBps` (the capital lock). */
export function lockedCapital(p: PoolLedger, maxUtilizationBps: bigint): bigint {
  if (p.activeCover === 0n) return 0n;
  const n = p.activeCover * BPS;
  return (n + maxUtilizationBps - 1n) / maxUtilizationBps;
}

/** `Deposit`: shares minted = amount into an empty pool, else amount * totalShares / capital (floored). */
export function deposit(p: PoolLedger, amount: bigint): Step<{ shares: bigint }> {
  if (amount <= 0n) return fail("Deposit must be positive");
  let shares: bigint;
  if (p.totalShares === 0n) shares = amount;
  else {
    if (p.capital <= 0n) return fail("Pool has shares but no capital");
    shares = (amount * p.totalShares) / p.capital;
  }
  if (shares <= 0n) return fail("Deposit too small to mint a share");
  return {
    ok: true,
    shares,
    pool: { capital: p.capital + amount, totalShares: p.totalShares + shares, activeCover: p.activeCover },
  };
}

/** Pool asset a given number of shares redeems for (floored, as on-chain). */
export const shareValue = (p: PoolLedger, shares: bigint): bigint =>
  p.totalShares > 0n ? (shares * p.capital) / p.totalShares : 0n;

/** `Withdraw { shares }`: burns shares, pays shares * capital / totalShares, enforces the capital lock. */
export function withdraw(
  p: PoolLedger,
  shares: bigint,
  maxUtilizationBps: bigint,
): Step<{ payout: bigint }> {
  if (shares <= 0n || shares > p.totalShares) return fail("Share amount out of range");
  const payout = shareValue(p, shares);
  const capital = p.capital - payout;
  if (p.activeCover * BPS > capital * maxUtilizationBps)
    return fail("Capital lock: remaining capital must still back active cover");
  return {
    ok: true,
    payout,
    pool: { capital, totalShares: p.totalShares - shares, activeCover: p.activeCover },
  };
}

/** Largest share burn the capital lock allows right now (capped at `held`). */
export function maxWithdrawableShares(p: PoolLedger, maxUtilizationBps: bigint, held = p.totalShares): bigint {
  if (p.totalShares === 0n || p.capital === 0n) return 0n;
  const free = p.capital - lockedCapital(p, maxUtilizationBps);
  if (free < 0n) return 0n;
  // floor(s * C / T) <= free  <=>  s <= ((free + 1) * T - 1) / C
  const s = ((free + 1n) * p.totalShares - 1n) / p.capital;
  const cap = held < p.totalShares ? held : p.totalShares;
  return s < cap ? s : cap;
}

/**
 * `Buy` on the policy's tranche: capacity caps, premium floor (with that
 * asset's `minPremium`), then capital += premium and activeCover += coverage.
 */
export function buy(
  p: PoolLedger,
  terms: ProductTerms,
  asset: Pick<AssetTerms, "minPremium">,
  coverage: bigint,
  days: bigint,
  premium?: bigint,
): Step<{ premium: bigint }> {
  if (coverage <= 0n) return fail("Coverage must be positive");
  if (days < terms.minDays || days > terms.maxDays)
    return fail(`Term must be ${terms.minDays}–${terms.maxDays} days`);
  if (!withinCapacity(terms, coverage, p.capital, p.activeCover))
    return fail("Exceeds pool capacity (single-policy or utilization cap)");
  const floor = requiredPremium(
    { baseRateBps: terms.baseRateBps, riskMultBps: terms.riskMultBps, minPremium: asset.minPremium },
    coverage,
    days,
    p.capital,
    p.activeCover,
  );
  const paid = premium ?? floor;
  if (paid < floor) return fail("Premium below the validator's floor");
  return {
    ok: true,
    premium: paid,
    pool: { capital: p.capital + paid, totalShares: p.totalShares, activeCover: p.activeCover + coverage },
  };
}

/** `Settle`: a triggered policy pays exactly its coverage, once. */
export function settle(p: PoolLedger, coverage: bigint): Step<{ payout: bigint }> {
  if (coverage <= 0n || coverage > p.activeCover) return fail("Unknown or already-settled policy");
  if (coverage > p.capital) return fail("Pool cannot cover the claim");
  return {
    ok: true,
    payout: coverage,
    pool: { capital: p.capital - coverage, totalShares: p.totalShares, activeCover: p.activeCover - coverage },
  };
}

/** `Expire`: an unclaimed policy releases its capacity; capital is unchanged. */
export function expire(p: PoolLedger, coverage: bigint): Step<object> {
  if (coverage <= 0n || coverage > p.activeCover) return fail("Unknown or already-closed policy");
  return { ok: true, pool: { ...p, activeCover: p.activeCover - coverage } };
}

// ------------------------------------------------------------- multi-asset book

/** The whole pool UTxO: accepted assets (from params) and one ledger per tranche. */
export interface PoolBook {
  assets: AssetTerms[];
  tranches: PoolLedger[];
}

export type BookStep<T> = ({ ok: true; book: PoolBook; tranche: number } & T) | { ok: false; reason: string };

export const emptyBook = (assets: AssetTerms[]): PoolBook => ({ assets, tranches: assets.map(() => ({ ...EMPTY_POOL })) });

/** On-chain datum for a book (capital is not in the datum; it is the UTxO value). */
export const bookDatum = (b: PoolBook): PoolDatum => ({
  tranches: b.tranches.map((t) => ({ totalShares: t.totalShares, activeCover: t.activeCover })),
});

/** Run a single-tranche step on tranche `i`, leaving every other tranche untouched (as the validator requires). */
function onTranche<T extends object>(b: PoolBook, i: number, f: (p: PoolLedger) => Step<T>): BookStep<T> {
  const t = b.tranches[i];
  if (!t) return fail(`Unknown tranche ${i}`);
  const r = f(t);
  if (!r.ok) return r;
  const { pool, ...rest } = r;
  const tranches = b.tranches.map((x, j) => (j === i ? pool : x));
  return { ...(rest as T), ok: true, tranche: i, book: { ...b, tranches } };
}

const indexOf = (b: PoolBook, asset: AssetClass): number => b.assets.findIndex((a) => sameAsset(a.asset, asset));

export const bookDeposit = (b: PoolBook, asset: AssetClass, amount: bigint) =>
  onTranche(b, indexOf(b, asset), (p) => deposit(p, amount));

export const bookWithdraw = (b: PoolBook, asset: AssetClass, shares: bigint, terms: ProductTerms) =>
  onTranche(b, indexOf(b, asset), (p) => withdraw(p, shares, terms.maxUtilizationBps));

/** Buy a policy denominated in `asset`: priced and capped against that tranche only. */
export function bookBuy(
  b: PoolBook,
  terms: ProductTerms,
  asset: AssetClass,
  coverage: bigint,
  days: bigint,
  premium?: bigint,
): BookStep<{ premium: bigint }> {
  const i = indexOf(b, asset);
  if (i < 0) return fail("Asset not accepted by this pool");
  return onTranche(b, i, (p) => buy(p, terms, b.assets[i], coverage, days, premium));
}

export const bookSettle = (b: PoolBook, asset: AssetClass, coverage: bigint) =>
  onTranche(b, indexOf(b, asset), (p) => settle(p, coverage));

export const bookExpire = (b: PoolBook, asset: AssetClass, coverage: bigint) =>
  onTranche(b, indexOf(b, asset), (p) => expire(p, coverage));

/** Validator floor for a policy in `asset` against the book (same as `requiredPremium` on its tranche). */
export function bookRequiredPremium(b: PoolBook, terms: ProductTerms, asset: AssetClass, coverage: bigint, days: bigint) {
  const i = trancheOf(b.assets, asset);
  const t = b.tranches[i];
  return requiredPremium(premiumTerms(terms, b.assets[i]), coverage, days, t.capital, t.activeCover);
}

// ------------------------------------------------------------- LP projection

export interface UnderwriterInput {
  product: ProductId;
  riskTier: RiskTier;
  /** Pool before the deposit (quote units, e.g. ADA). */
  pool: { capital: number; activeCover: number };
  deposit: number;
  /** Steady-state utilization assumed over the horizon (0..MAX_UTILIZATION). */
  utilization: number;
  /** Share of active cover that pays out over the horizon (0..1), the stress scenario. */
  claimRate: number;
  horizonDays: number;
}

export interface UnderwriterProjection {
  ownership: number;
  premiumIncome: number;
  claimLoss: number;
  net: number;
  premiumApr: number;
  netApr: number;
  /** Claim rate at which the LP's premium income is wiped out. */
  breakEvenClaimRate: number;
}

/**
 * Illustrative LP economics: premiums accrue on active cover at the model's
 * annual rate for the assumed utilization; claims hit capital pro rata.
 * This is a model, not a forecast. Real income depends on demand.
 */
export function underwriterProjection(i: UnderwriterInput): UnderwriterProjection {
  const capital = i.pool.capital + i.deposit;
  const ownership = capital > 0 ? i.deposit / capital : 0;
  const u = Math.min(Math.max(i.utilization, 0), MAX_UTILIZATION);
  const claimRate = Math.min(Math.max(i.claimRate, 0), 1);
  const rate = PRODUCTS[i.product].baseAnnualRate * RISK_MULTIPLIER[i.riskTier] * utilizationMultiplier(u);
  const activeCover = capital * u;
  const years = i.horizonDays / 365;
  const poolPremium = activeCover * rate * years;
  const poolLoss = activeCover * claimRate;
  const premiumIncome = poolPremium * ownership;
  const claimLoss = poolLoss * ownership;
  const net = premiumIncome - claimLoss;
  const annualize = (x: number) => (i.deposit > 0 && years > 0 ? x / i.deposit / years : 0);
  return {
    ownership,
    premiumIncome,
    claimLoss,
    net,
    premiumApr: annualize(premiumIncome),
    netApr: annualize(net),
    breakEvenClaimRate: rate * years,
  };
}
