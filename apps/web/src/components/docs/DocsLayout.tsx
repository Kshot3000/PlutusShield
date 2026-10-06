import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { DOC_PAGES, type DocSlug, src } from "./nav";

export interface TocItem {
  id: string;
  label: string;
}

/**
 * Shared shell for every /docs page: page nav (left), article, and an
 * "On this page" table of contents (right on xl, folded into the mobile
 * menu below lg). Pure server component; no client JS.
 */
export function DocsLayout({
  slug,
  title,
  description,
  toc = [],
  sourcePaths = [],
  children,
}: {
  slug: DocSlug | "index";
  title: string;
  description: string;
  toc?: TocItem[];
  /** Repo paths this page is grounded in, linked at the bottom. */
  sourcePaths?: string[];
  children: ReactNode;
}) {
  const index = DOC_PAGES.findIndex((p) => p.slug === slug);
  const prev = index > 0 ? DOC_PAGES[index - 1] : null;
  const next = index >= 0 && index < DOC_PAGES.length - 1 ? DOC_PAGES[index + 1] : null;

  return (
    <AppShell active="docs" title={title} description={description}>
      <div className="grid gap-8 lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-12 xl:grid-cols-[13.5rem_minmax(0,1fr)_12rem]">
        {/* Mobile: one collapsible menu with pages + on-this-page */}
        <details className="glass-panel relative rounded-2xl px-5 py-4 lg:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between text-[14px] text-text [&::-webkit-details-marker]:hidden">
            <span>
              <span className="font-mono-label mr-3 text-[10px] text-text-dim">Docs</span>
              {slug === "index" ? "Overview" : DOC_PAGES[index]?.title}
            </span>
            <span aria-hidden="true" className="text-text-dim">▾</span>
          </summary>
          <div className="mt-4 border-t border-[var(--hairline)] pt-4">
            <PageNav slug={slug} />
            {toc.length > 0 ? (
              <div className="mt-5 border-t border-[var(--hairline)] pt-4">
                <Toc items={toc} />
              </div>
            ) : null}
          </div>
        </details>

        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <PageNav slug={slug} />
          </div>
        </aside>

        <article className="min-w-0 max-w-[46rem]">
          {children}

          {sourcePaths.length > 0 ? (
            <div className="mt-14 border-t border-[var(--hairline)] pt-6">
              <p className="font-mono-label text-[10px] text-text-dim">Grounded in</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {sourcePaths.map((p) => (
                  <li key={p}>
                    <a
                      href={src(p)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-white/[0.03] px-3 py-1.5 font-mono text-[11.5px] text-text-muted transition-colors hover:border-white/15 hover:text-text"
                    >
                      {p}
                      <span aria-hidden="true" className="text-text-dim">↗</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {slug !== "index" ? (
            <nav aria-label="Docs pagination" className="mt-10 grid gap-3 sm:grid-cols-2">
              {prev ? (
                <PagerLink href={`/docs/${prev.slug}`} dir="Previous" title={prev.title} />
              ) : (
                <PagerLink href="/docs" dir="Previous" title="Docs overview" />
              )}
              {next ? (
                <PagerLink href={`/docs/${next.slug}`} dir="Next" title={next.title} alignRight />
              ) : (
                <PagerLink href="/docs" dir="Back to" title="Docs overview" alignRight />
              )}
            </nav>
          ) : null}
        </article>

        {toc.length > 0 ? (
          <aside className="hidden xl:block">
            <div className="sticky top-24">
              <Toc items={toc} />
            </div>
          </aside>
        ) : null}
      </div>
    </AppShell>
  );
}

function PageNav({ slug }: { slug: DocSlug | "index" }) {
  const item = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`block rounded-xl px-3 py-2 text-[13.5px] leading-snug transition-colors duration-300 ${
        active
          ? "bg-white/[0.07] text-text shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]"
          : "text-text-muted hover:bg-white/[0.04] hover:text-text"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Documentation">
      <p className="font-mono-label mb-2 px-3 text-[10px] text-text-dim">Protocol docs</p>
      <ul className="flex flex-col gap-0.5">
        <li>{item("/docs", "Overview", slug === "index")}</li>
        {DOC_PAGES.map((p) => (
          <li key={p.slug}>{item(`/docs/${p.slug}`, p.title, p.slug === slug)}</li>
        ))}
      </ul>
    </nav>
  );
}

function Toc({ items }: { items: TocItem[] }) {
  return (
    <nav aria-label="On this page">
      <p className="font-mono-label mb-2 text-[10px] text-text-dim">On this page</p>
      <ul className="flex flex-col gap-1 border-l border-[var(--hairline)]">
        {items.map((t) => (
          <li key={t.id}>
            <a
              href={`#${t.id}`}
              className="-ml-px block border-l border-transparent py-1 pl-3 text-[13px] leading-snug text-text-muted transition-colors hover:border-accent hover:text-text"
            >
              {t.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function PagerLink({
  href,
  dir,
  title,
  alignRight = false,
}: {
  href: string;
  dir: string;
  title: string;
  alignRight?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`glass-panel lift relative block rounded-2xl px-5 py-4 hover:bg-white/[0.02] ${alignRight ? "sm:text-right" : ""}`}
    >
      <span className="font-mono-label block text-[10px] text-text-dim">
        {alignRight ? `${dir} →` : `← ${dir}`}
      </span>
      <span className="mt-1 block font-display text-xl text-text">{title}</span>
    </Link>
  );
}
