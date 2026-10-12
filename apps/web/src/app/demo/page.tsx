import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { DemoBeatCard } from "@/components/demo/DemoBeatCard";
import { ProofLink } from "@/components/demo/ProofLink";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DEMO_BEATS, DEMO_CHECKED, FAST_LANE, KIT, REPO } from "@/lib/demoWalkthrough";

export const metadata: Metadata = {
  title: "Guided demo",
  description:
    "A five-step, three-minute walkthrough of PlutusShield for Midnight Buildathon judges: buy cover on Cardano Preview, prove it privately with proveCover on Midnight Preprod, seal claim evidence, and see a 2-of-3 committee payout. Testnet only, not audited.",
};

const next = [
  "proveCover and fileClaim straight from a browser Midnight wallet",
  "Independent operators for the three assessor seats (the enrollment kit is live on /assessors)",
  "External audits of the Cardano and Midnight contracts",
  "Then a capped mainnet launch",
];

export default function DemoPage() {
  const total = DEMO_BEATS.length;
  return (
    <AppShell
      active="demo"
      title="Guided demo"
      description="Five steps, about three minutes. Buy cover on Cardano, prove it privately on Midnight, seal a claim and watch a 2-of-3 committee pay out. Every step links to the live page and to the real testnet transactions."
    >
      {/* Honest framing + kit */}
      <section className="card-surface p-6 sm:p-7" aria-labelledby="demo-status">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex flex-wrap gap-2">
              <Badge variant="gold">Testnet only</Badge>
              <Badge>Not audited</Badge>
              <Badge variant="cardano">Cardano Preview</Badge>
              <Badge variant="midnight">Midnight Preprod</Badge>
            </div>
            <h2 id="demo-status" className="mt-4 text-[15px] font-semibold text-text">
              Built for the Midnight Buildathon, Wave 2
            </h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-text-muted text-pretty">
              Everything here runs on test networks with test ADA and tUSDCx: no real value and no offer of insurance.
              The three committee seats are run by the PlutusShield team today (
              <Link href="/assessors" className="text-text underline underline-offset-4 hover:text-accent">
                how independent assessors enroll
              </Link>
              ). Links checked {DEMO_CHECKED}.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2.5 whitespace-nowrap sm:flex-row">
            <Button href="#step-1" className="w-full sm:w-auto">
              Start at step 1
            </Button>
            <Button href={KIT.deck} external variant="secondary" className="w-full sm:w-auto">
              Pitch deck (PDF)
            </Button>
            <Button href={KIT.script} external variant="secondary" className="w-full sm:w-auto">
              Video script
            </Button>
          </div>
        </div>
      </section>

      {/* Fast lane for judges */}
      <section className="mt-6 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]" aria-labelledby="fast-lane">
        <div>
          <p className="font-mono-label text-[10.5px] text-accent">Short on time?</p>
          <h2 id="fast-lane" className="mt-3 font-display text-[1.9rem] leading-[1.06] text-text sm:text-4xl text-balance">
            Three links tell the whole story.
          </h2>
          <p className="mt-3 max-w-md text-[14px] leading-relaxed text-text-muted">
            The private registry on Midnight, a zero-knowledge proof of cover against it, and a Cardano payout
            that needed two of three committee signatures.
          </p>
        </div>
        <ul className="card-surface divide-y divide-[var(--hairline)] px-5 py-1 sm:px-6">
          {FAST_LANE.map((p) => (
            <ProofLink key={p.hash} proof={p} />
          ))}
        </ul>
      </section>

      {/* Step chips */}
      <nav aria-label="Demo steps" className="mt-12 -mx-1 overflow-x-auto px-1 pb-1">
        <ol className="flex min-w-max gap-2">
          {DEMO_BEATS.map((b, i) => (
            <li key={b.id}>
              <a
                href={`#step-${i + 1}`}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--hairline)] bg-white/[0.03] px-3.5 py-2 text-[13px] text-text-muted transition-colors hover:border-white/15 hover:text-text"
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    b.chain === "cardano" ? "bg-cardano" : b.chain === "midnight" ? "bg-midnight" : "bg-accent"
                  }`}
                  aria-hidden="true"
                />
                <span className="font-mono text-[11px] text-text-dim">{String(i + 1).padStart(2, "0")}</span>
                {b.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <ol className="mt-6 flex flex-col gap-6 sm:gap-8">
        {DEMO_BEATS.map((beat, i) => (
          <DemoBeatCard key={beat.id} beat={beat} index={i} total={total} />
        ))}
      </ol>

      {/* Wrap-up */}
      <section className="card-surface mt-12 p-6 sm:p-10" aria-labelledby="wrap-up">
        <p className="font-mono-label text-[10.5px] text-text-dim">2:40 – 3:00 · Honest status</p>
        <h2 id="wrap-up" className="mt-4 font-display text-[1.9rem] leading-[1.06] text-text sm:text-[2.6rem] text-balance">
          Money on <em className="text-cardano-grad">Cardano.</em> Secrets on <em className="text-midnight-grad">Midnight.</em>
        </h2>
        <div className="mt-6 grid gap-8 md:grid-cols-2">
          <p className="text-[14.5px] leading-relaxed text-text-muted text-pretty">
            Everything above is on Cardano Preview and Midnight Preprod and has not been audited. The validators,
            Compact contracts, tests and every transaction are public in the{" "}
            <a href={REPO} target="_blank" rel="noopener noreferrer" className="text-text underline underline-offset-4 hover:text-accent">
              repo
            </a>
            , and the{" "}
            <Link href="/docs/risks" className="text-text underline underline-offset-4 hover:text-accent">
              risks page
            </Link>{" "}
            spells out the trust assumptions.
          </p>
          <div>
            <p className="font-mono-label text-[10px] text-gold">What&apos;s next</p>
            <ul className="mt-3 space-y-2">
              {next.map((n) => (
                <li key={n} className="flex gap-3 text-[14px] leading-relaxed text-text-muted">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                  {n}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-8 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
          <Button href="/cover" className="w-full sm:w-auto">
            Buy cover
          </Button>
          <Button href="/policy" variant="secondary" className="w-full sm:w-auto">
            Track a policy end to end
          </Button>
          <Button href="/app" variant="secondary" className="w-full sm:w-auto">
            Open the app
          </Button>
          <Button href="/claim/evidence" variant="secondary" className="w-full sm:w-auto">
            Seal evidence
          </Button>
          <Button href="/assessors" variant="secondary" className="w-full sm:w-auto">
            Become an assessor
          </Button>
          <Button href={KIT.readme} external variant="ghost" className="w-full sm:w-auto">
            Buildathon README
          </Button>
        </div>
      </section>
    </AppShell>
  );
}
