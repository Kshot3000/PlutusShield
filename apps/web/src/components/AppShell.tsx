import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Container } from "./ui/Container";

const tabs = [
  { href: "/app", label: "Overview" },
  { href: "/cover", label: "Cover" },
  { href: "/pool", label: "Pool" },
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
  active: "app" | "cover" | "pool" | "docs";
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col border-t border-border bg-bg">
      <div className="border-b border-border bg-bg-elevated">
        <Container className="py-8 sm:py-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <Badge variant="gold" className="mb-3">
                Design preview · Coming soon
              </Badge>
              <h1 className="font-display text-3xl tracking-tight text-text sm:text-4xl">
                {title}
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-text-muted sm:text-base">
                {description}
              </p>
            </div>
            <Button href="/" variant="secondary" size="sm">
              ← Marketing site
            </Button>
          </div>
          <nav
            className="mt-8 flex gap-1 overflow-x-auto border-t border-border pt-4"
            aria-label="App sections"
          >
            {tabs.map((tab) => {
              const isActive =
                (active === "app" && tab.href === "/app") ||
                (active === "cover" && tab.href === "/cover") ||
                (active === "pool" && tab.href === "/pool") ||
                (active === "docs" && tab.href === "/docs");
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`rounded-lg px-3.5 py-2 text-sm whitespace-nowrap transition-colors ${
                    isActive
                      ? "bg-[var(--accent-glow)] text-accent"
                      : "text-text-muted hover:bg-bg-card hover:text-text"
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
      <Container className="flex-1 py-10 sm:py-12">{children}</Container>
    </div>
  );
}

export function ComingSoonPanel({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="card-surface mx-auto max-w-lg p-8 text-center sm:p-10">
      <div
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-[color-mix(in_srgb,var(--accent)_35%,var(--border))] bg-[var(--accent-glow)] text-accent"
        aria-hidden="true"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 3l7 3.2v5.1c0 4.4-2.9 8.4-7 9.7-4.1-1.3-7-5.3-7-9.7V6.2L12 3z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h2 className="mt-5 text-lg font-semibold tracking-tight text-text">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-text-muted">{body}</p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button href="/docs" size="sm">
          Read docs
        </Button>
        <Button
          href="https://github.com/Kshot3000/PlutusShield"
          external
          variant="secondary"
          size="sm"
        >
          GitHub
        </Button>
      </div>
    </div>
  );
}

export function PlaceholderMetric({
  label,
  hint = "Coming soon",
}: {
  label: string;
  hint?: string;
}) {
  return (
    <div className="card-surface p-5">
      <p className="font-mono-label text-[10px] text-text-dim">{label}</p>
      <p className="mt-2 font-display text-3xl text-text-muted">—</p>
      <p className="mt-1 text-xs text-text-dim">{hint}</p>
    </div>
  );
}
