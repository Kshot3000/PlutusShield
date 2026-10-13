import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { QuoteCalculator } from "@/components/cover/QuoteCalculator";
import { LiveCover } from "@/components/cover/LiveCover";
import { ExploitPayout } from "@/components/claim/ExploitPayout";

export const metadata: Metadata = {
  title: "Cover",
  description: "Buy PlutusShield stablecoin depeg and smart-contract exploit cover on Cardano Preview with a CIP-30 wallet, paying in ADA or USDC, and track your policies.",
};

export default function CoverPage() {
  return (
    <AppShell
      active="cover"
      title="Cover"
      description="Buy stablecoin depeg or smart-contract exploit cover on Cardano Preview, paying in ADA or USDC from your own wallet. The premium is exactly what the validator enforces, the oracle peg check runs before you sign, and every policy you hold, depeg or exploit, shows up in My policies below."
    >
      <LiveCover />
      <div className="mb-10">
        <ExploitPayout compact />
      </div>
      <section id="quote" aria-labelledby="model-title" className="scroll-mt-24">
        <h2 id="model-title" className="font-display text-2xl text-text sm:text-3xl">Model any cover</h2>
        <p className="mb-6 mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">
          Price exploit and SLA cover too, or try other risk tiers and pool sizes. This calculator uses example tranches, not the live pool.
          Covering several positions at once? The{" "}
          <Link href="/plan" className="text-text underline underline-offset-4 hover:text-cardano">
            cover planner
          </Link>{" "}
          prices a whole portfolio against the live pools. SLA cover is priced here but not for sale yet; see{" "}
          <Link href="/products" className="text-text underline underline-offset-4 hover:text-cardano">
            all cover products
          </Link>
          .
        </p>
        <QuoteCalculator />
      </section>
    </AppShell>
  );
}
