import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { DocsLayout } from "@/components/docs/DocsLayout";
import { DOC_PAGES, SOURCE_CODE, SOURCE_DOCS } from "@/components/docs/nav";
import { Callout, DocLink, Section } from "@/components/docs/Prose";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "PlutusShield protocol docs: how cover works, pricing, the underwriting pool, oracle settlement, Midnight privacy, and honest risk disclosures.",
};

const status = [
  { k: "Cardano validators", v: "Aiken, Plutus V3 · ADA + USDC tranches · 72 tests passing" },
  { k: "Midnight registry", v: "Compact 0.31.1 · 6 circuits · 18 tests passing" },
  { k: "Deployment", v: "None yet. Preview tooling ready and emulator-tested, awaiting a funded deployer" },
  { k: "Audit", v: "Not audited" },
  { k: "Purchases", v: "Closed. The quote calculator is a preview" },
];

export default function DocsPage() {
  return (
    <DocsLayout
      slug="index"
      title="Documentation"
      description="How PlutusShield actually works, written from the contract code on main. Each rule here links back to the source that enforces it."
      toc={[
        { id: "protocol", label: "Protocol docs" },
        { id: "status", label: "Status" },
        { id: "source-docs", label: "Source docs" },
        { id: "source-code", label: "Source code" },
      ]}
    >
      <Section id="protocol" title="Protocol docs">
        <ul className="grid gap-4 sm:grid-cols-2">
          {DOC_PAGES.map((doc) => (
            <li key={doc.slug}>
              <Link
                href={`/docs/${doc.slug}`}
                className="glass-panel lift relative flex h-full flex-col p-6 hover:bg-white/[0.02]"
              >
                <Badge variant={doc.tone}>{doc.tag}</Badge>
                <h3 className="mt-4 font-display text-[1.5rem] leading-tight text-text">
                  {doc.title}
                  <span className="ml-2 text-text-dim" aria-hidden="true">→</span>
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-text-muted">{doc.summary}</p>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="status" title="Status">
        <dl className="glass divide-y divide-[var(--hairline)] overflow-hidden rounded-2xl">
          {status.map((s) => (
            <div key={s.k} className="grid gap-1 px-5 py-3.5 sm:grid-cols-[12rem_1fr] sm:gap-4">
              <dt className="font-mono-label text-[10px] leading-6 text-text-dim">{s.k}</dt>
              <dd className="text-[14px] leading-6 text-text">{s.v}</dd>
            </div>
          ))}
        </dl>
        <Callout tone="warn" title="Preview software">
          <p>
            Nothing on this site moves funds. Read <DocLink href="/docs/risks">Risks &amp; disclosures</DocLink>{" "}
            before relying on anything described here.
          </p>
        </Callout>
      </Section>

      <Section id="source-docs" title="Source docs">
        <p className="text-[15px] leading-[1.75] text-text-muted">
          The design documents in the repository go deeper on system design and positioning.
        </p>
        <ul className="grid gap-4 sm:grid-cols-2">
          {SOURCE_DOCS.map((doc) => (
            <li key={doc.href}>
              <a
                href={doc.href}
                target="_blank"
                rel="noopener noreferrer"
                className="glass-panel lift relative block h-full p-6 hover:bg-white/[0.02]"
              >
                <Badge variant="accent">{doc.tag}</Badge>
                <h3 className="mt-4 font-display text-[1.4rem] leading-tight text-text">
                  {doc.title}
                  <span className="ml-2 text-text-dim" aria-hidden="true">↗</span>
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-text-muted">{doc.summary}</p>
              </a>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="source-code" title="Source code">
        <ul className="glass divide-y divide-[var(--hairline)] overflow-hidden rounded-2xl">
          {SOURCE_CODE.map((s) => (
            <li key={s.href}>
              <a
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col gap-0.5 px-5 py-3.5 transition-colors hover:bg-white/[0.03] sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="font-mono text-[13px] text-text">{s.label}</span>
                <span className="text-[13px] text-text-muted">
                  {s.note} <span aria-hidden="true" className="text-text-dim">↗</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </Section>
    </DocsLayout>
  );
}
