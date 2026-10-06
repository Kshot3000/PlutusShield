import Link from "next/link";
import { Badge } from "../ui/Badge";
import { Container } from "../ui/Container";
import { SectionHeading } from "../ui/SectionHeading";

const covers = [
  {
    title: "Smart-contract exploit cover",
    trigger: "Evidence-based",
    example:
      "A covered DEX validator is drained through a logic bug. Evidence stays private on Midnight; assessors review under disclosure proofs; payout settles on Cardano.",
    badge: "accent" as const,
  },
  {
    title: "Parametric DeFi events",
    trigger: "Multi-oracle trigger",
    example:
      "Stablecoin depeg below a defined threshold, oracle staleness, or deviation past bounds. Automatic payout when the on-chain condition fires — no claims committee.",
    badge: "cardano" as const,
  },
  {
    title: "Protocol SLA cover",
    trigger: "Service-level breach",
    example:
      "A covered protocol’s critical service — batcher, oracle, or bridge — is unavailable beyond the agreed window. Trigger definition is part of the policy terms.",
    badge: "midnight" as const,
  },
];

export function CoverTypes() {
  return (
    <section className="border-t border-border py-20 sm:py-24" id="cover">
      <Container>
        <SectionHeading
          eyebrow="Cover types"
          title="Protection that matches real risk"
          description="Parametric where an objective trigger exists. Evidence-based claims where it doesn’t — like smart-contract exploits."
        />
        <div className="grid gap-4 lg:grid-cols-3">
          {covers.map((cover) => (
            <article key={cover.title} className="card-surface flex flex-col p-6 sm:p-7">
              <Badge variant={cover.badge}>{cover.trigger}</Badge>
              <h3 className="mt-5 text-lg font-semibold tracking-tight text-text">
                {cover.title}
              </h3>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-text-muted">
                {cover.example}
              </p>
              <p className="mt-5 font-mono-label text-[10px] text-text-dim">
                Design preview · Not live
              </p>
            </article>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-text-muted">
          Explore the{" "}
          <Link href="/cover" className="text-accent hover:text-accent-strong underline-offset-4 hover:underline">
            cover workspace
          </Link>{" "}
          or read{" "}
          <a
            href="https://github.com/Kshot3000/PlutusShield/blob/main/docs/PRODUCT.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:text-accent-strong underline-offset-4 hover:underline"
          >
            PRODUCT.md
          </a>
          .
        </p>
      </Container>
    </section>
  );
}
