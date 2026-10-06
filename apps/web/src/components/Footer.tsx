import Link from "next/link";
import { Container } from "./ui/Container";
import { Logo } from "./Logo";

const columns = [
  {
    title: "Product",
    links: [
      { href: "/cover", label: "Quote cover" },
      { href: "/pool", label: "Underwrite" },
      { href: "/app", label: "App" },
    ],
  },
  {
    title: "Docs",
    links: [
      { href: "/docs", label: "Overview" },
      { href: "/docs/how-cover-works", label: "How cover works" },
      { href: "/docs/settlement", label: "Settlement" },
      { href: "/docs/risks", label: "Risks & disclosures" },
      {
        href: "https://github.com/Kshot3000/PlutusShield/blob/main/docs/ARCHITECTURE.md",
        label: "Architecture",
        external: true,
      },
    ],
  },
  {
    title: "Ecosystem",
    links: [
      { href: "https://cardano.org", label: "Cardano", external: true },
      { href: "https://midnight.network", label: "Midnight", external: true },
      { href: "https://github.com/Kshot3000/PlutusShield", label: "GitHub", external: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative mt-auto overflow-hidden">
      <div className="hairline-x absolute inset-x-0 top-0" aria-hidden="true" />
      <Container className="relative pb-10 pt-20">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="col-span-2 max-w-sm md:col-span-1">
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-text-muted">
              DeFi insurance for Cardano and Midnight — settlement you can audit,
              privacy where it matters.
            </p>
            <p className="mt-4 font-mono-label text-[10px] text-text-dim">
              Preview build · No live cover yet
            </p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <h2 className="font-mono-label text-[9.5px] text-text-dim">{col.title}</h2>
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
                        <span aria-hidden="true" className="ml-1 text-text-dim">↗</span>
                        <span className="sr-only"> (opens in a new tab)</span>
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
            Not an offer of insurance or investment advice. Pre-release software, not audited.
          </p>
        </div>
      </Container>
    </footer>
  );
}
