import { RISK_MULTIPLIER, type RiskTier } from "./products.ts";
import {
  SCORECARD_CRITERIA,
  scoreRiskTier,
  type ScorecardAnswers,
  type ScorecardProduct,
  type ScorecardResult,
} from "./riskTier.ts";

/**
 * The open underwriting book: the concrete scorecard answers that put each
 * live Preview pool at its InitPool risk tier.
 *
 * Capital, addresses and txs live in the web package (deployment records +
 * pool snapshots). This module is pure: answers in, scoreRiskTier out, so the
 * same answers the site shows are what the SDK tests assert.
 *
 * The answers are PlutusShield's honest reading of the covered asset / target
 * for testnet underwriting — not a public rating of USDM or any named protocol.
 */

export interface LiveScorecard {
  /** Matches ScorecardProduct / InitPool product id. */
  product: ScorecardProduct;
  /** Short label used on the book page. */
  label: string;
  /** One-line plain-language why this scorecard lands at the live tier. */
  whyTier: string;
  answers: ScorecardAnswers;
}

/** Scorecard that produced tier B for the live USDM depeg pool (risk_mult_bps 10_000). */
export const LIVE_DEPEG_SCORECARD: LiveScorecard = {
  product: "depeg",
  label: "USDM depeg cover",
  whyTier:
    "Over-collateralized on-chain backing with permissionless redemption and three independent oracle venues, a short but clean peg history, and no hard stop — middling points that clear the B band without reaching A.",
  answers: {
    backing: "overcollateralized",
    redemption: "permissionless",
    venues: "3",
    age: "6-24m",
    "peg-history": "never",
  },
};

/**
 * Scorecard that produced tier B for the live exploit-cover v2 committee pool
 * (and the frozen v1 exploit pool that shares the same product terms).
 * Matches the middling exploit answers already checked in riskTier.test.ts.
 */
export const LIVE_EXPLOIT_SCORECARD: LiveScorecard = {
  product: "exploit",
  label: "Smart-contract exploit cover",
  whyTier:
    "One independent audit, twelve-to-twenty-four months live, multisig or timelocked upgrades, a public bounty, no known losses, and a multi-source oracle — eleven of fifteen points, the same middling band the live Preview exploit pools fix at InitPool.",
  answers: {
    audits: "one",
    "time-live": "12-24m",
    upgradeability: "multisig-timelock",
    "bug-bounty": "public",
    incidents: "none",
    oracle: "multi",
  },
};

export const LIVE_SCORECARDS: Record<ScorecardProduct, LiveScorecard> = {
  depeg: LIVE_DEPEG_SCORECARD,
  exploit: LIVE_EXPLOIT_SCORECARD,
};

/** Score the live-book answers for a product. Always expected to be ok + tier B. */
export function scoreLiveBook(product: ScorecardProduct): ScorecardResult {
  const card = LIVE_SCORECARDS[product];
  return scoreRiskTier(card.product, card.answers);
}

/** Criterion id → chosen option label + points, for a compact read-only breakdown. */
export function liveBookBreakdown(product: ScorecardProduct): {
  id: string;
  label: string;
  answer: string;
  points: number;
  why: string;
}[] {
  const card = LIVE_SCORECARDS[product];
  return SCORECARD_CRITERIA[product].map((c) => {
    const o = c.options.find((x) => x.value === card.answers[c.id]);
    return {
      id: c.id,
      label: c.label,
      answer: o?.label ?? card.answers[c.id] ?? "—",
      points: o?.points ?? 0,
      why: c.why,
    };
  });
}

/** The risk_mult_bps both live Preview pools fix at InitPool (tier B). */
export const LIVE_POOL_RISK_MULT_BPS = Math.round(RISK_MULTIPLIER.B * 10_000);

export const LIVE_POOL_TIER: RiskTier = "B";
