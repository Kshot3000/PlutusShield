import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { CoverPlanner } from "@/components/plan/CoverPlanner";

const siteUrl = "https://kshot3000.github.io/PlutusShield";

export const metadata: Metadata = {
  title: "Cover planner",
  description:
    "Plan PlutusShield cover for a whole Cardano DeFi portfolio: list stablecoin and protocol exposures and get the depeg and exploit policies that would protect them, priced against the live Preview pool tranches. Deep-link any portfolio via URL query params. Testnet only, not audited.",
  openGraph: {
    title: "Cover planner · PlutusShield",
    description: "Turn a Cardano DeFi portfolio into a priced set of depeg and exploit policies on the live Preview pools.",
    url: `${siteUrl}/plan/`,
    type: "website",
  },
};

export default function PlanPage() {
  return (
    <AppShell
      active="cover"
      title="Cover planner"
      description="Most people hold more than one thing at risk. List your stablecoin and protocol exposures and the planner builds the set of policies that would protect them on the live Preview pools, splits anything too big for one policy, and tells you plainly what the pools can't take. The URL stays in sync so judges and partners can deep-link a concrete exposure set."
    >
      <CoverPlanner />
      <section className="card-surface mt-6 p-6 sm:p-8" aria-labelledby="plan-how">
        <h2 id="plan-how" className="font-display text-[1.4rem] leading-tight text-text">How the plan is built</h2>
        <div className="mt-4 grid gap-4 text-sm leading-relaxed text-text-muted md:grid-cols-3">
          <p>
            Stablecoin balances map to depeg cover, which pays the full amount if USDM&apos;s 24-hour TWAP stays under $0.95 on
            2 of 3 oracle feeds. Protocol positions map to exploit cover, paid only after 2 of 3 assessors approve sealed
            evidence on Midnight. SLA cover is shown but never planned as a buy, since no uptime oracle exists yet.
          </p>
          <p>
            Every policy is priced with <code className="font-mono text-[12.5px]">quote()</code> from the SDK on the utilization the
            policies before it leave behind, so the plan matches what /cover would quote in that order. The planner itself is{" "}
            <code className="font-mono text-[12.5px]">planCover()</code>; <code className="font-mono text-[12.5px]">encodePlanShare</code> /{" "}
            <code className="font-mono text-[12.5px]">decodePlanShare</code> keep the portfolio in the URL (
            <code className="font-mono text-[12.5px]">c</code>, <code className="font-mono text-[12.5px]">d</code>, repeated{" "}
            <code className="font-mono text-[12.5px]">x</code>).
          </p>
          <p>
            Nothing here reads your wallet or sends anything. Copy the share link above, or read the static example at{" "}
            <Link href="/api/v1/plan.json" className="text-text underline underline-offset-4 hover:text-cardano">/api/v1/plan.json</Link>.
            When you&apos;re ready, buy each policy on{" "}
            <Link href="/cover" className="text-text underline underline-offset-4 hover:text-cardano">/cover</Link>, compare products on{" "}
            <Link href="/products" className="text-text underline underline-offset-4 hover:text-cardano">/products</Link>, or check pool
            capital on the{" "}
            <Link href="/book" className="text-text underline underline-offset-4 hover:text-cardano">underwriting book</Link>.
          </p>
        </div>
      </section>
    </AppShell>
  );
}
