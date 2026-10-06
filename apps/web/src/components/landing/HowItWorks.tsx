import { Container } from "../ui/Container";
import { SectionHeading } from "../ui/SectionHeading";

type Layer = "local" | "cardano" | "midnight";

const steps: { title: string; body: string; layers: Layer[] }[] = [
  {
    title: "Quote in one screen",
    body: "Pick risk, coverage amount, and duration. See the premium and exclusions before you ever connect a wallet.",
    layers: ["local"],
  },
  {
    title: "Buy on Cardano",
    body: "Premium settles on-chain. A policy NFT is minted and its state tracked by validators. Wallet-native, CIP-30.",
    layers: ["cardano"],
  },
  {
    title: "Commit privately",
    body: "Policy terms and size commitments live on Midnight. Prove you hold active cover without publishing your book.",
    layers: ["midnight"],
  },
  {
    title: "Claim with disclosure",
    body: "Parametric triggers pay automatically. Exploit claims submit private evidence; assessors see only what proofs allow.",
    layers: ["midnight", "cardano"],
  },
];

const layerCls: Record<Layer, { label: string; cls: string }> = {
  local: { label: "In your browser", cls: "text-text-muted border-[var(--hairline)] bg-white/[0.03]" },
  cardano: { label: "Public · Cardano", cls: "text-cardano border-cardano/25 bg-[var(--cardano-soft)]" },
  midnight: { label: "Private · Midnight", cls: "text-midnight border-midnight/25 bg-[var(--midnight-soft)]" },
};

export function HowItWorks() {
  return (
    <section className="relative overflow-hidden py-24 sm:py-32" id="how-it-works">
      <div className="hairline-x absolute inset-x-0 top-0" aria-hidden="true" />
      <div className="dot-grid pointer-events-none absolute inset-0 -z-10 opacity-40 [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,black,transparent)]" aria-hidden="true" />
      <Container>
        <SectionHeading
          index="04"
          eyebrow="How it works"
          title={
            <>
              From quote to payout —
              <br />
              <em className="text-text-muted">without the mystery.</em>
            </>
          }
          description="Privacy without black boxes. At every step you can see what is public on Cardano and what stays private on Midnight."
        />

        <ol className="relative grid gap-5 md:grid-cols-2 lg:grid-cols-4 lg:gap-4">
          <span
            className="pointer-events-none absolute left-[12%] right-[12%] top-[2.1rem] hidden h-px bg-gradient-to-r from-white/5 via-accent/40 to-white/5 lg:block"
            aria-hidden="true"
          />
          {steps.map((step, i) => (
            <li key={step.title} className="reveal relative flex flex-col">
              <div className="relative z-10 mx-0 flex h-[4.2rem] w-[4.2rem] items-center justify-center lg:mx-auto">
                <span className="absolute inset-0 rounded-full bg-[var(--bg)]" />
                <span className="absolute inset-0 rounded-full border border-[var(--hairline)] bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.09),transparent_60%)]" />
                <span className="relative font-display text-2xl text-text">{i + 1}</span>
              </div>
              <div className="glass-panel relative mt-5 flex flex-1 flex-col rounded-[1.4rem] p-6 lg:text-center">
                <h3 className="text-[17px] font-medium tracking-[-0.01em] text-text">{step.title}</h3>
                <p className="mt-2.5 flex-1 text-[14px] leading-relaxed text-text-muted text-pretty">
                  {step.body}
                </p>
                <div className="mt-5 flex flex-wrap gap-1.5 lg:justify-center">
                  {step.layers.map((l) => (
                    <span
                      key={l}
                      className={`rounded-full border px-2.5 py-1 font-mono-label text-[9px] ${layerCls[l].cls}`}
                    >
                      {layerCls[l].label}
                    </span>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
