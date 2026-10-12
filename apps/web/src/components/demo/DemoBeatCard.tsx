import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { DemoBeat } from "@/lib/demoWalkthrough";
import { ProofLink } from "./ProofLink";

const chainBadge = {
  cardano: { variant: "cardano" as const, label: "Cardano Preview" },
  midnight: { variant: "midnight" as const, label: "Midnight Preprod" },
  both: { variant: "accent" as const, label: "Cardano + Midnight" },
};

/**
 * One beat of the guided demo. Deliberately a plain card-surface (no
 * backdrop-filter, no animated filters) so long scrolls stay smooth on iOS WebKit.
 */
export function DemoBeatCard({ beat, index, total }: { beat: DemoBeat; index: number; total: number }) {
  const badge = chainBadge[beat.chain];
  const n = String(index + 1).padStart(2, "0");
  return (
    <li id={`step-${index + 1}`} className="relative scroll-mt-28 pl-0 sm:pl-16">
      {/* Timeline rail + node (desktop) */}
      <span
        className="absolute left-[1.15rem] top-0 hidden h-full w-px bg-[var(--hairline)] sm:block"
        aria-hidden="true"
      />
      <span
        className={`absolute left-0 top-6 hidden h-[2.35rem] w-[2.35rem] items-center justify-center rounded-full border font-mono text-[12px] sm:flex ${
          beat.chain === "cardano"
            ? "border-[color-mix(in_srgb,var(--cardano)_45%,transparent)] bg-[var(--cardano-soft)] text-cardano"
            : beat.chain === "midnight"
              ? "border-[color-mix(in_srgb,var(--midnight)_45%,transparent)] bg-[var(--midnight-soft)] text-midnight"
              : "border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[var(--accent-glow)] text-accent-strong"
        }`}
        aria-hidden="true"
      >
        {n}
      </span>

      <article className="card-surface relative overflow-hidden p-6 sm:p-8" aria-labelledby={`step-${index + 1}-title`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono-label text-[10.5px] text-text-dim sm:hidden">
            Step {n} / {String(total).padStart(2, "0")}
          </span>
          <span className="hidden font-mono-label text-[10.5px] text-text-dim sm:inline">
            Step {index + 1} of {total}
          </span>
          <span className="h-px w-4 bg-[var(--hairline)]" aria-hidden="true" />
          <span className="font-mono-label text-[10.5px] text-text-muted">{beat.time}</span>
          <Badge variant={badge.variant} className="ml-auto">
            {badge.label}
          </Badge>
        </div>

        <h2 id={`step-${index + 1}-title`} className="mt-5 font-display text-[1.9rem] leading-[1.06] text-text sm:text-[2.4rem] text-balance">
          {beat.title}
        </h2>
        <p className="mt-1 font-mono text-[12px] text-text-dim">
          kshot3000.github.io/PlutusShield{beat.route === "/" ? "/" : `${beat.route}/`}
        </p>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-text-muted text-pretty">{beat.lede}</p>

        <div className="mt-7 grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8">
          <div>
            <p className="font-mono-label text-[10.5px] text-text-dim">Try it</p>
            <ol className="mt-3 space-y-2.5">
              {beat.steps.map((s, i) => (
                <li key={s} className="flex gap-3 text-[14px] leading-relaxed text-text-muted">
                  <span className="mt-[0.15rem] font-mono text-[11px] text-text-dim" aria-hidden="true">
                    {i + 1}.
                  </span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
            <div className="mt-5 rounded-2xl border border-[var(--hairline)] bg-white/[0.02] p-4">
              <p className="font-mono-label text-[10px] text-gold">What it proves</p>
              <p className="mt-1.5 text-[14px] leading-relaxed text-text">{beat.proves}</p>
            </div>
            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
              {beat.ctas.map((c, i) => (
                <Button
                  key={c.href}
                  href={c.href}
                  external={c.external}
                  variant={i === 0 ? "primary" : "secondary"}
                  className="w-full sm:w-auto"
                >
                  {c.label}
                  {i === 0 ? <Arrow /> : null}
                </Button>
              ))}
            </div>
          </div>

          <div className="self-start rounded-2xl border border-[var(--hairline)] bg-black/20 px-5 py-2">
            <p className="pt-3 font-mono-label text-[10.5px] text-text-dim">On-chain receipts</p>
            <ul className="divide-y divide-[var(--hairline)]">
              {beat.proofs.map((p) => (
                <ProofLink key={p.hash + p.label} proof={p} />
              ))}
            </ul>
          </div>
        </div>

        {beat.honest ? (
          <p className="mt-6 border-t border-[var(--hairline)] pt-4 text-[12.5px] leading-relaxed text-text-dim">
            <span className="text-text-muted">Honest status: </span>
            {beat.honest}
          </p>
        ) : null}
      </article>
    </li>
  );
}

function Arrow() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
