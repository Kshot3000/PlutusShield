/**
 * Embeddable cover quote widget: the config a partner protocol puts in an
 * iframe URL, the snippet they paste, and the quote the widget shows.
 *
 *   /embed/quote/?p=exploit&c=USDC&a=250&d=90&t=light&ref=my-dex
 *
 * The widget never touches a wallet. Its only action is a link that opens the
 * same cover as a /plan deep link on PlutusShield in a new tab, where the
 * holder buys it from their own CIP-30 wallet. Decoding is lenient by design
 * (an embed should still render if a partner typos a param): every bad value
 * falls back to its default and is reported in `warnings`.
 */
import { PRODUCTS, type ProductId, type RiskTier } from "./products.ts";
import { quote, type PoolState, type QuoteResult } from "./quote.ts";
import { planShareQuery, type PlanCurrency } from "./coverPlan.ts";

/** Products a widget may sell: only the ones with a live Preview pool. */
export type EmbedProduct = Extract<ProductId, "depeg" | "exploit">;
export type EmbedTheme = "dark" | "light";

export interface EmbedConfig {
  product: EmbedProduct;
  currency: PlanCurrency;
  /** Cover amount in whole units of `currency`. */
  amount: number;
  days: number;
  theme: EmbedTheme;
  /** Partner tag shown as "via <ref>" and carried to the plan label. Lowercase a-z, 0-9, dash; up to 32. */
  ref: string | null;
}

export const EMBED_PRODUCTS: readonly EmbedProduct[] = ["depeg", "exploit"];
export const EMBED_DEFAULTS: EmbedConfig = {
  product: "depeg",
  currency: "ADA",
  amount: 100,
  days: 90,
  theme: "dark",
  ref: null,
};
/** Upper bound on the amount a URL can ask for; the pool caps still apply on top. */
export const EMBED_MAX_AMOUNT = 1_000_000;
export const EMBED_REF_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
/** postMessage `type` the widget sends its parent with its content height. */
export const EMBED_RESIZE_MESSAGE = "plutusshield:embed:resize";
export const EMBED_PATH = "embed/quote/";

export interface EmbedDecodeResult {
  config: EmbedConfig;
  /** One line per param that was ignored and why. Empty when every param was valid. */
  warnings: string[];
}

type ParamSource = URLSearchParams | string | Record<string, string | string[] | undefined | null>;

const asParams = (input: ParamSource): URLSearchParams => {
  if (input instanceof URLSearchParams) return input;
  if (typeof input === "string") return new URLSearchParams(input.startsWith("?") ? input.slice(1) : input);
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(input)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
    else p.set(k, v);
  }
  return p;
};

const isEmbedProduct = (p: string): p is EmbedProduct => (EMBED_PRODUCTS as readonly string[]).includes(p);

/** Reasons a config can't be encoded; empty when it is valid. */
export function validateEmbedConfig(cfg: EmbedConfig): string[] {
  const errs: string[] = [];
  if (!isEmbedProduct(cfg.product)) errs.push(`product must be depeg or exploit (SLA cover has no live pool)`);
  if (cfg.currency !== "ADA" && cfg.currency !== "USDC") errs.push("currency must be ADA or USDC");
  if (!Number.isFinite(cfg.amount) || !(cfg.amount > 0) || cfg.amount > EMBED_MAX_AMOUNT)
    errs.push(`amount must be greater than 0 and at most ${EMBED_MAX_AMOUNT}`);
  const prod = isEmbedProduct(cfg.product) ? PRODUCTS[cfg.product] : null;
  if (prod && (!Number.isInteger(cfg.days) || cfg.days < prod.minDays || cfg.days > prod.maxDays))
    errs.push(`days must be an integer ${prod.minDays}–${prod.maxDays} for ${prod.name}`);
  if (cfg.theme !== "dark" && cfg.theme !== "light") errs.push("theme must be dark or light");
  if (cfg.ref !== null && !EMBED_REF_RE.test(cfg.ref)) errs.push("ref must be 1–32 of a-z, 0-9 and dashes");
  return errs;
}

/** Config → widget query params. Defaults are omitted so snippets stay short. Throws on an invalid config. */
export function encodeEmbedConfig(cfg: EmbedConfig): URLSearchParams {
  const errs = validateEmbedConfig(cfg);
  if (errs.length) throw new Error(`embed config: ${errs.join("; ")}`);
  const p = new URLSearchParams();
  if (cfg.product !== EMBED_DEFAULTS.product) p.set("p", cfg.product);
  if (cfg.currency !== EMBED_DEFAULTS.currency) p.set("c", cfg.currency);
  if (cfg.amount !== EMBED_DEFAULTS.amount) p.set("a", String(cfg.amount));
  if (cfg.days !== EMBED_DEFAULTS.days) p.set("d", String(cfg.days));
  if (cfg.theme !== EMBED_DEFAULTS.theme) p.set("t", cfg.theme);
  if (cfg.ref) p.set("ref", cfg.ref);
  return p;
}

/**
 * Widget query params → config. Never fails: each bad value falls back to its
 * default (or, for a term outside the product's range, is clamped into it).
 */
export function decodeEmbedConfig(input: ParamSource): EmbedDecodeResult {
  const p = asParams(input);
  const warnings: string[] = [];
  const cfg: EmbedConfig = { ...EMBED_DEFAULTS };

  const pr = p.get("p");
  if (pr !== null && pr !== "") {
    if (isEmbedProduct(pr)) cfg.product = pr;
    else warnings.push(pr === "sla" ? "SLA cover is not for sale yet (no uptime oracle); showing depeg cover" : `unknown product "${pr}"; showing depeg cover`);
  }
  const c = p.get("c");
  if (c !== null && c !== "") {
    const up = c.toUpperCase();
    if (up === "ADA" || up === "USDC") cfg.currency = up;
    else warnings.push(`currency "${c}" is not ADA or USDC; using ADA`);
  }
  const a = p.get("a");
  if (a !== null && a !== "") {
    const n = Number(a);
    if (Number.isFinite(n) && n > 0 && n <= EMBED_MAX_AMOUNT) cfg.amount = n;
    else warnings.push(`amount "${a}" is not between 0 and ${EMBED_MAX_AMOUNT}; using ${EMBED_DEFAULTS.amount}`);
  }
  const prod = PRODUCTS[cfg.product];
  const d = p.get("d");
  if (d !== null && d !== "") {
    const n = Number(d);
    if (!Number.isInteger(n)) warnings.push(`term "${d}" is not a whole number of days; using ${EMBED_DEFAULTS.days}`);
    else if (n < prod.minDays || n > prod.maxDays) {
      cfg.days = Math.min(Math.max(n, prod.minDays), prod.maxDays);
      warnings.push(`term ${n} days is outside ${prod.minDays}–${prod.maxDays} for ${prod.name}; using ${cfg.days}`);
    } else cfg.days = n;
  }
  const t = p.get("t");
  if (t !== null && t !== "") {
    if (t === "dark" || t === "light") cfg.theme = t;
    else warnings.push(`theme "${t}" is not dark or light; using dark`);
  }
  const ref = p.get("ref");
  if (ref !== null && ref !== "") {
    const r = ref.toLowerCase();
    if (EMBED_REF_RE.test(r)) cfg.ref = r;
    else warnings.push("ref must be 1–32 of a-z, 0-9 and dashes; ignored");
  }
  return { config: cfg, warnings };
}

export const embedQuery = (cfg: EmbedConfig): string => encodeEmbedConfig(cfg).toString();

/** Absolute widget URL under a site root such as https://kshot3000.github.io/PlutusShield. */
export function embedUrl(cfg: EmbedConfig, siteRoot: string): string {
  const q = embedQuery(cfg);
  return `${siteRoot.replace(/\/+$/, "")}/${EMBED_PATH}${q ? `?${q}` : ""}`;
}

const escAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface EmbedSnippetOptions {
  siteRoot: string;
  width?: number;
  height?: number;
}

/** The iframe a partner pastes. Lazy, no referrer path leak, no sandbox escape needed (the CTA opens a new tab). */
export function embedSnippet(cfg: EmbedConfig, opts: EmbedSnippetOptions): string {
  const w = opts.width ?? 360;
  const h = opts.height ?? 440;
  const src = escAttr(embedUrl(cfg, opts.siteRoot));
  const title = escAttr(`PlutusShield ${PRODUCTS[cfg.product].name} quote`);
  return (
    `<iframe src="${src}" title="${title}" width="${w}" height="${h}" ` +
    `style="border:0;border-radius:16px;max-width:100%" loading="lazy" ` +
    `referrerpolicy="strict-origin-when-cross-origin" ` +
    `sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>`
  );
}

/** Parent-page listener that sizes the iframe to the widget's own height. */
export function embedResizeScript(): string {
  return (
    `<script>addEventListener("message",function(e){` +
    `if(!e.data||e.data.type!=="${EMBED_RESIZE_MESSAGE}")return;` +
    `document.querySelectorAll('iframe[src*="/${EMBED_PATH}"]').forEach(function(f){` +
    `if(f.contentWindow===e.source)f.style.height=Math.ceil(e.data.height)+"px"})});</script>`
  );
}

export interface EmbedQuote {
  quote: QuoteResult;
  /** Query for `/plan/?…` that rebuilds this exact cover on PlutusShield. */
  planQuery: string;
}

/** Price the widget's cover with the same quote() as /cover and /plan. */
export function embedQuote(cfg: EmbedConfig, pool: PoolState | null, riskTier: RiskTier = "B"): EmbedQuote {
  const label = cfg.ref ? `${PRODUCTS[cfg.product].name} via ${cfg.ref}` : PRODUCTS[cfg.product].name;
  const planQuery = planShareQuery({
    currency: cfg.currency,
    days: cfg.days,
    exposures: [{ label, product: cfg.product, amount: cfg.amount, protectPct: 100 }],
  });
  const q: QuoteResult = pool
    ? quote({ product: cfg.product, coverAmount: cfg.amount, days: cfg.days, riskTier, pool })
    : { ok: false, reason: `No live ${cfg.currency} tranche for ${PRODUCTS[cfg.product].name}` };
  return { quote: q, planQuery };
}
