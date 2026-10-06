import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ShieldMark } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { MILESTONES, RUNBOOK, type MilestoneState } from "@/lib/status";

export const metadata: Metadata = {
  title: "App",
  description:
    "Your PlutusShield cover and underwriting dashboard. Quote cover, simulate the pool, and track the road to Cardano Preview.",
};

const stateCopy: Record<MilestoneState, { label: string; dot: string; text: string }> = {
  done: { label: "Done", dot: "bg-success", text: "text-success" },
  next: { label: "Next", dot: "bg-gold animate-pulse-dot text-gold", text: "text-gold" },
  planned: { label: "Planned", dot: "bg-border-strong", text: "text-text-dim" },
};

export default function AppPage() {
  const done = MILESTONES.filter((m) => m.state === "done").length;
  return (
    <AppShell
      active="app"
      title="Your shield"
      description="Policies, claims, and LP positions will show up here once the Cardano Preview pool is live. Until then, price cover and stress-test the pool. The math matches the validator exactly."
    >
      <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
        <StatusCard label="Wallet" value="Not connected" hint="CIP-30 wallets (Lace, Eternl) on Preview" />
        <StatusCard label="Active policies" value="0" hint="Bought policies appear here with their timeline" />
        <StatusCard label="LP positions" value="0" hint="lp00 (ADA) and lp01 (USDC) shares" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <section aria-labelledby="empty-title" className="glass-panel relative overflow-hidden p-6 sm:p-10">
          <div
            className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,rgba(140,100,255,0.22),transparent)] blur-2xl"
            aria-hidden="true"
          />
          <div className="relative flex h-14 w-14 items-center justify-center" aria-hidden="true">
            <span className="absolute inset-0 rounded-full bg-accent opacity-25 blur-xl" />
            <ShieldMark size={44} className="relative" />
          </div>
          <h2 id="empty-title" className="relative mt-6 font-display text-[2rem] leading-tight text-text">
            No cover yet. <em className="text-accent-strong">Start with a quote.</em>
          </h2>
          <p className="relative mt-3 max-w-md text-sm leading-relaxed text-text-muted">
            Choose ADA or USDC, set a size and term, and see the exact premium the validator would accept, with the
            waiting period, peg check, and payout spelled out before you ever connect a wallet.
          </p>
          <div className="relative mt-7 grid gap-3 sm:grid-cols-2">
            <Link
              href="/cover"
              className="group rounded-2xl border border-[var(--hairline)] bg-white/[0.02] p-4 transition-colors hover:border-[color-mix(in_srgb,var(--accent)_45%,transparent)] hover:bg-[var(--accent-glow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <p className="font-mono-label text-[9.5px] text-text-dim">Buyers</p>
              <p className="mt-1.5 text-sm font-semibold text-text">
                Quote cover <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
              </p>
              <p className="mt-1 text-xs text-text-muted">Depeg cover in ADA or USDC</p>
            </Link>
            <Link
              href="/pool"
              className="group rounded-2xl border border-[var(--hairline)] bg-white/[0.02] p-4 transition-colors hover:border-[color-mix(in_srgb,var(--cardano)_45%,transparent)] hover:bg-[var(--cardano-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <p className="font-mono-label text-[9.5px] text-text-dim">Underwriters</p>
              <p className="mt-1.5 text-sm font-semibold text-text">
                Simulate the pool <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
              </p>
              <p className="mt-1 text-xs text-text-muted">Shares, premiums, claim stress</p>
            </Link>
          </div>
        </section>

        <section aria-labelledby="tracker-title" className="glass-panel relative p-6 sm:p-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="tracker-title" className="font-mono-label text-[10px] text-text-dim">
              Road to Preview
            </h2>
            <p className="font-mono text-xs text-text-muted">
              {done}/{MILESTONES.length}
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
          <ol className="mt-6 space-y-0">
            {MILESTONES.map((m, i) => {
              const s = stateCopy[m.state];
              return (
                <li key={m.label} className="relative flex gap-4 pb-5 last:pb-0">
                  {i < MILESTONES.length - 1 && (
                    <span className="absolute left-[5px] top-4 h-full w-px bg-[var(--hairline)]" aria-hidden="true" />
                  )}
                  <span className={`relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full ${s.dot}`} aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-text">
                      {m.label}
                      <span className={`font-mono-label text-[9px] ${s.text}`}>{s.label}</span>
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{m.detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--hairline)] pt-5">
            <Button href={RUNBOOK} external variant="secondary" size="sm">
              Preview runbook <span aria-hidden="true">↗</span>
            </Button>
            <Button href="/docs/risks" variant="ghost" size="sm">
              Risks &amp; disclosures
            </Button>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function StatusCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="glass-panel relative flex items-center justify-between gap-4 rounded-[1.4rem] px-5 py-4 sm:block sm:p-6">
      <p className="font-mono-label text-[9.5px] text-text-dim">{label}</p>
      <p className="font-display text-2xl text-text-muted sm:mt-3 sm:text-3xl">{value}</p>
      <p className="mt-1 hidden text-xs text-text-dim sm:block">{hint}</p>
    </div>
  );
}
