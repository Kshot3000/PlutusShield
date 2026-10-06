import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { QuoteCalculator } from "@/components/cover/QuoteCalculator";

export const metadata: Metadata = {
  title: "Cover",
  description: "Quote PlutusShield depeg, exploit, and SLA cover for Cardano and Midnight.",
};

export default function CoverPage() {
  return (
    <AppShell
      active="cover"
      title="Cover"
      description="Price depeg, exploit, and SLA cover in ADA or USDC (USDCx) with the PlutusShield quote engine. Not live: purchases open on Cardano Preview once the pool is deployed."
    >
      <QuoteCalculator />
    </AppShell>
  );
}
