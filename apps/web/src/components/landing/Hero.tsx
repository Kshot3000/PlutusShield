import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Container } from "../ui/Container";

export function Hero() {
  return (
    <section className="relative overflow-hidden mesh-bg">
      <div className="pointer-events-none absolute inset-0 grid-fade opacity-60" aria-hidden="true" />
      <Container className="relative pb-20 pt-16 sm:pb-28 sm:pt-24">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <Badge variant="gold" className="mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />
            Design preview · Coming soon
          </Badge>

          <h1 className="font-display text-4xl leading-[1.12] tracking-tight text-text sm:text-5xl md:text-6xl text-balance">
            Insurance that settles on{" "}
            <span className="text-cardano">Cardano</span>
            {" "}and stays private on{" "}
            <span className="text-midnight">Midnight</span>
          </h1>

          <p className="mt-6 max-w-2xl text-base leading-relaxed text-text-muted sm:text-lg text-balance">
            PlutusShield protects DeFi positions with cover you can verify on-chain —
            premiums and payouts on Cardano, policy terms and claims evidence shielded
            by Midnight zero-knowledge proofs.
          </p>

          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
            <Button href="/app" size="lg">
              Open app shell
              <ArrowRight />
            </Button>
            <Button href="/docs" variant="secondary" size="lg">
              Read the docs
            </Button>
          </div>

          <dl className="mt-14 grid w-full max-w-2xl grid-cols-3 gap-3 sm:gap-4">
            {[
              { label: "Pool TVL", value: "—" },
              { label: "Active policies", value: "—" },
              { label: "Claims paid", value: "—" },
            ].map((stat) => (
              <div
                key={stat.label}
                className="card-surface rounded-2xl px-3 py-4 sm:px-4"
              >
                <dt className="font-mono-label text-[9px] text-text-dim sm:text-[10px]">
                  {stat.label}
                </dt>
                <dd className="mt-2 font-display text-2xl text-text-muted sm:text-3xl">
                  {stat.value}
                </dd>
                <p className="mt-1 text-[10px] text-text-dim sm:text-xs">Coming soon</p>
              </div>
            ))}
          </dl>
        </div>
      </Container>
    </section>
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
