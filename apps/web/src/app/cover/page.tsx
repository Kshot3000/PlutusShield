import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { QuoteCalculator } from "@/components/cover/QuoteCalculator";

export const metadata: Metadata = {
  title: "Cover",
  description: "Quote PlutusShield stablecoin depeg cover in ADA or USDC, plus model quotes for exploit and SLA cover.",
};

export default function CoverPage() {
  return (
    <AppShell
      active="cover"
      title="Cover"
      description="Price stablecoin depeg cover in ADA or USDC and see exactly what the validator would accept: premium, waiting period, and payout. Purchases open on Cardano Preview once the pool is deployed."
    >
      <QuoteCalculator />
    </AppShell>
  );
}
