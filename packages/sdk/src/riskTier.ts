import { RISK_MULTIPLIER, type RiskTier } from "./products.ts";

/**
 * Underwriting scorecard: how a pool's risk tier is chosen.
 *
 * The tier is not picked by the buyer. It is fixed per pool at InitPool as
 * `risk_mult_bps` in the pool's ProductTerms (both live Preview pools are
 * tier B, 10_000 bps), so every policy sold from that pool pays the same
 * risk multiplier. This rubric is how an underwriter gets from a covered
 * protocol or stablecoin to that tier, transparently and repeatably.
 *
 * The criteria, points and thresholds are PlutusShield's starting
 * underwriting assumptions for testnet, not market data or a rating of any
 * named protocol. Governance is meant to tune them.
 */
export type ScorecardProduct = "depeg" | "exploit";

export interface CriterionOption {
  value: string;
  label: string;
  points: number;
  /** Any selected option with a hardStop declines cover outright. */
  hardStop?: string;
  /** Any selected option with a cap limits the best tier reachable. */
  cap?: { tier: RiskTier; reason: string };
}

export interface Criterion {
  id: string;
  label: string;
  why: string;
  options: CriterionOption[];
}

export const EXPLOIT_CRITERIA: Criterion[] = [
  {
    id: "audits",
    label: "Independent audits of the deployed contracts",
    why: "An audit is the minimum evidence that someone outside the team read the code that holds the funds.",
    options: [
      { value: "none", label: "None", points: 0, hardStop: "No independent audit of the deployed contracts" },
      { value: "one", label: "One audit", points: 2 },
      { value: "two-plus", label: "Two or more audits", points: 3 },
    ],
  },
  {
    id: "time-live",
    label: "Time live on mainnet with user funds",
    why: "Code that has held real value for longer has survived more attack attempts.",
    options: [
      { value: "lt-3m", label: "Under 3 months", points: 0, cap: { tier: "C", reason: "Live for under 3 months" } },
      { value: "3-12m", label: "3–12 months", points: 1 },
      { value: "12-24m", label: "12–24 months", points: 2 },
      { value: "gt-24m", label: "Over 24 months", points: 3 },
    ],
  },
  {
    id: "upgradeability",
    label: "Who can change the contracts",
    why: "An upgrade key is a second way to lose funds: a stolen or misused key can replace the code.",
    options: [
      { value: "admin-key", label: "Single admin key, no timelock", points: 0, cap: { tier: "C", reason: "A single admin key can change the contracts with no timelock" } },
      { value: "multisig-timelock", label: "Multisig or timelocked upgrades", points: 2 },
      { value: "immutable", label: "Immutable scripts", points: 3 },
    ],
  },
  {
    id: "bug-bounty",
    label: "Public bug bounty",
    why: "A funded bounty gives whitehats a reason to report instead of exploit.",
    options: [
      { value: "none", label: "None", points: 0 },
      { value: "public", label: "Public, funded bounty", points: 2 },
    ],
  },
  {
    id: "incidents",
    label: "Past exploits or losses",
    why: "An unresolved loss means the root cause may still be live.",
    options: [
      { value: "unresolved", label: "A loss that is not yet fixed or repaid", points: 0, hardStop: "An unresolved past exploit or loss" },
      { value: "remediated", label: "A past loss, fixed and repaid", points: 1 },
      { value: "none", label: "No known losses", points: 2 },
    ],
  },
  {
    id: "oracle",
    label: "Price oracle dependence",
    why: "A protocol that trusts one price source can be drained by manipulating it.",
    options: [
      { value: "single", label: "Depends on one price source", points: 0, cap: { tier: "B", reason: "Depends on a single price source" } },
      { value: "multi", label: "Multi-source or TWAP oracle", points: 1 },
      { value: "none", label: "No oracle dependence", points: 2 },
    ],
  },
];

export const DEPEG_CRITERIA: Criterion[] = [
  {
    id: "backing",
    label: "What backs the stablecoin",
    why: "Algorithmic designs can enter a death spiral that no reserve stops.",
    options: [
      { value: "algorithmic", label: "Algorithmic or unbacked", points: 0, hardStop: "Algorithmic or unbacked stablecoin" },
      { value: "overcollateralized", label: "Over-collateralized on-chain", points: 2 },
      { value: "fiat-attested", label: "Fiat reserves with published attestations", points: 3 },
    ],
  },
  {
    id: "redemption",
    label: "Redemption at par",
    why: "If holders can redeem at 1.00, arbitrage pulls the price back toward the peg.",
    options: [
      { value: "none", label: "No redemption", points: 0, cap: { tier: "C", reason: "No redemption at par" } },
      { value: "permissioned", label: "Permissioned (KYC) redemption", points: 1 },
      { value: "permissionless", label: "Permissionless redemption", points: 2 },
    ],
  },
  {
    id: "venues",
    label: "Independent price venues with real depth",
    why: "The depeg oracle takes a quorum of independent venues; with fewer than three it cannot settle a claim.",
    options: [
      { value: "lt-3", label: "Fewer than three", points: 0, hardStop: "Fewer than three independent price venues for the oracle quorum" },
      { value: "3", label: "Three", points: 1 },
      { value: "4-plus", label: "Four or more", points: 2 },
    ],
  },
  {
    id: "age",
    label: "Time since launch",
    why: "A longer history shows how the peg behaves under stress.",
    options: [
      { value: "lt-6m", label: "Under 6 months", points: 0, cap: { tier: "C", reason: "Launched under 6 months ago" } },
      { value: "6-24m", label: "6–24 months", points: 1 },
      { value: "gt-24m", label: "Over 24 months", points: 2 },
    ],
  },
  {
    id: "peg-history",
    label: "Past breaks below the 0.95 trigger",
    why: "A peg that broke and never recovered is not insurable at any price.",
    options: [
      { value: "unrecovered", label: "Broke and has not recovered", points: 0, hardStop: "Peg broke below 0.95 and has not recovered" },
      { value: "recovered", label: "Broke, then recovered", points: 1 },
      { value: "never", label: "Never below 0.95", points: 2 },
    ],
  },
];

export const SCORECARD_CRITERIA: Record<ScorecardProduct, Criterion[]> = {
  depeg: DEPEG_CRITERIA,
  exploit: EXPLOIT_CRITERIA,
};

/** Share of the maximum score needed for each tier (before caps). */
export const TIER_THRESHOLDS: { tier: RiskTier; minShare: number }[] = [
  { tier: "A", minShare: 0.8 },
  { tier: "B", minShare: 0.55 },
  { tier: "C", minShare: 0.3 },
];

export type ScorecardAnswers = Record<string, string>;

export type ScorecardResult =
  | {
      ok: true;
      tier: RiskTier;
      /** Tier the points alone would give, before any cap. */
      uncappedTier: RiskTier;
      points: number;
      maxPoints: number;
      share: number;
      riskMultiplier: number;
      riskMultBps: number;
      caps: string[];
    }
  | { ok: false; declined: true; reasons: string[]; points: number; maxPoints: number }
  | { ok: false; declined: false; missing: string[] };

const TIER_ORDER: RiskTier[] = ["A", "B", "C"];
const worse = (a: RiskTier, b: RiskTier): RiskTier => (TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b);

export function maxScorecardPoints(product: ScorecardProduct): number {
  return SCORECARD_CRITERIA[product].reduce((s, c) => s + Math.max(...c.options.map((o) => o.points)), 0);
}

/** Score a protocol or stablecoin and return the pool tier it qualifies for, or why it is declined. */
export function scoreRiskTier(product: ScorecardProduct, answers: ScorecardAnswers): ScorecardResult {
  const criteria = SCORECARD_CRITERIA[product];
  if (!criteria) return { ok: false, declined: false, missing: ["product"] };
  const missing: string[] = [];
  const picked: CriterionOption[] = [];
  for (const c of criteria) {
    const o = c.options.find((x) => x.value === answers[c.id]);
    if (!o) missing.push(c.id);
    else picked.push(o);
  }
  if (missing.length) return { ok: false, declined: false, missing };

  const points = picked.reduce((s, o) => s + o.points, 0);
  const maxPoints = maxScorecardPoints(product);
  const hardStops = picked.flatMap((o) => (o.hardStop ? [o.hardStop] : []));
  if (hardStops.length) return { ok: false, declined: true, reasons: hardStops, points, maxPoints };

  const share = points / maxPoints;
  const band = TIER_THRESHOLDS.find((t) => share >= t.minShare);
  if (!band) {
    return { ok: false, declined: true, reasons: [`Scored ${points} of ${maxPoints}, below the tier C floor`], points, maxPoints };
  }
  let tier = band.tier;
  const caps: string[] = [];
  for (const o of picked) {
    if (o.cap && worse(o.cap.tier, tier) === o.cap.tier && o.cap.tier !== tier) caps.push(`${o.cap.reason} (capped at tier ${o.cap.tier})`);
    if (o.cap) tier = worse(o.cap.tier, tier);
  }
  const riskMultiplier = RISK_MULTIPLIER[tier];
  return {
    ok: true,
    tier,
    uncappedTier: band.tier,
    points,
    maxPoints,
    share,
    riskMultiplier,
    riskMultBps: Math.round(riskMultiplier * 10_000),
    caps,
  };
}
