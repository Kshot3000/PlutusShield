import Link from "next/link";
import type { ReactNode } from "react";
import { Container } from "../ui/Container";
import { SectionHeading } from "../ui/SectionHeading";

type Tone = "accent" | "cardano" | "midnight";

const covers: {
  title: string;
  trigger: string;
  example: string;
  tone: Tone;
  icon: ReactNode;
}[] = [
  {
    title: "Smart-contract exploit cover",
    trigger: "Evidence-based",
    example:
      "A covered DEX validator is drained through a logic bug. Evidence stays private on Midnight; assessors review under disclosure proofs; payout settles on Cardano.",
    tone: "midnight",
    icon: (
      <path
        d="M12 3l7 3v5c0 4.4-2.9 8.3-7 9.6C7.9 19.3 5 15.4 5 11V6l7-3zM12 8v4.5M12 15.5v.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: "Parametric DeFi events",
    trigger: "Multi-oracle trigger",
    example:
      "A stablecoin depegs below a defined threshold, an oracle goes stale, or deviation runs past bounds. Payout fires automatically when the on-chain condition is met.",
    tone: "cardano",
    icon: (
      <path
        d="M3 12h3.5l2.5-6 4 12 2.5-6H21"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: "Protocol SLA cover",
    trigger: "Service-level breach",
    example:
      "A covered protocol’s critical service — batcher, oracle, or bridge — is unavailable beyond the agreed window. The trigger definition is part of the policy terms.",
    tone: "accent",
    icon: (
      <>
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  },
];

const toneCls: Record<Tone, { text: string; glow: string; line: string; chip: string }> = {
  cardano: {
    text: "text-cardano",
    glow: "bg-[rgba(64,105,255,0.28)]",
    line: "via-cardano",
    chip: "border-cardano/25 bg-[var(--cardano-soft)]",
  },
  midnight: {
    text: "text-midnight",
    glow: "bg-[rgba(140,100,255,0.28)]",
    line: "via-midnight",
    chip: "border-midnight/25 bg-[var(--midnight-soft)]",
  },
  accent: {
    text: "text-accent",
    glow: "bg-[rgba(157,176,255,0.24)]",
    line: "via-accent",
    chip: "border-accent/25 bg-[var(--accent-glow)]",
  },
};

export function CoverTypes() {
  return (
    <section className="relative py-24 sm:py-32" id="cover">
      <div className="hairline-x absolute inset-x-0 top-0" aria-hidden="true" />
      <Container>
        <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
          <SectionHeading
            align="left"
            index="03"
            eyebrow="Cover types"
            title={
              <>
                Protection shaped
                <br />
                to <em className="text-shield-grad">real risk.</em>
              </>
            }
            description="Parametric where an objective trigger exists. Evidence-based claims where it doesn’t — like smart-contract exploits."
            className="lg:mb-16"
          />
          <Link
            href="/cover"
            className="reveal group mb-14 inline-flex items-center gap-2 self-start text-[14px] text-text-muted transition-colors hover:text-text lg:mb-[4.5rem] lg:self-auto"
          >
            Try the quote calculator
            <span className="transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true">
              →
            </span>
          </Link>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          {covers.map((cover) => {
            const t = toneCls[cover.tone];
            return (
              <article
                key={cover.title}
                className="reveal glass-panel lift group relative flex flex-col overflow-hidden p-7 sm:p-8"
              >
                <div
                  className={`pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full opacity-0 blur-3xl transition-opacity duration-700 group-hover:opacity-100 ${t.glow}`}
                  aria-hidden="true"
                />
                <div
                  className={`absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent ${t.line} to-transparent opacity-60`}
                  aria-hidden="true"
                />
                <div className="relative flex items-start justify-between">
                  <span className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${t.chip} ${t.text}`}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      {cover.icon}
                    </svg>
                  </span>
                  <span className={`font-mono-label text-[9.5px] ${t.text}`}>{cover.trigger}</span>
                </div>
                <h3 className="relative mt-12 font-display text-[1.75rem] leading-[1.1] text-text">
                  {cover.title}
                </h3>
                <p className="relative mt-4 flex-1 text-[14.5px] leading-relaxed text-text-muted text-pretty">
                  {cover.example}
                </p>
                <p className="relative mt-8 border-t border-[var(--hairline)] pt-4 font-mono-label text-[9.5px] text-text-dim">
                  Example scenario · Not live
                </p>
              </article>
            );
          })}
        </div>

        <p className="reveal mt-10 text-center text-[13.5px] text-text-dim">
          Full product definitions in{" "}
          <a
            href="https://github.com/Kshot3000/PlutusShield/blob/main/docs/PRODUCT.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-muted underline decoration-white/20 underline-offset-4 transition-colors hover:text-text hover:decoration-white/50"
          >
            PRODUCT.md
          </a>
          .
        </p>
      </Container>
    </section>
  );
}
