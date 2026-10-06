import { Container } from "../ui/Container";
import { SectionHeading } from "../ui/SectionHeading";

const pains = [
  {
    title: "Risk without a hedge",
    body: "Exploits, oracle failures, and depegs still leave most Cardano users absorbing the loss themselves.",
  },
  {
    title: "Public cover leaks strategy",
    body: "Fully transparent policies expose position size, protocol exposure, and claim details that sophisticated buyers and underwriters prefer private.",
  },
  {
    title: "Parametric alone is incomplete",
    body: "Smart-contract hacks rarely produce a clean oracle signal. Real cover needs evidence-based claims alongside automatic triggers.",
  },
];

export function Problem() {
  return (
    <section className="border-t border-border py-20 sm:py-24" id="problem">
      <Container>
        <SectionHeading
          eyebrow="The gap"
          title="DeFi grew. Risk tooling didn’t."
          description="Protection that is either fully public, parametric-only, or off-chain trust is not enough for serious capital on Cardano and Midnight."
        />
        <div className="grid gap-4 md:grid-cols-3">
          {pains.map((item, i) => (
            <article key={item.title} className="card-surface p-6 sm:p-7">
              <span className="font-mono-label text-[10px] text-accent">
                0{i + 1}
              </span>
              <h3 className="mt-4 text-lg font-semibold tracking-tight text-text">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-text-muted">{item.body}</p>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
