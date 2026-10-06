import type { Metadata } from "next";
import {
  AppShell,
  ComingSoonPanel,
  PlaceholderMetric,
} from "@/components/AppShell";

export const metadata: Metadata = {
  title: "App",
  description: "PlutusShield dApp shell — design preview. Wallet connect and quotes coming soon.",
};

export default function AppPage() {
  return (
    <AppShell
      active="app"
      title="App shell"
      description="Wallet connect, quotes, and policy management will live here. This is a design preview — no live pools or policies yet."
    >
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <PlaceholderMetric label="Connected wallet" hint="CIP-30 / Lace — soon" />
        <PlaceholderMetric label="Open policies" />
        <PlaceholderMetric label="Pending claims" />
      </div>
      <ComingSoonPanel
        title="dApp surface under construction"
        body="MVP path: connect wallet → quote parametric depeg cover → buy on Cardano → optional Midnight policy commitment. Nothing is live yet."
      />
    </AppShell>
  );
}
