import Link from "next/link";
import { Container } from "./ui/Container";
import { Logo } from "./Logo";

const columns = [
  {
    title: "Product",
    links: [
      { href: "/cover", label: "Cover" },
      { href: "/pool", label: "Underwrite" },
      { href: "/app", label: "App" },
    ],
  },
  {
    title: "Docs",
    links: [
      { href: "/docs", label: "Overview" },
      {
        href: "https://github.com/Kshot3000/PlutusShield/blob/main/docs/ARCHITECTURE.md",
        label: "Architecture",
        external: true,
      },
      {
        href: "https://github.com/Kshot3000/PlutusShield/blob/main/docs/PRODUCT.md",
        label: "Product",
        external: true,
      },
      {
        href: "https://github.com/Kshot3000/PlutusShield/blob/main/docs/COMPETITIVE.md",
        label: "Competitive",
        external: true,
      },
    ],
  },
  {
    title: "Chains",
    links: [
      { href: "https://cardano.org", label: "Cardano", external: true },
      { href: "https://midnight.network", label: "Midnight", external: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative mt-auto overflow-hidden">
      <div className="hairline-x absolute inset-x-0 top-0" aria-hidden="true" />
      <Container className="relative pb-10 pt-20">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-text-muted">
              DeFi insurance for Cardano and Midnight — settlement you can audit,
              privacy where it matters.
            </p>
            <p className="mt-4 font-mono-label text-[10px] text-text-dim">
              Design preview · No live cover yet
            </p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <h3 className="font-mono-label text-[9.5px] text-text-dim">{col.title}</h3>
              <ul className="mt-5 space-y-3">
                {col.links.map((link) => (
                  <li key={link.href}>
                    {"external" in link && link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[14px] text-text-muted transition-colors duration-300 hover:text-text"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-[14px] text-text-muted transition-colors duration-300 hover:text-text"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p
          className="pointer-events-none mt-20 select-none whitespace-nowrap text-center font-display text-[17vw] leading-[0.8] text-transparent [-webkit-text-stroke:1px_rgba(197,208,255,0.12)] lg:text-[13.5rem]"
          aria-hidden="true"
        >
          Plutus<em>Shield</em>
        </p>
        <div className="mt-10 flex flex-col gap-3 border-t border-[var(--hairline)] pt-6 text-xs text-text-dim sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} PlutusShield. MIT licensed.</p>
          <p className="max-w-md sm:text-right">
            Not an offer of insurance or investment advice. Pre-release software under active design.
          </p>
        </div>
      </Container>
    </footer>
  );
}
