import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { StatusBoard } from "@/components/status/StatusBoard";
import { ProofStrip, RoadmapStrip } from "@/components/status/StatusRecord";
import { Badge } from "@/components/ui/Badge";

export const metadata: Metadata = {
  title: "Status",
  description:
    "Is PlutusShield healthy right now? Depeg cover sales, both underwriting pools on Cardano Preview, and the Midnight Preprod policy registry, each read live in your browser, plus the roadmap and test record. Testnet only, not audited.",
  openGraph: {
    title: "Status · PlutusShield",
    description: "Live health of PlutusShield on Cardano Preview and Midnight Preprod: cover sales, pools, the Midnight registry, roadmap and tests.",
    url: "https://kshot3000.github.io/PlutusShield/status/",
    type: "website",
  },
};

export default function StatusPage() {
  return (
    <AppShell
      active="app"
      title="Status"
      description="Whether cover can be bought, how much capital backs it, and what the Midnight registry has recorded, read from Cardano Preview and Midnight Preprod as you load this page."
    >
      <StatusBoard />

      <div className="mt-6 grid gap-6">
        <RoadmapStrip />
        <ProofStrip />
      </div>

      <section className="card-surface mt-6 p-6 sm:p-8" aria-labelledby="status-trust">
        <div className="flex flex-wrap gap-2">
          <Badge variant="gold">Honest status</Badge>
          <Badge>Not audited</Badge>
        </div>
        <h2 id="status-trust" className="mt-4 font-display text-[1.6rem] leading-tight text-text">
          What &ldquo;up&rdquo; means here
        </h2>
        <p className="mt-2 max-w-3xl text-[13.5px] leading-relaxed text-text-muted">
          Everything on this page runs on testnets with test value. One PlutusShield relay signs all three oracle feeds and the
          three assessor seats are team-run, so the quorums are enforced by the validators but not yet independent in practice.
          Read the{" "}
          <Link href="/docs/risks" className="text-accent hover:underline">
            risks &amp; disclosures
          </Link>{" "}
          before relying on any of it.
        </p>
      </section>
    </AppShell>
  );
}
