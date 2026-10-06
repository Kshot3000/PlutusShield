import type { Metadata } from "next";
import {
  AppShell,
  ComingSoonPanel,
  PlaceholderMetric,
} from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Pool",
  description: "Underwriting pool for PlutusShield — design preview. No live TVL.",
};

export default function PoolPage() {
  return (
    <AppShell
      active="pool"
      title="Underwriting pool"
      description="Deposit capital, earn premium, and manage exposure caps. No live TVL or deposits — numbers below are placeholders."
    >
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <PlaceholderMetric label="Pool TVL" hint="Not deployed" />
        <PlaceholderMetric label="Utilization" hint="Coming soon" />
        <PlaceholderMetric label="LP share" hint="Coming soon" />
      </div>
      <ComingSoonPanel
        title="Pool capital not open yet"
        body="Underwriting liquidity will settle on Cardano. Individual LP books and concentration can stay private on Midnight with aggregate solvency proofs."
      />
    </AppShell>
  );
}
