export type ProductId = "depeg" | "exploit" | "sla";
export type RiskTier = "A" | "B" | "C";

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
}

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
  },
};

export const RISK_MULTIPLIER: Record<RiskTier, number> = { A: 0.8, B: 1.0, C: 1.5 };
