import { Button } from "../ui/Button";
import { Container } from "../ui/Container";

export function CTA() {
  return (
    <section className="border-t border-border py-20 sm:py-24">
      <Container>
        <div className="card-surface relative overflow-hidden accent-ring px-6 py-12 text-center sm:px-12 sm:py-16">
          <div
            className="pointer-events-none absolute inset-0 mesh-bg opacity-70"
            aria-hidden="true"
          />
          <div className="relative mx-auto max-w-2xl">
            <p className="font-mono-label text-[10px] text-accent">Next step</p>
            <h2 className="mt-3 font-display text-3xl tracking-tight text-text sm:text-4xl text-balance">
              Build the shield before the capital arrives
            </h2>
            <p className="mt-4 text-base leading-relaxed text-text-muted text-balance">
              Contracts, pools, and policies are still in design. Explore the app shell,
              read the architecture, or star the repo while we ship the MVP.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button href="/app" size="lg">
                Launch app shell
              </Button>
              <Button
                href="https://github.com/Kshot3000/PlutusShield"
                external
                variant="secondary"
                size="lg"
              >
                View on GitHub
              </Button>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
