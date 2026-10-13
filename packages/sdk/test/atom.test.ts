import { test } from "node:test";
import assert from "node:assert/strict";
import { activityTagId, atomEntries, buildAtomFeed, checkAtomFeed, escapeXml, type AtomEntry } from "../src/index.ts";

const ROOT = "https://kshot3000.github.io/PlutusShield";
const entry = (over: Partial<AtomEntry> = {}): AtomEntry => ({
  id: activityTagId("oracle", "e2173d92"),
  title: "Oracle: USDM 24h TWAP 99.96% on Preview",
  updated: "2026-10-13T18:55:47.682Z",
  link: `${ROOT}/oracle/`,
  related: [{ href: "https://preview.cardanoscan.io/transaction/e2173d92", title: "Publish tx" }],
  summary: "Published to feed-a, feed-b and feed-c.",
  kind: "oracle",
  ...over,
});
const feed = (entries: AtomEntry[]) => ({
  id: `${ROOT}/feed.xml`,
  title: "PlutusShield activity",
  subtitle: "Claims & oracle <testnet>",
  link: `${ROOT}/`,
  self: `${ROOT}/feed.xml`,
  author: { name: "Kshot", uri: "https://x.com/kshot9000" },
  entries,
});

test("escapeXml escapes the five XML specials and drops control characters", () => {
  assert.equal(escapeXml(`a & b < c > d "e" 'f'\u0001`), "a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;");
});

test("activityTagId is a stable lower-case tag: URI per kind and key", () => {
  assert.equal(activityTagId("claim", "ABC123"), "tag:kshot3000.github.io,2026:plutusshield/claim/abc123");
  assert.equal(activityTagId("claim", "abc123"), activityTagId("claim", "ABC123"));
});

test("entries come out newest first, capped at the limit", () => {
  const older = entry({ id: activityTagId("oracle", "ff254d2b"), updated: "2026-10-13T17:29:55.939Z" });
  const claim = entry({ id: activityTagId("claim", "496dced8"), updated: "2026-10-12T20:55:00.000Z", kind: "claim" });
  const out = atomEntries([claim, older, entry()]);
  assert.deepEqual(out.map((e) => e.updated), ["2026-10-13T18:55:47.682Z", "2026-10-13T17:29:55.939Z", "2026-10-12T20:55:00.000Z"]);
  assert.equal(atomEntries([claim, older, entry()], 2).length, 2);
});

test("refuses duplicate ids, relative links, non-UTC times and empty titles", () => {
  assert.throws(() => atomEntries([entry(), entry()]), /duplicate/);
  assert.throws(() => atomEntries([entry({ link: "/oracle/" })]), /absolute/);
  assert.throws(() => atomEntries([entry({ updated: "2026-10-13 18:55" })]), /ISO 8601/);
  assert.throws(() => atomEntries([entry({ updated: "2026-10-13T13:55:47-05:00" })]), /ISO 8601/);
  assert.throws(() => atomEntries([entry({ title: " " })]), /empty title/);
  assert.throws(() => atomEntries([entry({ id: "oracle-1" })]), /tag: URI/);
});

test("buildAtomFeed writes a valid feed with self link, escaped text and the newest entry as updated", () => {
  const xml = buildAtomFeed(feed([entry(), entry({ id: activityTagId("claim", "x"), kind: "claim", updated: "2026-10-01T00:00:00.000Z", title: "Claim paid & settled" })]));
  assert.deepEqual(checkAtomFeed(xml), { ok: true, entries: 2 });
  assert.match(xml, /^  <updated>2026-10-13T18:55:47\.682Z<\/updated>$/m);
  assert.match(xml, /<subtitle>Claims &amp; oracle &lt;testnet&gt;<\/subtitle>/);
  assert.match(xml, /<title>Claim paid &amp; settled<\/title>/);
  assert.match(xml, /<link href="https:\/\/kshot3000\.github\.io\/PlutusShield\/feed\.xml" rel="self"\/>/);
  assert.match(xml, /<link rel="related" href="https:\/\/preview\.cardanoscan\.io\/transaction\/e2173d92" title="Publish tx"\/>|<link href="https:\/\/preview\.cardanoscan\.io\/transaction\/e2173d92" rel="related" title="Publish tx"\/>/);
  assert.match(xml, /<category term="oracle"\/>/);
  assert.ok(xml.indexOf("e2173d92</id>") < xml.indexOf("claim/x</id>"));
});

test("an empty feed needs an explicit updated time", () => {
  assert.throws(() => buildAtomFeed(feed([])), /no entries/);
  assert.deepEqual(checkAtomFeed(buildAtomFeed({ ...feed([]), updated: "2026-10-13T19:00:00.000Z" })), { ok: true, entries: 0 });
});

test("checkAtomFeed refuses a document that is not an Atom feed or has a broken entry", () => {
  assert.equal(checkAtomFeed("<rss></rss>").ok, false);
  const xml = buildAtomFeed(feed([entry()]));
  assert.equal(checkAtomFeed(xml.replace(/<summary[^\n]+\n/, "")).ok, false);
  assert.equal(checkAtomFeed(xml.replace("</feed>", "& </feed>")).ok, false);
});
