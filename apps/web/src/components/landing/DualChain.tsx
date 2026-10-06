import type { ReactNode } from "react";
import { Badge } from "../ui/Badge";
import { Container } from "../ui/Container";
import { SectionHeading } from "../ui/SectionHeading";

const cardano = [
  "Premium payments (ADA, stablecoins)",
  "Underwriting pool capital",
  "Policy NFTs / state transitions",
  "Payout execution",
  "Aiken / Plutus V3 validators",
];

const midnight = [
  "Private policy terms",
  "Claims evidence vault",
  "Private underwriter positions",
  "Selective-disclosure proofs",
  "Compact ZK circuits",
];

export function DualChain() {
  return (
    <section className="border-t border-border bg-bg-elevated py-20 sm:py-24" id="dual-chain">
      <Container>
        <SectionHeading
          eyebrow="Dual-chain design"
          title="Money on Cardano. Secrets on Midnight."
          description="We never pretend one chain does both well. Settlement is public and auditable. Sensitive policy data stays private until you choose to disclose."
        />

        <div className="grid gap-5 lg:grid-cols-2">
          <ChainCard
            badge={<Badge variant="cardano">Cardano · settlement</Badge>}
            title="Holds the money"
            subtitle="Premiums, pool capital, and payouts enforced by validators — not operator goodwill."
            items={cardano}
            accent="cardano"
          />
          <ChainCard
            badge={<Badge variant="midnight">Midnight · privacy</Badge>}
            title="Holds the secrets"
            subtitle="Prove you hold cover without publishing wallet, position size, or claim evidence."
            items={midnight}
            accent="midnight"
          />
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-text-dim">
          Public Cardano state never needs private Midnight witnesses to verify that a
          payout was authorized — only that a valid proof was accepted.
        </p>
      </Container>
    </section>
  );
}

function ChainCard({
  badge,
  title,
  subtitle,
  items,
  accent,
}: {
  badge: ReactNode;
  title: string;
  subtitle: string;
  items: string[];
  accent: "cardano" | "midnight";
}) {
  const dot = accent === "cardano" ? "bg-cardano" : "bg-midnight";
  return (
    <article className="card-surface relative overflow-hidden p-6 sm:p-8">
      <div
        className={`pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-40 blur-3xl ${
          accent === "cardano" ? "bg-[var(--cardano-soft)]" : "bg-[var(--midnight-soft)]"
        }`}
        aria-hidden="true"
      />
      <div className="relative">
        {badge}
        <h3 className="mt-5 font-display text-2xl tracking-tight text-text">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">{subtitle}</p>
        <ul className="mt-6 space-y-3">
          {items.map((item) => (
            <li key={item} className="flex items-start gap-3 text-sm text-text">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
