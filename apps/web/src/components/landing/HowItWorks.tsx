import { Container } from "../ui/Container";
import { SectionHeading } from "../ui/SectionHeading";

const steps = [
  {
    title: "Quote in one screen",
    body: "Pick risk, coverage amount, duration, and see premium with clear exclusions — before you connect a wallet.",
  },
  {
    title: "Buy on Cardano",
    body: "Premium settles on-chain. Policy state is minted and tracked by validators. Wallet-native — Lace / CIP-30 style.",
  },
  {
    title: "Commit privately on Midnight",
    body: "Policy terms and size commitments live on Midnight. Prove you hold active cover without publishing your book.",
  },
  {
    title: "Claim with selective disclosure",
    body: "Parametric triggers pay automatically. Exploit claims submit private evidence; assessors see only what proofs allow.",
  },
];

export function HowItWorks() {
  return (
    <section className="border-t border-border bg-bg-elevated py-20 sm:py-24" id="how-it-works">
      <Container>
        <SectionHeading
          eyebrow="How it works"
          title="From quote to payout — without the mystery"
          description="Privacy without black boxes. At every step you see what is public on Cardano versus private on Midnight."
        />
        <ol className="relative mx-auto max-w-3xl space-y-0">
          {steps.map((step, i) => (
            <li key={step.title} className="relative flex gap-5 pb-10 last:pb-0 sm:gap-7">
              {i < steps.length - 1 ? (
                <span
                  className="absolute left-[15px] top-9 h-[calc(100%-1.25rem)] w-px bg-border sm:left-[19px]"
                  aria-hidden="true"
                />
              ) : null}
              <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--accent)_40%,var(--border))] bg-[var(--accent-glow)] font-mono text-xs font-medium text-accent sm:h-10 sm:w-10 sm:text-sm">
                {i + 1}
              </span>
              <div className="pt-0.5 sm:pt-1.5">
                <h3 className="text-base font-semibold tracking-tight text-text sm:text-lg">
                  {step.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
