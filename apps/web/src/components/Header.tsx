"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "./ui/Button";
import { Container } from "./ui/Container";
import { Logo } from "./Logo";

const nav = [
  { href: "/#cover", label: "Cover" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#compare", label: "Why us" },
  { href: "/docs", label: "Docs" },
];

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const inApp = pathname.startsWith("/app") || pathname.startsWith("/cover") || pathname.startsWith("/pool");

  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] backdrop-blur-xl">
      <Container className="flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-8">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm text-text-muted transition-colors hover:bg-bg-card hover:text-text"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <Button href="/docs" variant="ghost" size="sm">
            Architecture
          </Button>
          <Button href={inApp ? "/app" : "/app"} size="sm">
            {inApp ? "Open app" : "Launch app"}
          </Button>
        </div>

        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border text-text md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="sr-only">Menu</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            {open ? (
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </Container>

      {open ? (
        <div id="mobile-nav" className="border-t border-border md:hidden">
          <Container className="flex flex-col gap-1 py-3">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2.5 text-sm text-text-muted hover:bg-bg-card hover:text-text"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
              <Button href="/app" size="md" className="w-full">
                Launch app
              </Button>
            </div>
          </Container>
        </div>
      ) : null}
    </header>
  );
}
