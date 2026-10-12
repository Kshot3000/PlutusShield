import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { OracleLive } from "@/components/oracle/OracleLive";
import { Badge } from "@/components/ui/Badge";

export const metadata: Metadata = {
  title: "Oracle",
  description:
    "The live USDM depeg oracle behind PlutusShield's Cardano Preview cover: each feed's newest 24h TWAP read from chain, whether cover sales are open, and every reading the relay has published, with its transaction. Testnet only, not audited.",
  openGraph: {
    title: "Oracle · PlutusShield",
    description: "Live USDM depeg oracle on Cardano Preview: feed readings, sale circuit-breaker, and the full publish history.",
    url: "https://kshot3000.github.io/PlutusShield/oracle/",
    type: "website",
  },
};

const REPO = "https://github.com/Kshot3000/PlutusShield/blob/main";

const steps = [
  {
    t: "Read three live venues",
    b: "CoinGecko's USDM price, the Minswap ADA/USDM pool read on-chain and priced with Kraken ADA/USD, and the Minswap USDCx/USDM pool. Fewer than two answering venues means nothing is published.",
    src: { href: `${REPO}/services/oracle-relay/src/venues.ts`, label: "venues.ts" },
  },
  {
    t: "Median, then a 24h TWAP",
    b: "The cross-venue median is averaged over 24 hours with the same SDK math the validator mirrors, so one venue spiking or going dark can't move the reading on its own.",
    src: { href: `${REPO}/packages/sdk/src/oracle.ts`, label: "oracle.ts" },
  },
  {
    t: "Publish only a healthy peg",
    b: "A healthy TWAP is written to all three feeds in one transaction, recycling the superseded feed UTxOs. A depeg is never published as healthy: the publisher stops, the readings age out, and sales close on their own.",
    src: { href: `${REPO}/contracts/cardano/deploy/scripts/oracle-publisher.ts`, label: "oracle-publisher.ts" },
  },
  {
    t: "The validator decides",
    b: "A Buy must reference a fresh healthy reading from every feed. A depeg claim pays only when 2 of 3 feeds attest a price under the trigger for the full window, inside the policy's term. Unauthenticated oracle UTxOs are ignored.",
    src: { href: `${REPO}/contracts/cardano/lib/plutusshield/oracle.ak`, label: "oracle.ak" },
  },
];

const related = [
  { href: "/cover", eyebrow: "Uses this oracle", title: "Buy cover", body: "The Buy runs the same sale check in your browser before it asks you to sign." },
  { href: "/claim", eyebrow: "Depeg claims", title: "Claim checker", body: "Quorum, TWAP trigger and claim window against the live feeds." },
  { href: "/docs/risks", eyebrow: "Trust model", title: "Oracle risks", body: "What a dishonest or offline feed can and can't do." },
];

export default function OraclePage() {
  return (
    <AppShell
      active="cover"
      title="Oracle"
      description="Depeg cover settles on data, not on a person: three authenticated feeds carry a 24-hour USDM price on Cardano Preview, and the validator reads them directly. Here is what they say right now and everything they have said."
    >
      <OracleLive />

      <section className="card-surface mt-6 p-6 sm:p-8" aria-labelledby="oracle-how">
        <h2 id="oracle-how" className="font-display text-[1.6rem] leading-tight text-text">
          How a reading gets on-chain
        </h2>
        <ol className="mt-5 grid gap-3 md:grid-cols-2">
          {steps.map((s, i) => (
            <li key={s.t} className="rounded-2xl border border-[var(--hairline)] bg-black/25 p-4">
              <p className="font-mono-label text-[9.5px] text-text-dim">Step {i + 1}</p>
              <p className="mt-1.5 text-[14.5px] text-text">{s.t}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-text-muted">{s.b}</p>
              <a href={s.src.href} target="_blank" rel="noreferrer" className="mt-2 inline-block font-mono text-[11.5px] text-accent hover:underline">
                {s.src.label} ↗
              </a>
            </li>
          ))}
        </ol>
      </section>

      <section className="card-surface mt-6 p-6 sm:p-8" aria-labelledby="oracle-trust">
        <div className="flex flex-wrap gap-2">
          <Badge variant="gold">Honest status</Badge>
          <Badge>Not audited</Badge>
        </div>
        <h2 id="oracle-trust" className="mt-4 font-display text-[1.6rem] leading-tight text-text">
          Who runs the feeds today
        </h2>
        <p className="mt-2 max-w-3xl text-[13.5px] leading-relaxed text-text-muted">
          On Preview one PlutusShield relay signs for all three feeds, so the 2-of-3 quorum is enforced by the validator but not
          yet independent in practice. The market data is real; the operators are not yet separate. Before any mainnet capital,
          each feed moves to an independent operator running this same relay, which is what makes the every-feed sale check and
          the 2-of-3 claim quorum meaningful. The same move is under way for the claims committee on{" "}
          <Link href="/assessors" className="text-accent hover:underline">
            /assessors
          </Link>
          .
        </p>
      </section>

      <section className="mt-6 grid gap-3 md:grid-cols-3" aria-label="Related">
        {related.map((r) => (
          <Link key={r.href} href={r.href} className="card-surface block p-5 transition-colors hover:border-[var(--border-accent)]">
            <p className="font-mono-label text-[9.5px] text-text-dim">{r.eyebrow}</p>
            <p className="mt-1.5 text-[15px] text-text">{r.title} →</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-text-muted">{r.body}</p>
          </Link>
        ))}
      </section>
    </AppShell>
  );
}
