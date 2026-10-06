import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

const links = [
  { href: "/cover", label: "Quote depeg cover", note: "ADA or USDC" },
  { href: "/pool", label: "Simulate underwriting", note: "Shares and premiums" },
  { href: "/app", label: "Your shield", note: "Status and roadmap" },
  { href: "/docs", label: "Protocol docs", note: "How it actually works" },
];

export default function NotFound() {
  return (
    <section className="relative isolate flex flex-1 items-center overflow-hidden py-24 sm:py-32">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(124,140,255,0.16),transparent)] blur-2xl"
      />
      <Container className="max-w-[760px]">
        <Badge variant="accent">404 · Not covered</Badge>
        <h1 className="mt-6 font-display text-[2.8rem] leading-[1.02] text-text sm:text-6xl">
          This page isn&apos;t <span className="italic text-accent-strong">covered.</span>
        </h1>
        <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-text-muted sm:text-[17px]">
          The link may be old, or the page moved when the docs were reorganised. Everything that exists is one
          click away.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button href="/" size="lg">
            Back to home
          </Button>
          <Button href="/docs" variant="secondary" size="lg">
            Browse the docs
          </Button>
        </div>
        <nav aria-label="Popular pages" className="mt-12">
          <ul className="grid gap-3 sm:grid-cols-2">
            {links.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="group flex items-center justify-between rounded-2xl border border-[var(--hairline)] bg-white/[0.035] px-5 py-4 transition-colors hover:border-white/15 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span className="flex flex-col">
                    <span className="text-[15px] text-text">{l.label}</span>
                    <span className="text-[12.5px] text-text-muted">{l.note}</span>
                  </span>
                  <span aria-hidden="true" className="text-text-dim transition-transform group-hover:translate-x-0.5">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Container>
    </section>
  );
}
