import { ShieldMark } from "../Logo";
import { Button } from "../ui/Button";
import { Container } from "../ui/Container";

export function CTA() {
  return (
    <section className="relative pb-16 pt-12 sm:pb-24 sm:pt-16">
      <Container>
        <div className="reveal glass-panel relative overflow-hidden rounded-[2.25rem] px-6 py-20 text-center sm:px-14 sm:py-28">
          <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
            <div className="animate-drift-a absolute -left-1/4 top-0 h-full w-3/4 rounded-full bg-[radial-gradient(closest-side,rgba(64,105,255,0.28),transparent)] blur-3xl" />
            <div className="animate-drift-b absolute -right-1/4 top-0 h-full w-3/4 rounded-full bg-[radial-gradient(closest-side,rgba(140,100,255,0.26),transparent)] blur-3xl" />
            <div className="absolute inset-0 grid-fade opacity-50" />
          </div>

          <div className="relative mx-auto flex max-w-2xl flex-col items-center">
            <span className="relative">
              <span className="absolute inset-0 rounded-full bg-accent opacity-30 blur-2xl" aria-hidden="true" />
              <ShieldMark size={56} className="relative" />
            </span>
            <h2 className="mt-8 font-display text-[2.6rem] leading-[1.02] text-text sm:text-6xl md:text-[4.25rem] text-balance">
              Build the shield <em className="text-shield-grad">before</em> the capital arrives.
            </h2>
            <p className="mt-6 max-w-lg text-[16px] leading-relaxed text-text-muted text-pretty">
              The validators are written and tested, and the pools are live on Cardano Preview and Midnight
              Preprod — testnet only, not audited yet. Price a policy, stress-test the pool, read how every
              rule is enforced, or star the repo and follow along.
            </p>
            <div className="mt-10 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
              <Button href="/cover" size="lg" className="w-full sm:w-auto">
                Get an indicative quote
              </Button>
              <Button
                href="https://github.com/Kshot3000/PlutusShield"
                external
                variant="secondary"
                size="lg"
                className="w-full sm:w-auto"
              >
                Star on GitHub
              </Button>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
