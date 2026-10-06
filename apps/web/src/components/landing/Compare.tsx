import { Container } from "../ui/Container";
import { SectionHeading } from "../ui/SectionHeading";

const rows = [
  { dim: "Chain", aegis: "Cardano", us: "Cardano + Midnight" },
  { dim: "Cover model", aegis: "Parametric", us: "Parametric and evidence-based exploit cover" },
  { dim: "Privacy", aegis: "Public policy / pool surface", us: "Private terms, evidence, and underwriter books via ZK" },
  { dim: "Status", aegis: "Mainnet parametric protocol", us: "Validators built and tested · Preview testnet next" },
];

const commitments = [
  "Exploit cover, not just parametric",
  "Midnight-native privacy by default",
  "Underwriter-grade risk tooling without leaking LP books",
  "Buyer UX that explains cover in plain language",
];

export function Compare() {
  return (
    <section className="relative py-24 sm:py-32" id="compare">
      <div className="hairline-x absolute inset-x-0 top-0" aria-hidden="true" />
      <Container>
        <SectionHeading
          index="05"
          eyebrow="Competitive honesty"
          badgeVariant="gold"
          title={
            <>
              Parametric is necessary.
              <br />
              <em className="text-text-muted">It isn’t sufficient.</em>
            </>
          }
          description={
            <>
              We respect{" "}
              <a
                href="https://aegis.fluxpointstudios.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-text underline decoration-white/25 underline-offset-4 hover:decoration-white/60"
              >
                Aegis
                <span className="sr-only"> (opens in a new tab)</span>
              </a>{" "}
              as the current Cardano parametric bar. Our job is to clear a higher bar on privacy and
              cover breadth — and to be clear about where we are today.
            </>
          }
        />

        {/* Desktop table */}
        <div className="reveal glass-panel relative hidden overflow-hidden md:block">
          <div className="pointer-events-none absolute inset-y-0 right-0 w-[42%] bg-[linear-gradient(180deg,rgba(157,176,255,0.07),rgba(167,139,255,0.03))]" aria-hidden="true" />
          <table className="relative w-full text-left text-[14.5px]">
            <caption className="sr-only">PlutusShield compared with Aegis</caption>
            <thead>
              <tr className="border-b border-[var(--hairline)]">
                <th scope="col" className="w-[24%] px-8 py-5 font-mono-label text-[10px] font-normal text-text-dim">
                  Dimension
                </th>
                <th scope="col" className="w-[34%] px-8 py-5 font-mono-label text-[10px] font-normal text-text-dim">
                  Aegis · today
                </th>
                <th scope="col" className="px-8 py-5">
                  <span className="flex items-center gap-2.5">
                    <span className="font-mono-label text-[10px] font-normal text-accent-strong">PlutusShield</span>
                    <span className="rounded-full border border-gold/30 bg-[var(--gold-soft)] px-2 py-0.5 font-mono-label text-[9px] font-normal text-gold">
                      Target
                    </span>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.dim} className="border-b border-[var(--hairline)] last:border-b-0">
                  <th scope="row" className="px-8 py-6 font-medium text-text">{row.dim}</th>
                  <td className="px-8 py-6 text-text-muted">{row.aegis}</td>
                  <td className="px-8 py-6 text-text">{row.us}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="space-y-3 md:hidden">
          {rows.map((row) => (
            <div key={row.dim} className="reveal glass-panel relative rounded-2xl p-5">
              <p className="font-mono-label text-[9.5px] text-text-dim">{row.dim}</p>
              <dl className="mt-3 grid grid-cols-2 gap-4 text-[13.5px]">
                <div>
                  <dt className="text-[11px] text-text-dim">Aegis · today</dt>
                  <dd className="mt-1 text-text-muted">{row.aegis}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-accent">PlutusShield · target</dt>
                  <dd className="mt-1 text-text">{row.us}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>

        <ul className="mx-auto mt-12 grid max-w-4xl gap-x-10 gap-y-4 sm:grid-cols-2">
          {commitments.map((item) => (
            <li key={item} className="reveal flex items-start gap-3.5 text-[15px] text-text-muted">
              <span className="mt-[3px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-[var(--accent-glow)] text-accent" aria-hidden="true">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              {item}
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
