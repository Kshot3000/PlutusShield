import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { UnderwriterSimulator } from "@/components/pool/UnderwriterSimulator";

export const metadata: Metadata = {
  title: "Pool",
  description:
    "Underwrite PlutusShield depeg cover on Cardano: simulate LP shares, premium income, claim stress, and the capital lock.",
};

const rules = [
  {
    title: "Pro-rata shares",
    body: "Deposits mint LP tokens at the current share price. Premiums raise the price; claims lower it. Everyone in the pool shares both equally.",
  },
  {
    title: "Capital lock",
    body: "Active cover can never exceed 90% of capital. Withdrawals that would break that line fail in the validator, so every live policy stays fully backed.",
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
      description="Earn premiums by backing stablecoin depeg cover on Cardano. Simulate your position against an example pool; deposits open on testnet."
    >
      <UnderwriterSimulator />
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {rules.map((r) => (
          <div key={r.title} className="card-surface p-5">
            <p className="text-sm font-semibold text-text">{r.title}</p>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">{r.body}</p>
          </div>
        ))}
      </div>
      <p className="mt-6 text-xs text-text-dim">
        LP books can later move to Midnight so individual positions stay private while the pool
        publishes aggregate solvency proofs.
      </p>
    </AppShell>
  );
}
