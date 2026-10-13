#!/usr/bin/env node
/**
 * Post-build link guard for the static export (apps/web/out).
 *
 * 1. Every internal href resolves to a file in out/ (base path stripped).
 * 2. Every Midnight explorer tx link points at a value recorded as a
 *    transaction hash (a key ending in "tx"/"txHash"/"Tx") in the Midnight data
 *    the site is built from. Member keys and evidence commitments are 64-hex
 *    too, but the explorer 404s on them, so they must render as copy-only.
 *
 *   node scripts/check-links.mjs [outDir]
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? 'out');
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '/PlutusShield';
const DATA = [path.resolve('src/data'), path.resolve('../../contracts/midnight/deployments')];

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? walk(p) : [p];
});

const txHashes = new Set();
const collect = (v, key = '') => {
  if (Array.isArray(v)) return v.forEach((x) => collect(x, key));
  if (v && typeof v === 'object') return Object.entries(v).forEach(([k, x]) => collect(x, k));
  if (typeof v === 'string' && /(^tx|tx$|txhash$|txid$)/i.test(key)) {
    const h = v.replace(/^0x/i, '').toLowerCase();
    if (/^[0-9a-f]{64}$/.test(h)) txHashes.add(h);
  }
};
for (const d of DATA) {
  if (!fs.existsSync(d)) continue;
  for (const f of walk(d).filter((f) => f.endsWith('.json'))) {
    try { collect(JSON.parse(fs.readFileSync(f, 'utf8'))); } catch { /* not JSON data */ }
  }
}

const exists = (u) => {
  const t = path.join(OUT, decodeURIComponent(u));
  return [t, path.join(t, 'index.html'), `${t.replace(/\/$/, '')}.html`].some((x) => fs.existsSync(x) && fs.statSync(x).isFile());
};

const problems = [];
const pages = walk(OUT).filter((f) => f.endsWith('.html'));
for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  const rel = path.relative(OUT, page);
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    const m = href.match(/^https:\/\/preprod\.midnightexplorer\.com\/transactions\/0x([0-9a-f]{64})/i);
    if (m && !txHashes.has(m[1].toLowerCase())) problems.push(`${rel}: Midnight explorer link to a non-transaction value ${m[1].slice(0, 12)}…`);
    if (/^(https?:|mailto:|#|data:)/.test(href)) continue;
    let u = href.split('#')[0].split('?')[0];
    if (!u.startsWith('/')) continue;
    if (BASE && u.startsWith(BASE)) u = u.slice(BASE.length) || '/';
    if (!exists(u)) problems.push(`${rel}: broken internal link ${href}`);
  }
}

const uniq = [...new Set(problems)];
if (uniq.length) {
  console.error(`check-links: ${uniq.length} problem(s) in ${pages.length} pages`);
  for (const p of uniq) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check-links: ${pages.length} pages ok, ${txHashes.size} known Midnight tx hashes`);
