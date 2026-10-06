import { Button } from "../ui/Button";
import { Container } from "../ui/Container";
import { ShieldVisual } from "./ShieldVisual";

const pillars = [
  { label: "Settles on Cardano", tone: "bg-cardano" },
  { label: "Shielded by Midnight ZK", tone: "bg-midnight" },
  { label: "Multi-oracle triggers", tone: "bg-accent" },
  { label: "Open source · MIT", tone: "bg-gold" },
];

export function Hero() {
  return (
    <section className="relative isolate -mt-[4.25rem] overflow-hidden pt-[4.25rem]">
      <HeroBackdrop />

      <Container className="relative grid items-center gap-14 pb-20 pt-14 sm:pt-20 lg:grid-cols-[1.08fr_0.92fr] lg:gap-10 lg:pb-28 lg:pt-24">
        <div className="flex flex-col items-start">
          <p className="animate-rise inline-flex items-center gap-2.5 rounded-full border border-[var(--hairline)] bg-white/[0.03] py-1.5 pl-2 pr-3.5 text-[12.5px] text-text-muted backdrop-blur-md">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--gold-soft)] px-2 py-0.5 font-mono-label text-[9.5px] text-gold">
              <span className="animate-pulse-dot h-1.5 w-1.5 rounded-full bg-gold text-gold" />
              Preview
            </span>
            DeFi cover for Cardano &amp; Midnight
          </p>

          <h1 className="animate-rise delay-1 mt-8 font-display text-[3.1rem] leading-[0.98] tracking-[-0.025em] text-text sm:text-[4.4rem] lg:text-[5.1rem] xl:text-[5.6rem]">
            <span className="gradient-text">Protection you</span>
            <br />
            <span className="gradient-text">can </span>
            <em className="text-cardano-grad pr-1">prove.</em>
            <br />
            <span className="gradient-text">Positions you</span>
            <br />
            <span className="gradient-text">never </span>
            <em className="text-midnight-grad pr-1">expose.</em>
          </h1>

          <p className="animate-rise delay-2 mt-8 max-w-[34rem] text-[16px] leading-relaxed text-text-muted sm:text-[18px] text-pretty">
            PlutusShield is DeFi and smart-contract insurance with premiums and payouts
            enforced by Cardano validators — while policy terms, position sizes, and claim
            evidence stay shielded behind Midnight zero-knowledge proofs.
          </p>

          <div className="animate-rise delay-3 mt-10 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <Button href="/cover" size="lg" className="w-full sm:w-auto">
              Get an indicative quote
              <ArrowRight />
            </Button>
            <Button href="/app" variant="secondary" size="lg" className="w-full sm:w-auto">
              Explore the app
            </Button>
          </div>

          <ul className="animate-rise delay-4 mt-12 grid w-full max-w-[30rem] grid-cols-2 gap-x-6 gap-y-3 border-t border-[var(--hairline)] pt-6">
            {pillars.map((p) => (
              <li key={p.label} className="flex items-center gap-2 text-[12.5px] text-text-muted">
                <span className={`h-1.5 w-1.5 rounded-full ${p.tone}`} aria-hidden="true" />
                {p.label}
              </li>
            ))}
          </ul>
        </div>

        <div className="animate-fade delay-2 relative">
          <ShieldVisual />
        </div>
      </Container>

      <div className="hairline-x absolute inset-x-0 bottom-0" aria-hidden="true" />
    </section>
  );
}

function HeroBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
      <div className="absolute inset-0 grid-fade opacity-70" />
      <div className="animate-drift-a absolute -left-[10%] -top-[20%] h-[70vh] w-[60vw] rounded-full bg-[radial-gradient(closest-side,rgba(64,105,255,0.3),transparent)] blur-3xl" />
      <div className="animate-drift-b absolute -right-[10%] top-[5%] h-[70vh] w-[55vw] rounded-full bg-[radial-gradient(closest-side,rgba(140,100,255,0.26),transparent)] blur-3xl" />
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-bg" />
    </div>
  );
}

function ArrowRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
