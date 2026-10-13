import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { UnderwritingBook } from "@/components/book/UnderwritingBook";
import { Badge } from "@/components/ui/Badge";
import { UNDERWRITING_BOOK } from "@/lib/underwritingBook";

const s = UNDERWRITING_BOOK.stats;

export const metadata: Metadata = {
  title: "Underwriting book",
  description: `Open underwriting book for PlutusShield on Cardano Preview: ${s.livePools} live pools at tier ${s.tier} (risk_mult_bps ${s.riskMultBps.toLocaleString("en-US")}), each with the scorecard answers, capital, and InitPool multiplier baked from public deployment records. Testnet only, not audited.`,
  openGraph: {
    title: "Underwriting book · PlutusShield",
    description: `${s.livePools} live Preview pools at tier ${s.tier}: scorecard, capital, and risk_mult_bps from public records.`,
    url: "https://kshot3000.github.io/PlutusShield/book/",
    type: "website",
  },
};

export default function UnderwritingBookPage() {
  return (
    <AppShell
      active="pool"
      title="Underwriting book"
      description="Every live pool's product, open scorecard, capital and risk multiplier — baked from public Cardano Preview records, the same way the claims register is built."
    >
      <UnderwritingBook />

      <section className="card-surface mt-6 p-6 sm:p-8" aria-labelledby="book-reading">
        <div className="flex flex-wrap gap-2">
          <Badge variant="gold">How to read this</Badge>
          <Badge>Testnet only</Badge>
          <Badge>Not audited</Badge>
        </div>
        <h2 id="book-reading" className="mt-4 font-display text-[1.6rem] leading-tight text-text">
          What the book proves, and what it doesn&apos;t
        </h2>
        <div className="mt-4 grid gap-4 text-sm leading-relaxed text-text-muted md:grid-cols-3">
          <p>
            The scorecard answers are PlutusShield&apos;s honest testnet reading of each covered product. They are not a
            public rating of USDM or of any named protocol. Replay them on the{" "}
            <Link href="/docs/risk-tiers" className="text-text underline underline-offset-4 hover:text-cardano">
              interactive scorecard
            </Link>
            .
          </p>
          <p>
            Capital and utilization come from the build-time pool snapshots. For a live read, open{" "}
            <Link href="/pool" className="text-text underline underline-offset-4 hover:text-cardano">
              /pool
            </Link>{" "}
            or{" "}
            <Link href="/status" className="text-text underline underline-offset-4 hover:text-cardano">
              /status
            </Link>
            ; those pages decode the pool UTxO in your browser.
          </p>
          <p>
            The tier is fixed per pool at InitPool as <span className="font-mono text-text">risk_mult_bps</span>. Buyers
            cannot pick a cheaper tier for the same risk. See{" "}
            <Link href="/docs/pricing" className="text-text underline underline-offset-4 hover:text-cardano">
              pricing
            </Link>{" "}
            and the{" "}
            <Link href="/claims" className="text-text underline underline-offset-4 hover:text-cardano">
              claims register
            </Link>{" "}
            for how those pools have paid.
          </p>
        </div>
      </section>
    </AppShell>
  );
}
