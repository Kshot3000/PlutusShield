"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { MILESTONES, RUNBOOK } from "@/lib/status";

export interface FlowStep {
  title: string;
  body: ReactNode;
}

/**
 * "Preview coming" call to action. Instead of a disabled button it opens the
 * exact steps the browser flow will take, the current launch status, and
 * where to go next. Nothing here builds or signs a transaction.
 */
export function PreviewFlow({
  cta,
  heading,
  steps,
  next,
}: {
  cta: string;
  heading: string;
  steps: FlowStep[];
  next: { href: string; label: string };
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const done = MILESTONES.filter((m) => m.state === "done").length;
  const upcoming = MILESTONES.find((m) => m.state === "next");

  return (
    <div className="mt-8">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="group flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[linear-gradient(180deg,#ffffff_0%,#dde3f6_100%)] px-5 text-sm font-medium text-[var(--text-inverse)] shadow-[0_1px_0_rgba(255,255,255,0.6)_inset,0_10px_30px_-10px_rgba(157,176,255,0.55)] transition-[transform,box-shadow] duration-300 hover:-translate-y-px hover:shadow-[0_1px_0_rgba(255,255,255,0.6)_inset,0_14px_40px_-8px_rgba(157,176,255,0.75)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <span className="rounded-full bg-[var(--text-inverse)]/90 px-1.5 py-0.5 font-mono-label text-[8.5px] text-[#e4c27a]">
          Preview
        </span>
        {cta}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <p className="mt-2.5 text-center text-[11px] text-text-dim">
        {done} of {MILESTONES.length} launch milestones done{upcoming ? ` · Next: ${upcoming.label.toLowerCase()}` : ""}
      </p>

      <div
        id={id}
        role="region"
        aria-label={heading}
        inert={!open}
        className={`grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="mt-5 rounded-2xl border border-[var(--hairline)] bg-bg-muted/70 p-5">
            <p className="font-mono-label text-[10px] text-gold">{heading}</p>
            <ol className="mt-4 space-y-4">
              {steps.map((s, i) => (
                <li key={s.title} className="flex gap-3">
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-strong font-mono text-[11px] text-text-muted"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-text">{s.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-5 flex flex-col gap-2 border-t border-[var(--hairline)] pt-4 text-xs sm:flex-row sm:items-center sm:justify-between">
              <Link href={next.href} className="text-accent-strong underline-offset-4 hover:underline">
                {next.label} →
              </Link>
              <a
                href={RUNBOOK}
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-muted underline-offset-4 hover:text-text hover:underline"
              >
                Preview deploy runbook <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
