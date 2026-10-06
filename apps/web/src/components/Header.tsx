"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "./ui/Button";
import { Logo } from "./Logo";

const nav = [
  { href: "/cover", label: "Buy cover" },
  { href: "/pool", label: "Underwrite" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#dual-chain", label: "Architecture" },
  { href: "/docs", label: "Docs" },
];

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const inApp =
    pathname.startsWith("/app") ||
    pathname.startsWith("/cover") ||
    pathname.startsWith("/pool") ||
    pathname.startsWith("/claim");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    if (!open) return () => {
      document.body.style.overflow = "";
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Close the menu whenever the route changes (e.g. browser back).
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  const cta = pathname.startsWith("/cover")
    ? { href: "/app", label: "Your shield" }
    : inApp
      ? { href: "/cover", label: "Get a quote" }
      : { href: "/app", label: "Launch app" };

  const isActive = (href: string) => !href.startsWith("/#") && (pathname === href || pathname.startsWith(`${href}/`));

  return (
    <header className="sticky top-0 z-50 px-3 pt-3 sm:px-5">
      <div
        className={`mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-4 rounded-full pl-4 pr-2 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] sm:pl-5 ${
          scrolled || open
            ? "glass shadow-[0_20px_50px_-24px_rgba(0,0,0,0.9)]"
            : "border border-transparent"
        }`}
      >
        <Logo />

        <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Primary">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={`rounded-full px-3.5 py-2 text-[13.5px] transition-colors duration-300 hover:bg-white/[0.04] hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                isActive(item.href) ? "text-text" : "text-text-muted"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-1.5 lg:flex">
          <Button
            href="https://github.com/Kshot3000/PlutusShield"
            external
            variant="ghost"
            size="sm"
          >
            <GitHubIcon />
            GitHub
          </Button>
          <Button href={cta.href} size="sm">
            {cta.label}
          </Button>
        </div>

        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-text transition-colors hover:bg-white/[0.06] lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="relative block h-3 w-5" aria-hidden="true">
            <span
              className={`absolute left-0 h-px w-5 bg-current transition-all duration-300 ${
                open ? "top-1.5 rotate-45" : "top-0"
              }`}
            />
            <span
              className={`absolute left-0 h-px w-5 bg-current transition-all duration-300 ${
                open ? "top-1.5 -rotate-45" : "top-3"
              }`}
            />
          </span>
        </button>
      </div>

      <div
        id="mobile-nav"
        className={`fixed inset-x-3 top-[4.75rem] bottom-3 z-40 origin-top overflow-y-auto rounded-[1.75rem] transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] lg:hidden ${
          open
            ? "glass-panel pointer-events-auto translate-y-0 opacity-100 menu-solid"
            : "pointer-events-none -translate-y-2 opacity-0"
        }`}
        inert={!open}
      >
        <nav className="flex h-full flex-col p-6" aria-label="Mobile">
          <ul className="flex flex-col">
            {nav.map((item, i) => (
              <li key={item.href} className="border-b border-[var(--hairline)]">
                <Link
                  href={item.href}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className="flex items-baseline justify-between py-4 font-display text-3xl text-text"
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                  <span className="font-mono-label text-[10px] text-text-dim">0{i + 1}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-auto flex flex-col gap-2.5 pt-8">
            <Button href="/cover" size="lg" className="w-full">
              Get a quote
            </Button>
            <Button href="/app" variant="secondary" size="lg" className="w-full">
              Open the app
            </Button>
            <Button
              href="https://github.com/Kshot3000/PlutusShield"
              external
              variant="secondary"
              size="lg"
              className="w-full"
            >
              View on GitHub
            </Button>
            <p className="mt-3 text-center font-mono-label text-[10px] text-text-dim">
              Preview build · No live cover yet
            </p>
          </div>
        </nav>
      </div>
    </header>
  );
}

function GitHubIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 007.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 015.77 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.24 2.75.12 3.04.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0023.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}
