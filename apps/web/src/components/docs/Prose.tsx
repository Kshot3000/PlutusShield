import Link from "next/link";
import type { ReactNode } from "react";

/* Typographic building blocks for docs pages, on the Ink & Aurora system. */

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-14 scroll-mt-28 border-t border-[var(--hairline)] pt-10 first:mt-0 first:border-t-0 first:pt-0">
      <h2 id={id} className="group font-display text-[1.85rem] leading-tight text-text sm:text-[2.1rem]">
        {title}
        <a
          href={`#${id}`}
          className="ml-2 text-[0.7em] text-text-dim opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={`Link to section: ${title}`}
        >
          #
        </a>
      </h2>
      <div className="mt-5 flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function H3({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3 id={id} className="mt-4 scroll-mt-28 text-[16px] font-medium tracking-[-0.01em] text-text">
      {children}
    </h3>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-[15px] leading-[1.75] text-text-muted text-pretty">{children}</p>;
}

export function Strong({ children }: { children: ReactNode }) {
  return <strong className="font-medium text-text">{children}</strong>;
}

export function C({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md border border-[var(--hairline)] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[0.84em] text-accent-strong">
      {children}
    </code>
  );
}

export function List({ children, ordered = false }: { children: ReactNode; ordered?: boolean }) {
  const cls =
    "flex flex-col gap-2 pl-5 text-[15px] leading-[1.7] text-text-muted marker:text-text-dim " +
    (ordered ? "list-decimal" : "list-disc");
  return ordered ? <ol className={cls}>{children}</ol> : <ul className={cls}>{children}</ul>;
}

/** Monospace block for formulas and on-chain shapes. */
export function Formula({ children, label }: { children: string; label?: string }) {
  return (
    <figure className="glass relative overflow-hidden rounded-2xl">
      {label ? (
        <figcaption className="font-mono-label border-b border-[var(--hairline)] px-4 py-2 text-[9.5px] text-text-dim">
          {label}
        </figcaption>
      ) : null}
      {/* Focusable so keyboard users can scroll long lines (WCAG 2.1.1). */}
      <pre
        tabIndex={0}
        aria-label={label ? `${label} (code)` : "Code"}
        className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-[1.7] text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <code>{children}</code>
      </pre>
    </figure>
  );
}

export function Table({
  head,
  rows,
  caption,
}: {
  head: ReactNode[];
  rows: ReactNode[][];
  caption?: string;
}) {
  return (
    <div>
    <div
      className="glass overflow-x-auto rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      tabIndex={0}
      role="region"
      aria-label={caption ?? "Table"}
    >
      <table className="w-full min-w-[32rem] border-collapse text-left text-[13.5px]">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-[var(--hairline)]">
            {head.map((h, i) => (
              <th key={i} scope="col" className="font-mono-label px-4 py-3 text-[9.5px] font-medium text-text-dim">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-[var(--hairline)] last:border-b-0 align-top">
              {r.map((cell, j) => (
                <td key={j} className={`px-4 py-3 leading-relaxed ${j === 0 ? "text-text" : "text-text-muted"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {head.length > 2 ? (
      <p className="mt-1.5 text-right font-mono text-[10px] text-text-dim sm:hidden" aria-hidden="true">
        Swipe for more →
      </p>
    ) : null}
    </div>
  );
}

const calloutTone = {
  info: { bar: "bg-accent", label: "text-accent", name: "Note" },
  planned: { bar: "bg-midnight", label: "text-midnight", name: "Planned" },
  warn: { bar: "bg-gold", label: "text-gold", name: "Heads up" },
  danger: { bar: "bg-[var(--danger)]", label: "text-[var(--danger)]", name: "Risk" },
} as const;

export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: keyof typeof calloutTone;
  title?: string;
  children: ReactNode;
}) {
  const t = calloutTone[tone];
  return (
    <aside className="glass relative overflow-hidden rounded-2xl py-4 pl-6 pr-5">
      <span className={`absolute inset-y-0 left-0 w-[3px] ${t.bar}`} aria-hidden="true" />
      <p className={`font-mono-label text-[10px] ${t.label}`}>{title ?? t.name}</p>
      <div className="mt-2 flex flex-col gap-2 text-[14px] leading-relaxed text-text-muted">{children}</div>
    </aside>
  );
}

export function DocLink({ href, children }: { href: string; children: ReactNode }) {
  const cls = "text-accent-strong underline decoration-[var(--border-accent)] underline-offset-[3px] transition-colors hover:text-text hover:decoration-current";
  if (href.startsWith("http")) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {children}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

/** Labelled step in a lifecycle sequence. */
export function Steps({ items }: { items: { title: string; body: ReactNode; chain?: "Cardano" | "Midnight" }[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {items.map((s, i) => (
        <li key={s.title} className="glass relative grid grid-cols-[auto_1fr] gap-4 rounded-2xl p-5">
          <span className="font-mono-label flex h-7 w-7 items-center justify-center rounded-full border border-[var(--hairline)] text-[10px] text-text-muted">
            {String(i + 1).padStart(2, "0")}
          </span>
          <div>
            <p className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-text">
              {s.title}
              {s.chain ? (
                <span className={`font-mono-label text-[9.5px] ${s.chain === "Cardano" ? "text-cardano" : "text-midnight"}`}>
                  {s.chain}
                </span>
              ) : null}
            </p>
            <div className="mt-1.5 text-[14px] leading-relaxed text-text-muted">{s.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
