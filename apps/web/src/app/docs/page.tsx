import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/Badge";

export const metadata: Metadata = {
  title: "Docs",
  description: "PlutusShield documentation — architecture, product, and competitive landscape.",
};

const docs = [
  {
    title: "Architecture",
    href: "https://github.com/Kshot3000/PlutusShield/blob/main/docs/ARCHITECTURE.md",
    summary:
      "Dual-chain system design, privacy boundaries, MVP scope, and trust assumptions.",
    tag: "System",
  },
  {
    title: "Product",
    href: "https://github.com/Kshot3000/PlutusShield/blob/main/docs/PRODUCT.md",
    summary:
      "Stakeholders, cover types, UX pillars, and pricing principles (design stage).",
    tag: "Product",
  },
  {
    title: "Competitive landscape",
    href: "https://github.com/Kshot3000/PlutusShield/blob/main/docs/COMPETITIVE.md",
    summary:
      "Honest comparison vs Aegis parametric cover and how PlutusShield aims to win.",
    tag: "Market",
  },
  {
    title: "Repository README",
    href: "https://github.com/Kshot3000/PlutusShield",
    summary: "Vision, dual-chain story, roadmap, and monorepo layout.",
    tag: "Repo",
  },
];

export default function DocsPage() {
  return (
    <AppShell
      active="docs"
      title="Documentation"
      description="Canonical docs live in the GitHub repo. This page links out — no fabricated metrics or fake API references."
    >
      <ul className="grid gap-4 sm:grid-cols-2">
        {docs.map((doc) => (
          <li key={doc.href}>
            <a
              href={doc.href}
              target="_blank"
              rel="noopener noreferrer"
              className="glass-panel lift relative block h-full p-7 hover:bg-white/[0.02]"
            >
              <Badge variant="accent">{doc.tag}</Badge>
              <h2 className="mt-5 font-display text-[1.65rem] leading-tight text-text">
                {doc.title}
                <span className="ml-2 text-text-dim" aria-hidden="true">
                  ↗
                </span>
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-text-muted">
                {doc.summary}
              </p>
            </a>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
