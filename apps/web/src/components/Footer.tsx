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
    <footer className="mt-auto border-t border-border bg-bg-elevated">
      <Container className="py-14">
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
              <h3 className="font-mono-label text-[10px] text-text-dim">{col.title}</h3>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    {"external" in link && link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-text-muted transition-colors hover:text-text"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-text-muted transition-colors hover:text-text"
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
        <div className="mt-12 flex flex-col gap-3 border-t border-border pt-6 text-xs text-text-dim sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} PlutusShield. MIT licensed.</p>
          <p className="max-w-md sm:text-right">
            Not an offer of insurance or investment advice. Pre-release software under active design.
          </p>
        </div>
      </Container>
    </footer>
  );
}
