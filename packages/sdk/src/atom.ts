/**
 * Atom 1.0 (RFC 4287) activity feed for PlutusShield: claim decisions, refused
 * settlements and oracle publishes as entries a feed reader, a Discord/Telegram
 * bot or a partner dashboard can subscribe to. Pure string building, no XML
 * dependency, so the same builder runs in the site build and in tests.
 *
 * The builder refuses a feed it would have to guess about: a missing title or
 * link, a time that is not ISO 8601 UTC, or two entries with the same id.
 */

export const ATOM_NS = "http://www.w3.org/2005/Atom";
export const ATOM_PATH = "feed.xml";

export type ActivityKind = "claim" | "refused-settle" | "oracle";

export interface AtomLink {
  href: string;
  rel?: "alternate" | "related" | "self" | "via";
  title?: string;
}

export interface AtomEntry {
  /** Stable, unique id (a tag: URI or an absolute URL). */
  id: string;
  title: string;
  /** ISO 8601 UTC, e.g. 2026-10-13T18:55:47.682Z. */
  updated: string;
  /** The page a reader should open (rel=alternate). */
  link: string;
  /** Extra links, e.g. the on-chain transaction (rel=related). */
  related?: AtomLink[];
  summary: string;
  kind: ActivityKind;
  /** Extra categories besides the kind (chain names, product ids). */
  categories?: string[];
}

export interface AtomFeedInput {
  id: string;
  title: string;
  subtitle: string;
  /** Site page the feed describes (rel=alternate). */
  link: string;
  /** Absolute URL of the feed itself (rel=self). */
  self: string;
  author: { name: string; uri?: string };
  rights?: string;
  /** Feed-level updated time; defaults to the newest entry. */
  updated?: string;
  entries: AtomEntry[];
  /** Keep only the newest N entries (default 100). */
  limit?: number;
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const ABS = /^(https?:\/\/|tag:)/;

/** Escape text for XML element content and double-quoted attributes. */
export const escapeXml = (s: string): string =>
  s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const need = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(`atom: ${msg}`);
};

const checkTime = (t: string, where: string) => need(ISO_UTC.test(t) && !Number.isNaN(Date.parse(t)), `${where}: updated "${t}" is not ISO 8601 UTC`);

/** tag: URI for an entry, stable across rebuilds (RFC 4151). */
export const activityTagId = (kind: ActivityKind, key: string, date = "2026") =>
  `tag:kshot3000.github.io,${date}:plutusshield/${kind}/${key.toLowerCase()}`;

const linkXml = (l: AtomLink) =>
  `<link href="${escapeXml(l.href)}"${l.rel ? ` rel="${l.rel}"` : ""}${l.title ? ` title="${escapeXml(l.title)}"` : ""}/>`;

/** Sort newest first, check every entry, and keep the newest `limit`. */
export function atomEntries(entries: AtomEntry[], limit = 100): AtomEntry[] {
  const seen = new Set<string>();
  for (const e of entries) {
    need(e.id && ABS.test(e.id), `entry id "${e.id}" must be a tag: URI or absolute URL`);
    need(!seen.has(e.id), `duplicate entry id ${e.id}`);
    seen.add(e.id);
    need(e.title?.trim(), `${e.id}: empty title`);
    need(e.link && /^https?:\/\//.test(e.link), `${e.id}: link must be absolute`);
    checkTime(e.updated, e.id);
    for (const r of e.related ?? []) need(/^https?:\/\//.test(r.href), `${e.id}: related link must be absolute`);
  }
  return [...entries].sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated) || a.id.localeCompare(b.id)).slice(0, Math.max(0, limit));
}

/** Build the Atom XML document. */
export function buildAtomFeed(feed: AtomFeedInput): string {
  need(feed.title?.trim(), "feed title is empty");
  need(ABS.test(feed.id), "feed id must be a tag: URI or absolute URL");
  need(/^https?:\/\//.test(feed.link) && /^https?:\/\//.test(feed.self), "feed link and self must be absolute");
  const entries = atomEntries(feed.entries, feed.limit ?? 100);
  const updated = feed.updated ?? entries[0]?.updated;
  need(updated, "feed has no entries and no updated time");
  checkTime(updated!, "feed");

  const out = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<feed xmlns="${ATOM_NS}">`,
    `  <id>${escapeXml(feed.id)}</id>`,
    `  <title>${escapeXml(feed.title)}</title>`,
    `  <subtitle>${escapeXml(feed.subtitle)}</subtitle>`,
    `  <updated>${updated}</updated>`,
    `  ${linkXml({ href: feed.link, rel: "alternate" })}`,
    `  ${linkXml({ href: feed.self, rel: "self" })}`,
    `  <author><name>${escapeXml(feed.author.name)}</name>${feed.author.uri ? `<uri>${escapeXml(feed.author.uri)}</uri>` : ""}</author>`,
    ...(feed.rights ? [`  <rights>${escapeXml(feed.rights)}</rights>`] : []),
    `  <generator uri="https://github.com/Kshot3000/PlutusShield">PlutusShield site build</generator>`,
  ];
  for (const e of entries) {
    out.push(
      `  <entry>`,
      `    <id>${escapeXml(e.id)}</id>`,
      `    <title>${escapeXml(e.title)}</title>`,
      `    <updated>${e.updated}</updated>`,
      `    ${linkXml({ href: e.link, rel: "alternate" })}`,
      ...(e.related ?? []).map((r) => `    ${linkXml({ rel: "related", ...r })}`),
      `    <category term="${e.kind}"/>`,
      ...(e.categories ?? []).map((c) => `    <category term="${escapeXml(c)}"/>`),
      `    <summary type="text">${escapeXml(e.summary)}</summary>`,
      `  </entry>`,
    );
  }
  out.push(`</feed>`);
  return out.join("\n") + "\n";
}

/** Light structural check for a built feed (used by the post-build guard and tests). */
export function checkAtomFeed(xml: string): { ok: true; entries: number } | { ok: false; reason: string } {
  if (!xml.startsWith(`<?xml version="1.0" encoding="utf-8"?>`)) return { ok: false, reason: "missing XML declaration" };
  if (!xml.includes(`<feed xmlns="${ATOM_NS}">`) || !xml.trimEnd().endsWith("</feed>")) return { ok: false, reason: "not an Atom feed element" };
  for (const tag of ["id", "title", "updated"]) if (!new RegExp(`^  <${tag}>[^<]+</${tag}>$`, "m").test(xml)) return { ok: false, reason: `feed has no <${tag}>` };
  if (!/rel="self"/.test(xml)) return { ok: false, reason: "feed has no self link" };
  const blocks = xml.split("<entry>").slice(1);
  for (const [i, b] of blocks.entries()) {
    for (const tag of ["id", "title", "updated", "summary"]) if (!b.includes(`<${tag}`)) return { ok: false, reason: `entry ${i} has no <${tag}>` };
    if (!b.includes(`rel="alternate"`)) return { ok: false, reason: `entry ${i} has no alternate link` };
  }
  if (blocks.length !== (xml.match(/<\/entry>/g) ?? []).length) return { ok: false, reason: "unbalanced <entry> elements" };
  if (/&(?!(amp|lt|gt|quot|apos);)/.test(xml)) return { ok: false, reason: "unescaped ampersand" };
  return { ok: true, entries: blocks.length };
}
