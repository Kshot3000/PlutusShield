import { test } from "node:test";
import assert from "node:assert/strict";
import {
  googleCalendarUrl,
  icsEscape,
  icsFold,
  icsTime,
  policyCalendarEvents,
  policyCalendarFilename,
  policyCalendarIcs,
  type PolicyCalendarInput,
} from "../src/index.ts";

const ID = "ab".repeat(32);
const DAY = 86_400_000;
const base: PolicyCalendarInput = {
  policyId: `0x${ID.toUpperCase()}`,
  product: "exploit",
  start: Date.UTC(2026, 9, 13, 21, 0, 0),
  expiry: Date.UTC(2026, 10, 12, 21, 0, 0),
  claimGraceMs: 7 * DAY,
  trackerUrl: `https://kshot3000.github.io/PlutusShield/policy/?id=${ID}`,
  claimUrl: `https://kshot3000.github.io/PlutusShield/claim/evidence/?policy=${ID}`,
  coverage: "250 tUSDCx",
};

test("events cover start, expiry and the claim deadline in time order", () => {
  const ev = policyCalendarEvents(base);
  assert.deepEqual(ev.map((e) => e.kind), ["active", "expires", "claim-deadline"]);
  assert.equal(ev[2].at, base.expiry + 7 * DAY);
  assert.ok(ev.every((e, i) => i === 0 || e.at > ev[i - 1].at));
  assert.equal(ev[0].uid, `${ID}-active@plutusshield`);
  assert.equal(ev[2].url, base.claimUrl);
  assert.deepEqual(ev[2].alarms, [3 * 1440, 1440]);
});

test("unknown start drops the active event; zero grace drops the deadline", () => {
  const ev = policyCalendarEvents({ ...base, start: null, claimGraceMs: 0 });
  assert.deepEqual(ev.map((e) => e.kind), ["expires"]);
});

test("bad inputs throw", () => {
  assert.throws(() => policyCalendarEvents({ ...base, policyId: "abc" }), /64 hex/);
  assert.throws(() => policyCalendarEvents({ ...base, start: base.expiry }), /before expiry/);
  assert.throws(() => policyCalendarEvents({ ...base, expiry: Number.NaN }), /expiry/);
  assert.throws(() => policyCalendarEvents({ ...base, claimGraceMs: -1 }), /claimGraceMs/);
});

test("icsTime writes UTC basic format", () => {
  assert.equal(icsTime(Date.UTC(2026, 9, 13, 21, 41, 5, 123)), "20261013T214105Z");
});

test("icsEscape escapes backslash, semicolon, comma and newlines", () => {
  assert.equal(icsEscape("a\\b;c,d\ne"), "a\\\\b\\;c\\,d\\ne");
});

test("icsFold keeps lines within 75 octets and never splits a UTF-8 character", () => {
  const line = "DESCRIPTION:" + "€…ab".repeat(40);
  const folded = icsFold(line);
  const enc = new TextEncoder();
  for (const l of folded.split("\r\n")) assert.ok(enc.encode(l).length <= 75, `${enc.encode(l).length} octets`);
  assert.equal(folded.split("\r\n").map((l, i) => (i ? l.slice(1) : l)).join(""), line);
  assert.equal(icsFold("SHORT:ok"), "SHORT:ok");
});

test("the .ics file is well formed, CRLF-terminated and deterministic", () => {
  const ics = policyCalendarIcs(base);
  assert.equal(ics, policyCalendarIcs(base));
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(ics), "every newline is CRLF");
  const unfolded = ics.replace(/\r\n /g, "");
  assert.equal(unfolded.match(/BEGIN:VEVENT/g)?.length, 3);
  assert.equal(unfolded.match(/BEGIN:VALARM/g)?.length, 3);
  assert.ok(unfolded.includes(`DTSTART:${icsTime(base.expiry + 7 * DAY)}`));
  assert.ok(unfolded.includes("TRIGGER:-PT4320M"));
  assert.ok(unfolded.includes("(250 tUSDCx)"));
  for (const l of ics.split("\r\n")) assert.ok(new TextEncoder().encode(l).length <= 75);
});

test("filename and Google Calendar link", () => {
  assert.equal(policyCalendarFilename(base.policyId), "plutusshield-policy-abababab.ics");
  const ev = policyCalendarEvents(base)[2];
  const u = new URL(googleCalendarUrl(ev));
  assert.equal(u.origin + u.pathname, "https://calendar.google.com/calendar/render");
  assert.equal(u.searchParams.get("action"), "TEMPLATE");
  assert.equal(u.searchParams.get("dates"), `${icsTime(ev.at)}/${icsTime(ev.at + 15 * 60_000)}`);
  assert.equal(u.searchParams.get("text"), ev.summary);
});
