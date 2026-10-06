import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { UnderwriterSimulator } from "@/components/pool/UnderwriterSimulator";
import { LivePool } from "@/components/pool/LivePool";
import { ExploitPayout } from "@/components/claim/ExploitPayout";

export const metadata: Metadata = {
  title: "Pool",
  description:
    "Underwrite PlutusShield depeg cover on Cardano: simulate LP shares, premium income, claim stress, and the capital lock.",
};

const rules = [
  {
    title: "Pro-rata shares",
    body: "Deposits mint LP tokens at the current share price. Premiums raise the price and claims lower it. Every LP in the tranche shares both, pro rata.",
  },
  {
    title: "Capital lock",
    body: "Active cover can never exceed 90% of capital. Withdrawals that would break that line fail in the validator, so every live policy stays fully backed.",
  },
  {
    title: "Separate tranches",
    body: "ADA and USDC capital never mix. Each tranche has its own LP token, utilization, and claims, so a USDC payout can't touch ADA LPs.",
  },
  {
    title: "No admin key",
    body: "Pricing, caps, oracle quorum, and claim grace are fixed when the script is parameterised. Nobody can move pool funds outside these rules.",
  },
];

export default function PoolPage() {
  return (
    <AppShell
      active="pool"
      title="Underwriting pool"
      description="Back stablecoin depeg cover in ADA or USDC and earn its premiums. See the live Preview pool on-chain, deposit or withdraw with a signed wallet transaction, then simulate a position with the same share math as the validator, down to the lovelace."
    >
      <LivePool />
      <ExploitPayout compact />
      <UnderwriterSimulator />
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {rules.map((r) => (
          <div key={r.title} className="glass-panel relative rounded-[1.4rem] p-6">
            <p className="text-sm font-semibold text-text">{r.title}</p>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">{r.body}</p>
          </div>
        ))}
      </div>
      <p className="mt-6 text-xs text-text-dim">
        Planned: LP books on Midnight, so individual positions stay private while the pool publishes aggregate
        solvency proofs. Read <Link href="/docs/underwriting-pool" className="text-text-muted underline underline-offset-4 hover:text-text">how the pool works</Link>{" "}
        and the <Link href="/docs/risks#lp-risk" className="text-text-muted underline underline-offset-4 hover:text-text">underwriter risks</Link>.
      </p>
    </AppShell>
  );
}
