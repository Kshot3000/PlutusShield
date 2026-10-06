import type { Metadata } from "next";
import {
  AppShell,
  ComingSoonPanel,
  PlaceholderMetric,
} from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Cover",
  description: "Browse and quote PlutusShield cover products — design preview.",
};

export default function CoverPage() {
  return (
    <AppShell
      active="cover"
      title="Cover"
      description="Exploit, parametric, and SLA cover products. Quotes and purchases are not available yet — this is a design preview."
    >
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <PlaceholderMetric label="Products listed" hint="3 types designed" />
        <PlaceholderMetric label="Quote rate" hint="Engine not live" />
        <PlaceholderMetric label="Coverage caps" hint="Coming soon" />
      </div>
      <ComingSoonPanel
        title="Cover marketplace coming soon"
        body="First product target: parametric stablecoin depeg cover on Cardano with multi-oracle triggers. Exploit cover follows with Midnight evidence vaults."
      />
    </AppShell>
  );
}
