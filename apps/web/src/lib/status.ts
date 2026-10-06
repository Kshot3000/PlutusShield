/**
 * Single source of truth for launch status shown across the app.
 * Keep it honest: only mark something done when it is on main and tested.
 */
export type MilestoneState = "done" | "next" | "planned";

export interface Milestone {
  label: string;
  detail: string;
  state: MilestoneState;
}

export const REPO = "https://github.com/Kshot3000/PlutusShield";
export const RUNBOOK = `${REPO}/blob/main/contracts/cardano/deploy/README.md`;

export const MILESTONES: Milestone[] = [
  {
    label: "Cardano validators",
    detail: "92 Aiken checks covering ADA + USDC tranches, pricing, the oracle quorum, the sale circuit-breaker, and expiry refunds.",
    state: "done",
  },
  {
    label: "End-to-end emulator run",
    detail: "The applied script handles ADA and USDC buys, refuses a buy during a depeg, settles, expires with a refund, and processes withdrawals.",
    state: "done",
  },
  {
    label: "Midnight policy registry",
    detail: "Deployed on Midnight Preprod. The first Cardano Preview policy is mirrored into the private registry and its holder proved cover on-chain without revealing the amount. 26 simulation tests pass.",
    state: "done",
  },
  {
    label: "Preview pool deployment",
    detail: "Live on Cardano Preview: pool initialised with ADA and tUSDCx tranches, LP deposits and the first ADA and USDC policies on-chain. /pool reads it straight from the ledger.",
    state: "done",
  },
  {
    label: "Browser buy & deposit",
    detail: "Any CIP-30 wallet can buy depeg cover on /cover (premium in tADA or tUSDCx, oracle peg check before signing, My policies) and deposit or withdraw on /pool. Every flow is proven with real Preview transactions.",
    state: "done",
  },
  {
    label: "Exploit claims, end to end",
    detail: "A smart-contract exploit claim runs across both chains: sealed evidence filed and approved on Midnight Preprod, then paid from the Cardano Preview exploit-cover pool by an assessor-signed Settle that names the Midnight resolveClaim tx. First claim paid in full (50 tADA).",
    state: "done",
  },
  {
    label: "Production oracle feeds",
    detail: "Live USDM venues (CoinGecko, Minswap, Kraken) feed a fail-closed publisher that refreshes the Preview peg every 20 minutes. Next: independent oracle operators (for example Charli3 or Orcfax).",
    state: "next",
  },
  {
    label: "External audit",
    detail: "Required before any mainnet capital.",
    state: "planned",
  },
];

/** Defaults the validator is parameterised with (see packages/sdk DEFAULT_SALE_GUARD and the Preview config). */
export const SALE_GUARD = {
  waitingHours: 24,
  previewWaitingMinutes: 60,
  maxPriceAgeHours: 2,
  claimGraceDays: 3,
  refundDepositAda: 2.5,
};
