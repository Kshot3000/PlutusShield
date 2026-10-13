import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { MILESTONES, REPO, type MilestoneState } from "@/lib/status";
import report from "@/data/test-report.json";

/**
 * The static half of /status: the roadmap from @/lib/status (the same list
 * /app shows in full) and the test counts recorded by `pnpm test:report`
 * (the same report SECURITY.md and /docs/security cite).
 */
const dot: Record<MilestoneState, string> = {
  done: "bg-success",
  next: "bg-gold animate-pulse-dot text-gold",
  planned: "bg-border-strong",
};
const label: Record<MilestoneState, string> = { done: "Done", next: "Next", planned: "Planned" };
const labelTone: Record<MilestoneState, string> = { done: "text-success", next: "text-gold", planned: "text-text-dim" };

const s = report.suites;
const suites = [
  { k: "Aiken validator checks", v: s.aiken, chain: "Cardano" },
  { k: "Emulator end-to-end steps", v: s.emulator, chain: "Cardano", note: `${s.emulator.refused} prove a bad tx is refused` },
  { k: "Midnight simulation tests", v: s.midnight, chain: "Midnight" },
  { k: "SDK tests", v: s.sdk, chain: "Off-chain" },
  { k: "Oracle relay tests", v: s.relay, chain: "Off-chain" },
  { k: "Committee kit tests", v: s.committee, chain: "Off-chain" },
];
const failing = suites.reduce((a, x) => a + x.v.fail, 0);
const recorded = new Date(report.recordedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function RoadmapStrip() {
  const done = MILESTONES.filter((m) => m.state === "done").length;
  return (
    <section className="card-surface p-6 sm:p-8" aria-labelledby="status-roadmap">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="status-roadmap" className="font-display text-[1.6rem] leading-tight text-text">
          Road to mainnet
        </h2>
        <p className="font-mono-label text-[10px] text-text-dim">
          {done}/{MILESTONES.length} done
        </p>
      </div>
      <div
        className="mt-3 h-1 overflow-hidden rounded-full bg-bg-muted"
        role="progressbar"
        aria-label="Launch milestones done"
        aria-valuemin={0}
        aria-valuemax={MILESTONES.length}
        aria-valuenow={done}
      >
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,var(--cardano),var(--accent),var(--midnight))]"
          style={{ width: `${(done / MILESTONES.length) * 100}%` }}
        />
      </div>
      <ol className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {MILESTONES.map((m) => (
          <li key={m.label} className="flex items-start gap-2.5 rounded-xl border border-[var(--hairline)] bg-black/20 px-3.5 py-3" title={m.detail}>
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot[m.state]}`} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-[13px] leading-snug text-text">{m.label}</span>
              <span className={`font-mono-label text-[9px] ${labelTone[m.state]}`}>{label[m.state]}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[12.5px] text-text-dim">
        Each step in full, with what it covers, is on{" "}
        <Link href="/app" className="text-accent hover:underline">
          /app
        </Link>
        . Mainnet waits on the external audit.
      </p>
    </section>
  );
}

export function ProofStrip() {
  return (
    <section className="card-surface p-6 sm:p-8" aria-labelledby="status-proof">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={failing ? "gold" : "accent"}>{failing ? `${failing} failing` : "All passing"}</Badge>
        <Badge>Recorded {recorded} · {report.commit}</Badge>
      </div>
      <h2 id="status-proof" className="mt-4 font-display text-[1.6rem] leading-tight text-text">
        {report.total} tests and a {s.emulator.total}-step emulator run on main
      </h2>
      <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-text-muted">
        Counts come from the report <span className="font-mono text-[12px]">pnpm test:report</span> writes after running every
        suite. The site build fails if the README or SECURITY.md quote a count that disagrees with it.
      </p>
      <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {suites.map((x) => (
          <div key={x.k} className="rounded-2xl border border-[var(--hairline)] bg-black/25 px-4 py-3">
            <dt className="font-mono-label text-[9px] text-text-dim">{x.chain}</dt>
            <dd className="mt-1 font-display text-2xl tabular-nums text-text">
              {x.v.pass}
              <span className="text-[13px] text-text-dim">/{x.v.total}</span>
            </dd>
            <dd className="mt-0.5 text-[12px] text-text-muted">{x.k}</dd>
            {x.note ? <dd className="mt-0.5 text-[11px] text-text-dim">{x.note}</dd> : null}
          </div>
        ))}
      </dl>
      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[12.5px]">
        <Link href="/docs/security" className="text-accent hover:underline">
          Security &amp; audit scope →
        </Link>
        <a href={`${REPO}/blob/main/SECURITY.md`} target="_blank" rel="noreferrer" className="text-text-muted hover:text-text">
          SECURITY.md ↗
        </a>
      </div>
    </section>
  );
}
