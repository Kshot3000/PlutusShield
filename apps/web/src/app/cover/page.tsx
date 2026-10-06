import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { QuoteCalculator } from "@/components/cover/QuoteCalculator";
import { LiveCover } from "@/components/cover/LiveCover";

export const metadata: Metadata = {
  title: "Cover",
  description: "Buy PlutusShield stablecoin depeg cover on Cardano Preview with a CIP-30 wallet, paying in ADA or USDC, and track your policies.",
};

export default function CoverPage() {
  return (
    <AppShell
      active="cover"
      title="Cover"
      description="Buy stablecoin depeg cover on Cardano Preview, paying in ADA or USDC from your own wallet. The premium is exactly what the validator enforces, the oracle peg check runs before you sign, and your policies show up below."
    >
      <LiveCover />
      <section aria-labelledby="model-title">
        <h2 id="model-title" className="font-display text-2xl text-text sm:text-3xl">Model any cover</h2>
        <p className="mb-6 mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">
          Price exploit and SLA cover too, or try other risk tiers and pool sizes. This calculator uses example tranches, not the live pool.
        </p>
        <QuoteCalculator />
      </section>
    </AppShell>
  );
}
