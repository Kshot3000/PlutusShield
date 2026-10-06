import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Container } from "./ui/Container";

const tabs = [
  { href: "/app", label: "Overview" },
  { href: "/cover", label: "Cover" },
  { href: "/pool", label: "Pool" },
  { href: "/claim", label: "Claims" },
  { href: "/docs", label: "Docs" },
];

export function AppShell({
  title,
  description,
  active,
  children,
}: {
  title: string;
  description: string;
  active: "app" | "cover" | "pool" | "claim" | "docs";
  children?: ReactNode;
}) {
  return (
    <div className="relative isolate -mt-[4.25rem] flex flex-1 flex-col pt-[4.25rem]">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] overflow-hidden" aria-hidden="true">
        <div className="absolute inset-0 grid-fade opacity-60" />
        <div className="absolute -left-[10%] -top-[40%] h-full w-[55%] rounded-full bg-[radial-gradient(closest-side,rgba(64,105,255,0.22),transparent)] blur-3xl" />
        <div className="absolute -right-[10%] -top-[30%] h-full w-[50%] rounded-full bg-[radial-gradient(closest-side,rgba(140,100,255,0.2),transparent)] blur-3xl" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-bg" />
      </div>
      <div className="relative">
        <Container className="pb-4 pt-12 sm:pt-16">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <Badge variant="gold" className="animate-rise mb-5">
                <span className="animate-pulse-dot h-1.5 w-1.5 rounded-full bg-gold text-gold" aria-hidden="true" />
                Preview build · Testnet next
              </Badge>
              <h1 className="animate-rise delay-1 font-display text-[2.6rem] leading-[1.02] text-text sm:text-6xl">
                {title}
              </h1>
              <p className="animate-rise delay-2 mt-4 max-w-xl text-[15px] leading-relaxed text-text-muted sm:text-[17px] text-pretty">
                {description}
              </p>
            </div>
            <Button href="/" variant="secondary" size="sm" className="self-start sm:self-auto">
              ← Back to site
            </Button>
          </div>
          <nav
            className="glass mt-10 inline-flex max-w-full gap-1 overflow-x-auto rounded-full p-1"
            aria-label="App sections"
          >
            {tabs.map((tab) => {
              const isActive =
                (active === "app" && tab.href === "/app") ||
                (active === "cover" && tab.href === "/cover") ||
                (active === "pool" && tab.href === "/pool") ||
                (active === "claim" && tab.href === "/claim") ||
                (active === "docs" && tab.href === "/docs");
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`rounded-full px-4 py-2 text-[13.5px] whitespace-nowrap transition-all duration-300 ${
                    isActive
                      ? "bg-white/[0.09] text-text shadow-[0_1px_0_rgba(255,255,255,0.08)_inset]"
                      : "text-text-muted hover:bg-white/[0.04] hover:text-text"
                  }`}
                  aria-current={isActive ? "page" : undefined}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </Container>
      </div>
      <Container className="flex-1 pb-20 pt-8 sm:pb-28 sm:pt-10">{children}</Container>
    </div>
  );
}
