import { Container } from "../ui/Container";
import { SectionHeading } from "../ui/SectionHeading";

const cardano = [
  "Premium payments in ADA and stablecoins",
  "Underwriting pool capital",
  "Policy NFTs and state transitions",
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
    <section className="relative overflow-hidden py-24 sm:py-32" id="dual-chain">
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
        <div className="absolute left-0 top-1/3 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(64,105,255,0.14),transparent)] blur-2xl" />
        <div className="absolute right-0 top-1/3 h-[480px] w-[480px] translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(140,100,255,0.14),transparent)] blur-2xl" />
      </div>
      <div className="hairline-x absolute inset-x-0 top-0" aria-hidden="true" />

      <Container>
        <SectionHeading
          index="02"
          eyebrow="Dual-chain architecture"
          title={
            <>
              Money on <em className="text-cardano-grad">Cardano.</em>
              <br />
              Secrets on <em className="text-midnight-grad">Midnight.</em>
            </>
          }
          description="We never pretend one chain does both well. Settlement is public and auditable. Sensitive policy data stays private until you choose to disclose it."
        />

        <div className="grid items-stretch gap-5 lg:grid-cols-[1fr_auto_1fr] lg:gap-0">
          <ChainCard
            chain="Cardano"
            role="Settlement layer · public"
            title="Holds the money"
            subtitle="Premiums, pool capital, and payouts enforced by validators — not operator goodwill."
            items={cardano}
            accent="cardano"
          />
          <ProofBridge />
          <ChainCard
            chain="Midnight"
            role="Privacy layer · shielded"
            title="Holds the secrets"
            subtitle="Prove you hold cover without publishing your wallet, position size, or claim evidence."
            items={midnight}
            accent="midnight"
          />
        </div>

        <p className="reveal mx-auto mt-12 max-w-2xl text-center text-[14px] leading-relaxed text-text-dim text-balance">
          Public Cardano state never needs private Midnight witnesses to verify that a payout was
          authorized — only that a valid proof was accepted.
        </p>
      </Container>
    </section>
  );
}

function ProofBridge() {
  return (
    <div className="relative flex items-center justify-center py-2 lg:w-40 lg:py-0" aria-hidden="true">
      {/* vertical connector on mobile, horizontal on desktop */}
      <div className="relative h-16 w-px overflow-hidden bg-gradient-to-b from-cardano/50 to-midnight/50 lg:h-px lg:w-full lg:bg-gradient-to-r">
        <span className="absolute left-1/2 h-4 w-px -translate-x-1/2 bg-white shadow-[0_0_12px_2px_rgba(197,208,255,0.8)] [animation:travel-y_2.8s_ease-in-out_infinite] lg:hidden" />
        <span className="absolute top-1/2 hidden h-px w-6 -translate-y-1/2 bg-white shadow-[0_0_12px_2px_rgba(197,208,255,0.8)] [animation:travel-x_2.8s_ease-in-out_infinite] lg:block" />
      </div>
      <div className="glass-panel absolute flex flex-col items-center gap-1 rounded-2xl px-3.5 py-2.5 text-center">
        <span className="font-mono-label text-[9px] text-accent-strong">ZK proof</span>
        <span className="text-[11px] text-text-dim">verified, not revealed</span>
      </div>
    </div>
  );
}

function ChainCard({
  chain,
  role,
  title,
  subtitle,
  items,
  accent,
}: {
  chain: string;
  role: string;
  title: string;
  subtitle: string;
  items: string[];
  accent: "cardano" | "midnight";
}) {
  const isCardano = accent === "cardano";
  return (
    <article className="reveal glass-panel lift relative overflow-hidden p-7 sm:p-10">
      <div
        className={`pointer-events-none absolute -top-24 h-64 w-64 rounded-full blur-3xl ${
          isCardano ? "-left-16 bg-[rgba(64,105,255,0.22)]" : "-right-16 bg-[rgba(140,100,255,0.22)]"
        }`}
        aria-hidden="true"
      />
      <div
        className={`absolute inset-x-10 top-0 h-px ${
          isCardano
            ? "bg-gradient-to-r from-transparent via-cardano to-transparent"
            : "bg-gradient-to-r from-transparent via-midnight to-transparent"
        }`}
        aria-hidden="true"
      />
      <div className="relative">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ChainGlyph accent={accent} />
            <div>
              <p className="text-[15px] font-medium text-text">{chain}</p>
              <p className={`font-mono-label text-[9.5px] ${isCardano ? "text-cardano" : "text-midnight"}`}>
                {role}
              </p>
            </div>
          </div>
        </div>
        <h3 className="mt-10 font-display text-[2.1rem] leading-tight text-text sm:text-[2.5rem]">
          {title}
        </h3>
        <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-text-muted text-pretty">
          {subtitle}
        </p>
        <ul className="mt-8 divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
          {items.map((item) => (
            <li key={item} className="flex items-center gap-3 py-3 text-[14px] text-text">
              <span
                className={`h-1 w-1 shrink-0 rounded-full ${isCardano ? "bg-cardano" : "bg-midnight"}`}
                aria-hidden="true"
              />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function ChainGlyph({ accent }: { accent: "cardano" | "midnight" }) {
  if (accent === "cardano") {
    return (
      <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-cardano/30 bg-[var(--cardano-soft)] text-cardano">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="2.2" fill="currentColor" />
          {[0, 60, 120, 180, 240, 300].map((a) => (
            <circle
              key={a}
              cx={12 + 6.5 * Math.cos((a * Math.PI) / 180)}
              cy={12 + 6.5 * Math.sin((a * Math.PI) / 180)}
              r="1.3"
              fill="currentColor"
              opacity="0.8"
            />
          ))}
          {[30, 90, 150, 210, 270, 330].map((a) => (
            <circle
              key={a}
              cx={12 + 10 * Math.cos((a * Math.PI) / 180)}
              cy={12 + 10 * Math.sin((a * Math.PI) / 180)}
              r="0.9"
              fill="currentColor"
              opacity="0.5"
            />
          ))}
        </svg>
      </span>
    );
  }
  return (
    <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-midnight/30 bg-[var(--midnight-soft)] text-midnight">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M15.5 3.5a8.5 8.5 0 104.9 14.6A7 7 0 0115.5 3.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
      </svg>
    </span>
  );
}
