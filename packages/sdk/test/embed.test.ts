import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMBED_DEFAULTS,
  EMBED_RESIZE_MESSAGE,
  decodeEmbedConfig,
  decodePlanShare,
  embedQuery,
  embedQuote,
  embedResizeScript,
  embedSnippet,
  embedUrl,
  encodeEmbedConfig,
  quote,
  validateEmbedConfig,
  type EmbedConfig,
} from "../src/index.ts";

const pool = { capital: 10_000, activeCover: 1_000 };
const cfg: EmbedConfig = { product: "exploit", currency: "USDC", amount: 250, days: 60, theme: "light", ref: "my-dex" };

test("defaults encode to an empty query and decode back with no warnings", () => {
  assert.equal(embedQuery(EMBED_DEFAULTS), "");
  const r = decodeEmbedConfig("");
  assert.deepEqual(r.config, EMBED_DEFAULTS);
  assert.deepEqual(r.warnings, []);
});

test("a full config round-trips through the query string", () => {
  const q = embedQuery(cfg);
  assert.equal(q, "p=exploit&c=USDC&a=250&d=60&t=light&ref=my-dex");
  const r = decodeEmbedConfig(`?${q}`);
  assert.deepEqual(r.config, cfg);
  assert.deepEqual(r.warnings, []);
});

test("decoding is lenient: bad params fall back to defaults with a warning each", () => {
  const r = decodeEmbedConfig({ p: "rugpull", c: "BTC", a: "-5", t: "neon", ref: "Bad Ref!" });
  assert.deepEqual(r.config, EMBED_DEFAULTS);
  assert.equal(r.warnings.length, 5);
});

test("SLA cover is never sold from a widget", () => {
  const r = decodeEmbedConfig("p=sla");
  assert.equal(r.config.product, "depeg");
  assert.match(r.warnings[0], /SLA cover is not for sale/);
  assert.ok(validateEmbedConfig({ ...EMBED_DEFAULTS, product: "sla" as never }).length > 0);
});

test("a term outside the product range is clamped, not dropped", () => {
  const r = decodeEmbedConfig("p=exploit&d=7");
  assert.equal(r.config.days, 30);
  assert.equal(r.warnings.length, 1);
  assert.equal(decodeEmbedConfig("d=999").config.days, 365);
  assert.equal(decodeEmbedConfig("d=12.5").config.days, EMBED_DEFAULTS.days);
});

test("encode refuses an invalid config instead of emitting a broken snippet", () => {
  assert.throws(() => encodeEmbedConfig({ ...cfg, amount: 0 }), /amount/);
  assert.throws(() => encodeEmbedConfig({ ...cfg, days: 10 }), /days/);
  assert.throws(() => encodeEmbedConfig({ ...cfg, ref: "-x" }), /ref/);
});

test("snippet points at the widget under the site root and escapes attributes", () => {
  const url = embedUrl(cfg, "https://kshot3000.github.io/PlutusShield/");
  assert.equal(url, "https://kshot3000.github.io/PlutusShield/embed/quote/?p=exploit&c=USDC&a=250&d=60&t=light&ref=my-dex");
  const html = embedSnippet(cfg, { siteRoot: "https://kshot3000.github.io/PlutusShield" });
  assert.match(html, /^<iframe src="https:\/\/kshot3000\.github\.io\/PlutusShield\/embed\/quote\/\?p=exploit&amp;c=USDC/);
  assert.match(html, /title="PlutusShield Smart-contract exploit cover quote"/);
  assert.match(html, /loading="lazy"/);
  assert.ok(!html.includes("&c="), "raw ampersands must be escaped in the src attribute");
  assert.ok(embedResizeScript().includes(EMBED_RESIZE_MESSAGE));
});

test("widget quote matches quote() and its plan link rebuilds the same cover", () => {
  const eq = embedQuote(cfg, pool, "B");
  const q = quote({ product: "exploit", coverAmount: 250, days: 60, riskTier: "B", pool });
  assert.deepEqual(eq.quote, q);
  const plan = decodePlanShare(eq.planQuery);
  assert.ok(plan.ok);
  assert.equal(plan.state.currency, "USDC");
  assert.equal(plan.state.days, 60);
  assert.deepEqual(plan.state.exposures, [
    { label: "Smart-contract exploit cover via my-dex", product: "exploit", amount: 250, protectPct: 100 },
  ]);
});

test("widget quote fails closed without a tranche and over the single-policy cap", () => {
  const none = embedQuote(cfg, null);
  assert.equal(none.quote.ok, false);
  const big = embedQuote({ ...cfg, amount: 5_000 }, pool);
  assert.equal(big.quote.ok, false);
  if (!big.quote.ok) assert.match(big.quote.reason, /single-policy cap/);
});
