import { Badge } from "../ui/Badge";
import { Container } from "../ui/Container";
import { SectionHeading } from "../ui/SectionHeading";

const rows = [
  {
    dim: "Chain",
    aegis: "Cardano",
    us: "Cardano + Midnight",
  },
  {
    dim: "Cover model",
    aegis: "Parametric",
    us: "Parametric and evidence-based exploit cover",
  },
  {
    dim: "Privacy",
    aegis: "Public policy / pool surface",
    us: "Private terms, evidence, underwriter books via ZK",
  },
  {
    dim: "Status",
    aegis: "Mainnet parametric protocol",
    us: "Scaffold / design preview (this site)",
  },
];

export function Compare() {
  return (
    <section className="border-t border-border py-20 sm:py-24" id="compare">
      <Container>
        <SectionHeading
          eyebrow="Competitive honesty"
          badgeVariant="gold"
          title="Parametric is necessary. It isn’t sufficient."
          description={
            <>
              We respect{" "}
              <a
                href="https://aegis.fluxpointstudios.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline-offset-4 hover:underline"
              >
                Aegis
              </a>{" "}
              as the current Cardano parametric bar. PlutusShield’s job is to clear a
              higher bar on privacy and cover breadth — not to copy a landing page.
            </>
          }
        />

        <div className="overflow-hidden rounded-2xl border border-border bg-bg-card">
          <div className="grid grid-cols-[1.1fr_1fr_1.2fr] gap-px border-b border-border bg-border text-left">
            <div className="bg-bg-elevated px-4 py-3 font-mono-label text-[10px] text-text-dim sm:px-5">
              Dimension
            </div>
            <div className="bg-bg-elevated px-4 py-3 font-mono-label text-[10px] text-text-dim sm:px-5">
              Aegis (today)
            </div>
            <div className="flex items-center gap-2 bg-bg-elevated px-4 py-3 sm:px-5">
              <span className="font-mono-label text-[10px] text-accent">PlutusShield</span>
              <Badge variant="gold" className="hidden sm:inline-flex">
                Target
              </Badge>
            </div>
          </div>
          {rows.map((row) => (
            <div
              key={row.dim}
              className="grid grid-cols-[1.1fr_1fr_1.2fr] gap-px border-b border-border bg-border last:border-b-0"
            >
              <div className="bg-bg-card px-4 py-4 text-sm font-medium text-text sm:px-5">
                {row.dim}
              </div>
              <div className="bg-bg-card px-4 py-4 text-sm text-text-muted sm:px-5">
                {row.aegis}
              </div>
              <div className="bg-[color-mix(in_srgb,var(--accent-glow)_50%,var(--bg-card))] px-4 py-4 text-sm text-text sm:px-5">
                {row.us}
              </div>
            </div>
          ))}
        </div>

        <ul className="mx-auto mt-10 grid max-w-3xl gap-3 sm:grid-cols-2">
          {[
            "Exploit cover, not just parametric",
            "Midnight-native privacy by default",
            "Underwriter-grade risk tooling without leaking LP books",
            "Buyer UX that explains cover in plain language",
          ].map((item) => (
            <li
              key={item}
              className="flex items-start gap-2.5 rounded-xl border border-border bg-bg-muted px-4 py-3 text-sm text-text-muted"
            >
              <span className="mt-0.5 text-accent" aria-hidden="true">
                ✓
              </span>
              {item}
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
