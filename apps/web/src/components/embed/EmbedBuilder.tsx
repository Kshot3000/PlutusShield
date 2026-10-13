"use client";

import { useMemo, useState } from "react";
import {
  EMBED_DEFAULTS,
  PRODUCTS,
  embedQuery,
  embedResizeScript,
  embedSnippet,
  validateEmbedConfig,
  type EmbedConfig,
  type EmbedProduct,
} from "@plutusshield/sdk";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const SITE_ROOT =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.NEXT_PUBLIC_BASE_PATH ? `https://kshot3000.github.io${process.env.NEXT_PUBLIC_BASE_PATH}` : "https://kshot3000.github.io/PlutusShield");

const fieldCls =
  "h-10 w-full rounded-lg border border-border-strong bg-bg-muted px-3 text-[13.5px] text-text outline-none focus:border-accent";
const label = "font-mono-label text-[10px] text-text-dim";

export function EmbedBuilder() {
  const [cfg, setCfg] = useState<EmbedConfig>({ ...EMBED_DEFAULTS, product: "exploit", amount: 250 });
  const [amountText, setAmountText] = useState("250");
  const [daysText, setDaysText] = useState(String(EMBED_DEFAULTS.days));
  const [refText, setRefText] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const draft: EmbedConfig = useMemo(
    () => ({
      ...cfg,
      amount: Number(amountText),
      days: Number(daysText),
      ref: refText.trim() === "" ? null : refText.trim().toLowerCase(),
    }),
    [cfg, amountText, daysText, refText],
  );
  const errors = validateEmbedConfig(draft);
  const valid = errors.length === 0;
  const snippet = valid ? embedSnippet(draft, { siteRoot: SITE_ROOT }) : "";
  const previewSrc = valid ? `${base}/embed/quote/${embedQuery(draft) ? `?${embedQuery(draft)}` : ""}` : null;
  const product = PRODUCTS[draft.product];

  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="my-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="card-surface space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={label}>Product</span>
            <select
              className={`${fieldCls} mt-2`}
              value={draft.product}
              onChange={(e) => setCfg((c) => ({ ...c, product: e.target.value as EmbedProduct }))}
            >
              <option value="depeg">{PRODUCTS.depeg.name}</option>
              <option value="exploit">{PRODUCTS.exploit.name}</option>
            </select>
          </label>
          <label className="block">
            <span className={label}>Currency</span>
            <select
              className={`${fieldCls} mt-2`}
              value={draft.currency}
              onChange={(e) => setCfg((c) => ({ ...c, currency: e.target.value as EmbedConfig["currency"] }))}
            >
              <option value="ADA">ADA (tADA)</option>
              <option value="USDC">USDC (tUSDCx)</option>
            </select>
          </label>
          <label className="block">
            <span className={label}>Cover amount</span>
            <input className={`${fieldCls} mt-2`} inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
          </label>
          <label className="block">
            <span className={label}>Term (days, {product.minDays}–{product.maxDays})</span>
            <input className={`${fieldCls} mt-2`} inputMode="numeric" value={daysText} onChange={(e) => setDaysText(e.target.value)} />
          </label>
          <label className="block">
            <span className={label}>Theme</span>
            <select
              className={`${fieldCls} mt-2`}
              value={draft.theme}
              onChange={(e) => setCfg((c) => ({ ...c, theme: e.target.value as EmbedConfig["theme"] }))}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          <label className="block">
            <span className={label}>Partner tag (optional)</span>
            <input className={`${fieldCls} mt-2`} placeholder="my-dex" value={refText} onChange={(e) => setRefText(e.target.value)} />
          </label>
        </div>

        {valid ? (
          <>
            <div>
              <div className="flex items-center justify-between">
                <span className={label}>Paste this where the widget should appear</span>
                <button type="button" onClick={() => copy("iframe", snippet)} className="text-[12.5px] text-text-muted hover:text-text">
                  {copied === "iframe" ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-bg-muted p-3 font-mono text-[11.5px] leading-relaxed text-text-muted">
                {snippet}
              </pre>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <span className={label}>Optional: auto-size the iframe</span>
                <button type="button" onClick={() => copy("script", embedResizeScript())} className="text-[12.5px] text-text-muted hover:text-text">
                  {copied === "script" ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-bg-muted p-3 font-mono text-[11.5px] leading-relaxed text-text-muted">
                {embedResizeScript()}
              </pre>
            </div>
          </>
        ) : (
          <ul className="list-disc rounded-lg border border-border bg-bg-muted p-3 pl-7 text-[12.5px] text-text-muted" role="alert">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className={label}>Live preview</div>
        {previewSrc ? (
          <iframe
            key={previewSrc}
            src={previewSrc}
            title={`PlutusShield ${product.name} quote preview`}
            className="mt-3 w-full rounded-2xl border-0"
            style={{ height: 480 }}
          />
        ) : (
          <div className="mt-3 rounded-2xl border border-dashed border-border p-6 text-[13px] text-text-muted">
            Fix the settings on the left to see the widget.
          </div>
        )}
      </div>
    </div>
  );
}
