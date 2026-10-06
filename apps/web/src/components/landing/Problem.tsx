import { Container } from "../ui/Container";
import { SectionHeading } from "../ui/SectionHeading";

const pains = [
  {
    title: "Risk without a hedge",
    body: "Exploits, oracle failures, and depegs still leave most Cardano users absorbing the loss themselves — there is no native, verifiable place to lay that risk off.",
  },
  {
    title: "Public cover leaks strategy",
    body: "Fully transparent policies expose position size, protocol exposure, and claim details — exactly the data sophisticated buyers and underwriters keep private.",
  },
  {
    title: "Parametric alone is incomplete",
    body: "Smart-contract hacks rarely produce a clean oracle signal. Real cover needs evidence-based claims alongside automatic triggers.",
  },
];

export function Problem() {
  return (
    <section className="relative py-24 sm:py-32" id="problem">
      <Container className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHeading
            align="left"
            index="01"
            eyebrow="The gap"
            title={
              <>
                DeFi grew up.
                <br />
                <em className="text-text-muted">Risk tooling didn’t.</em>
              </>
            }
            description="Protection that is fully public, parametric-only, or dependent on off-chain trust is not enough for serious capital on Cardano and Midnight."
            className="mb-0 sm:mb-0"
          />
        </div>

        <ol className="relative">
          {pains.map((item, i) => (
            <li
              key={item.title}
              className="reveal group relative grid grid-cols-[auto_1fr] gap-6 border-t border-[var(--hairline)] py-9 last:border-b sm:gap-10 sm:py-11"
            >
              <span className="font-display text-5xl leading-none text-transparent [-webkit-text-stroke:1px_rgba(197,208,255,0.35)] transition-colors duration-500 group-hover:[-webkit-text-stroke:1px_rgba(197,208,255,0.8)] sm:text-6xl">
                0{i + 1}
              </span>
              <div>
                <h3 className="text-xl font-medium tracking-[-0.015em] text-text sm:text-[1.4rem]">
                  {item.title}
                </h3>
                <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-text-muted text-pretty">
                  {item.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
