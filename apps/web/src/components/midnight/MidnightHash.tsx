"use client";
import { useState } from "react";
import { midnightExplorerContract, midnightExplorerTx, shortHash } from "@/lib/midnightPreprod";

/**
 * A Midnight Preprod tx hash or contract address: links to the working
 * explorer when the value resolves there, and always offers a copy button
 * so nobody is stuck on a dead link.
 */
export function MidnightHash({
  h,
  kind = "tx",
  full = false,
  className = "font-mono text-[11px] text-text",
  title,
}: {
  h: string;
  kind?: "tx" | "contract";
  full?: boolean;
  className?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  const href = kind === "contract" ? midnightExplorerContract(h) : midnightExplorerTx(h);
  const label = full ? h : shortHash(h);
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(h);
      else {
        const ta = document.createElement("textarea");
        ta.value = h;
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
      /* clipboard blocked: the full value is still in the title/tooltip */
    }
  };
  return (
    <span className={`inline-flex max-w-full items-baseline gap-1 ${full ? "break-all" : ""}`}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" title={title ?? h} className={`${className} underline decoration-dotted underline-offset-4 hover:text-midnight`}>
          {label}
        </a>
      ) : (
        <span className={className} title={title ?? h}>
          {label}
        </span>
      )}
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : `Copy ${kind === "contract" ? "contract address" : "transaction hash"}`}
        className="shrink-0 rounded px-1 font-mono text-[10px] text-text-dim hover:text-text"
      >
        {copied ? "copied" : "copy"}
      </button>
    </span>
  );
}
