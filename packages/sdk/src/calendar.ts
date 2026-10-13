/**
 * Policy deadline calendar: turns a policy's cover start, expiry and claim
 * grace into an RFC 5545 iCalendar file (one VEVENT per deadline, each with
 * reminders) and Google Calendar template links, so a holder never misses the
 * last moment to file a claim.
 *
 * Pure and deterministic: the caller passes every time (including `stamp`, the
 * DTSTAMP), so the same policy always produces byte-identical output. No
 * wallet, no network. Times are written in UTC ("Z"), which every calendar
 * app converts to the reader's zone.
 */

export type CalendarProduct = "depeg" | "exploit";

export interface PolicyCalendarInput {
  /** 64-hex policy id (0x prefix and case ignored). */
  policyId: string;
  product: CalendarProduct;
  /** ms since epoch: cover becomes active (end of the waiting period). Null when unknown. */
  start: number | null;
  /** ms since epoch: cover ends. */
  expiry: number;
  /** ms after expiry that a claim may still be filed. */
  claimGraceMs: number;
  /** Absolute URL of the policy tracker page for this policy. */
  trackerUrl: string;
  /** Absolute URL where the holder files a claim. */
  claimUrl: string;
  /** Coverage label, e.g. "250 tUSDCx". Optional. */
  coverage?: string | null;
  /** ms since epoch written as DTSTAMP. Defaults to `expiry` so output stays deterministic. */
  stamp?: number;
}

export type CalendarEventKind = "active" | "expires" | "claim-deadline";

export interface CalendarEvent {
  kind: CalendarEventKind;
  uid: string;
  summary: string;
  description: string;
  /** ms since epoch. Events are 15-minute markers starting here. */
  at: number;
  url: string;
  /** Minutes before `at` to remind. */
  alarms: number[];
}

const PRODUCT_LABEL: Record<CalendarProduct, string> = {
  depeg: "USDM depeg cover",
  exploit: "Smart-contract exploit cover",
};

const EVENT_MS = 15 * 60_000;
const DAY_MIN = 24 * 60;

const normId = (id: string) => {
  const h = id.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error("policyId must be 64 hex characters");
  return h;
};

const checkTime = (name: string, ms: number) => {
  if (!Number.isFinite(ms) || ms <= 0) throw new Error(`${name} must be a positive ms timestamp`);
};

/** The deadlines worth a calendar entry, in time order. */
export function policyCalendarEvents(input: PolicyCalendarInput): CalendarEvent[] {
  const id = normId(input.policyId);
  checkTime("expiry", input.expiry);
  if (!Number.isFinite(input.claimGraceMs) || input.claimGraceMs < 0) throw new Error("claimGraceMs must be >= 0");
  if (input.start !== null) {
    checkTime("start", input.start);
    if (input.start >= input.expiry) throw new Error("start must be before expiry");
  }
  const short = `${id.slice(0, 8)}…${id.slice(-4)}`;
  const label = PRODUCT_LABEL[input.product];
  const cov = input.coverage ? ` (${input.coverage})` : "";
  const deadline = input.expiry + input.claimGraceMs;
  const footer = `Policy ${id}\nTrack it: ${input.trackerUrl}\nPlutusShield runs on Cardano Preview and Midnight Preprod testnets. Not audited.`;
  const out: CalendarEvent[] = [];
  if (input.start !== null)
    out.push({
      kind: "active",
      uid: `${id}-active@plutusshield`,
      summary: `PlutusShield: ${label} active ${short}`,
      description: `Your ${label}${cov} leaves its waiting period and is active from now.\n\n${footer}`,
      at: input.start,
      url: input.trackerUrl,
      alarms: [],
    });
  out.push({
    kind: "expires",
    uid: `${id}-expires@plutusshield`,
    summary: `PlutusShield: ${label} expires ${short}`,
    description: `Your ${label}${cov} ends now. Renew it before this if you still need protection.\n\n${footer}`,
    at: input.expiry,
    url: input.trackerUrl,
    alarms: [DAY_MIN],
  });
  if (input.claimGraceMs > 0)
    out.push({
      kind: "claim-deadline",
      uid: `${id}-claim-deadline@plutusshield`,
      summary: `PlutusShield: last moment to claim ${short}`,
      description: `The claim window for your ${label}${cov} closes now. After this, the pool releases the reserved capital and no claim can pay.\nFile a claim: ${input.claimUrl}\n\n${footer}`,
      at: deadline,
      url: input.claimUrl,
      alarms: [3 * DAY_MIN, DAY_MIN],
    });
  return out;
}

/** UTC basic format: 20261013T214100Z */
export const icsTime = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** RFC 5545 §3.3.11 TEXT escaping. */
export const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** RFC 5545 §3.1 folding: lines over 75 octets continue on the next line after CRLF + space, never splitting a UTF-8 character. */
export function icsFold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let curLen = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines carry the leading space
    if (curLen + n > limit) {
      parts.push(cur);
      cur = "";
      curLen = 0;
    }
    cur += ch;
    curLen += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

/** A complete .ics file (CRLF line endings) for one policy's deadlines. */
export function policyCalendarIcs(input: PolicyCalendarInput): string {
  const events = policyCalendarEvents(input);
  const stamp = icsTime(input.stamp ?? input.expiry);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PlutusShield//Policy deadlines//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsEscape("PlutusShield policy " + normId(input.policyId).slice(0, 8))}`];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsTime(e.at)}`,
      `DTEND:${icsTime(e.at + EVENT_MS)}`,
      `SUMMARY:${icsEscape(e.summary)}`,
      `DESCRIPTION:${icsEscape(e.description)}`,
      `URL:${e.url}`,
      "TRANSP:TRANSPARENT",
    );
    for (const m of e.alarms)
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(e.summary)}`, `TRIGGER:-PT${m}M`, "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(icsFold).join("\r\n") + "\r\n";
}

/** Suggested download name: plutusshield-policy-<first 8 hex>.ics */
export const policyCalendarFilename = (policyId: string) => `plutusshield-policy-${normId(policyId).slice(0, 8)}.ics`;

/** Google Calendar "add event" template link for one event. */
export function googleCalendarUrl(e: CalendarEvent): string {
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: e.summary,
    dates: `${icsTime(e.at)}/${icsTime(e.at + EVENT_MS)}`,
    details: e.description,
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
