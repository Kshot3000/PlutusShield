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
 * 3. Every open-data feed (out/api/v1/*.json) parses, carries the v1
 *    envelope for its own dataset, and shares one build time with the rest.
 * 4. The Atom activity feed (out/feed.xml) is a well-formed Atom document:
 *    feed id/title/updated/self link, and every entry has id, title, updated,
 *    summary and an alternate link, with no unescaped ampersands.
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

const API = path.join(OUT, 'api', 'v1');
const DATASETS = ['index', 'products', 'claims', 'book', 'oracle', 'plan'];
const builtAt = new Set();
for (const d of DATASETS) {
  const f = path.join(API, `${d}.json`);
  if (!fs.existsSync(f)) { problems.push(`api/v1/${d}.json: missing`); continue; }
  let j;
  try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { problems.push(`api/v1/${d}.json: not JSON (${e.message})`); continue; }
  if (j.schema !== 'plutusshield.open-data/v1') problems.push(`api/v1/${d}.json: schema ${j.schema}`);
  if (j.dataset !== d) problems.push(`api/v1/${d}.json: dataset ${j.dataset}`);
  if (j.testnetOnly !== true || j.audited !== false) problems.push(`api/v1/${d}.json: missing testnet / not-audited flags`);
  if (j.data == null) problems.push(`api/v1/${d}.json: no data`);
  builtAt.add(j.generatedAt);
}
if (builtAt.size > 1) problems.push(`api/v1: feeds disagree on generatedAt (${[...builtAt].join(', ')})`);

const FEED = path.join(OUT, 'feed.xml');
let feedEntries = 0;
if (!fs.existsSync(FEED)) problems.push('feed.xml: missing');
else {
  const xml = fs.readFileSync(FEED, 'utf8');
  if (!xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')) problems.push('feed.xml: missing XML declaration');
  if (!xml.includes('<feed xmlns="http://www.w3.org/2005/Atom">') || !xml.trimEnd().endsWith('</feed>')) problems.push('feed.xml: not an Atom feed');
  for (const tag of ['id', 'title', 'updated']) if (!new RegExp(`^  <${tag}>[^<]+</${tag}>$`, 'm').test(xml)) problems.push(`feed.xml: no feed <${tag}>`);
  if (!xml.includes('rel="self"')) problems.push('feed.xml: no self link');
  const blocks = xml.split('<entry>').slice(1);
  feedEntries = blocks.length;
  if (!feedEntries) problems.push('feed.xml: no entries');
  const ids = new Set();
  blocks.forEach((b, i) => {
    for (const tag of ['id', 'title', 'updated', 'summary']) if (!b.includes(`<${tag}`)) problems.push(`feed.xml: entry ${i} has no <${tag}>`);
    if (!b.includes('rel="alternate"')) problems.push(`feed.xml: entry ${i} has no alternate link`);
    const id = b.match(/<id>([^<]+)<\/id>/)?.[1];
    if (id && ids.has(id)) problems.push(`feed.xml: duplicate entry id ${id}`);
    ids.add(id);
    for (const [, href] of b.matchAll(/href="([^"]+)"/g)) {
      const m = href.match(/^https:\/\/preprod\.midnightexplorer\.com\/transactions\/0x([0-9a-f]{64})/i);
      if (m && !txHashes.has(m[1].toLowerCase())) problems.push(`feed.xml: Midnight explorer link to a non-transaction value ${m[1].slice(0, 12)}…`);
    }
  });
  if (/&(?!(amp|lt|gt|quot|apos);)/.test(xml)) problems.push('feed.xml: unescaped ampersand');
}

const uniq = [...new Set(problems)];
if (uniq.length) {
  console.error(`check-links: ${uniq.length} problem(s) in ${pages.length} pages`);
  for (const p of uniq) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check-links: ${pages.length} pages ok, ${txHashes.size} known Midnight tx hashes, ${DATASETS.length} open-data feeds ok, Atom feed ${feedEntries} entries ok`);
