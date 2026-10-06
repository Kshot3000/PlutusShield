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
    detail: "Compact contract with private holder proofs, claims, and key rotation. 18 simulation tests pass.",
    state: "done",
  },
  {
    label: "Preview pool deployment",
    detail: "Keys are generated and the plan dry run is verified. Next: fund the deployer from the testnet faucet, then init the pool.",
    state: "next",
  },
  {
    label: "Browser buy & deposit",
    detail: "CIP-30 wallet flow on /cover and /pool, priced against live tranche data.",
    state: "planned",
  },
  {
    label: "Production oracle feeds",
    detail: "Independent operators behind the quorum (for example Charli3 or Orcfax adapters).",
    state: "planned",
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
