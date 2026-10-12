"use client";

import { useState } from "react";

/**
 * A copyable shell command. Plain surface (no backdrop-filter, no animated
 * filters) so long pages stay smooth on iOS WebKit.
 */
export function CommandBlock({ cmd, label }: { cmd: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(cmd);
      else {
        const ta = document.createElement("textarea");
        ta.value = cmd;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the command is still selectable */
    }
  };
  return (
    <div className="group relative rounded-2xl border border-[var(--hairline)] bg-black/40">
      {label ? (
        <p className="border-b border-[var(--hairline)] px-4 py-2 font-mono-label text-[9.5px] text-text-dim">{label}</p>
      ) : null}
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="select-none font-mono text-[12.5px] leading-relaxed text-accent" aria-hidden="true">
          $
        </span>
        <code className="min-w-0 flex-1 whitespace-pre-wrap font-mono [overflow-wrap:anywhere] text-[12.5px] leading-relaxed text-text">
          {cmd}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy command"}
          className="shrink-0 rounded-full border border-[var(--hairline)] px-2.5 py-1 font-mono-label text-[9.5px] text-text-muted transition-colors hover:border-white/15 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
