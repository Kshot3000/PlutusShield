"use client";

/**
 * "Add deadlines to calendar" for one policy: a downloadable .ics (cover
 * active, expiry with a 1-day reminder, last moment to claim with 3-day and
 * 1-day reminders) plus a Google Calendar link for the claim deadline.
 * Built in the browser from the policy record by @plutusshield/sdk/calendar;
 * nothing is uploaded anywhere.
 */
import { useMemo, useState } from "react";
import {
  googleCalendarUrl,
  policyCalendarEvents,
  policyCalendarFilename,
  policyCalendarIcs,
  type PolicyCalendarInput,
} from "@plutusshield/sdk/calendar";
import { Button } from "@/components/ui/Button";
import type { KnownPolicy } from "@/lib/policyTimeline";

const SITE_ROOT =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.NEXT_PUBLIC_BASE_PATH ? `https://kshot3000.github.io${process.env.NEXT_PUBLIC_BASE_PATH}` : "https://kshot3000.github.io/PlutusShield");

const fmt = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

const KIND_LABEL = { active: "Cover active", expires: "Cover expires", "claim-deadline": "Last moment to claim" } as const;

export function PolicyCalendar({ policy, claimGraceMs, coverage }: { policy: KnownPolicy; claimGraceMs: number; coverage: string | null }) {
  const [saved, setSaved] = useState(false);
  const input = useMemo<PolicyCalendarInput | null>(() => {
    if (!policy.expiry) return null;
    const id = policy.policyId;
    return {
      policyId: id,
      product: policy.product === "depeg" ? "depeg" : "exploit",
      start: policy.start && policy.start < policy.expiry ? policy.start : null,
      expiry: policy.expiry,
      claimGraceMs,
      trackerUrl: `${SITE_ROOT}/policy/?id=${id}`,
      claimUrl: policy.product === "depeg" ? `${SITE_ROOT}/claim/` : `${SITE_ROOT}/claim/evidence/?policy=${id}`,
      coverage,
    };
  }, [policy, claimGraceMs, coverage]);
  const events = useMemo(() => (input ? policyCalendarEvents(input) : []), [input]);

  if (!input) return null;
  const deadline = events.find((e) => e.kind === "claim-deadline") ?? events[events.length - 1];

  const download = () => {
    const blob = new Blob([policyCalendarIcs({ ...input, stamp: Date.now() })], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = policyCalendarFilename(input.policyId);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSaved(true);
  };

  return (
    <section aria-labelledby="calendar-title" className="glass-panel relative mt-6 p-5 sm:p-8">
      <h2 id="calendar-title" className="text-lg font-semibold tracking-tight text-text">
        Deadlines
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        Put this policy&apos;s dates in your calendar so the claim window never closes on you. The file is built in your browser; nothing is sent anywhere.
      </p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-3">
        {events.map((e) => (
          <li key={e.kind} className="rounded-xl border border-[var(--hairline)] px-3 py-2">
            <p className="text-[11px] text-text-dim">{KIND_LABEL[e.kind]}</p>
            <p className="text-xs text-text">{fmt(e.at)}</p>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={download}>
          Download .ics
        </Button>
        <Button href={googleCalendarUrl(deadline)} external variant="secondary" size="sm">
          Add {deadline.kind === "claim-deadline" ? "claim deadline" : "expiry"} to Google Calendar
        </Button>
        <span className="text-[11px] text-text-dim" role="status">
          {saved ? "Saved. Open the file to import it into Apple Calendar, Outlook or Google Calendar." : "Works with Apple Calendar, Outlook and Google Calendar."}
        </span>
      </div>
    </section>
  );
}
