import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ClaimChecker } from "@/components/claim/ClaimChecker";

export const metadata: Metadata = {
  title: "Claims",
  description:
    "Check whether a PlutusShield depeg claim would settle on Cardano: oracle quorum, the 24-hour TWAP trigger, the claim window, and the sale circuit-breaker, using the validator's exact rules.",
};

const notes = [
  {
    title: "No claims form",
    body: "Depeg cover is parametric. When a quorum of allowlisted oracle feeds attests a 24-hour average below 0.95 inside your cover period, anyone holding the policy token can settle. Nobody approves it.",
  },
  {
    title: "Earliest provable window",
    body: "The relay searches every window the validator could accept and publishes the first one that proves the trigger, so a claim is available as early as the data allows.",
  },
  {
    title: "Private on Midnight",
    body: "Exploit cover goes through the Midnight registry instead. fileClaim posts only a commitment to the evidence, keyed by the same policy id, and the assessor committee records the outcome by voteClaim (2-of-3).",
    link: { href: "/claim/evidence", label: "Seal exploit evidence" },
  },
];

export default function ClaimPage() {
  return (
    <AppShell
      active="claim"
      title="Claim checker"
      description="See exactly when a depeg policy pays out. Move through an example market, knock feeds offline, and watch the same checks the Cardano validator runs decide the claim."
    >
      <ClaimChecker />
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {notes.map((n) => (
          <div key={n.title} className="glass-panel relative rounded-[1.4rem] p-6">
            <p className="text-sm font-semibold text-text">{n.title}</p>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">{n.body}</p>
            {"link" in n && n.link ? (
              <Link
                href={n.link.href}
                className="mt-3 inline-flex text-sm font-medium text-midnight underline-offset-4 hover:underline"
              >
                {n.link.label} <span aria-hidden="true">&nbsp;→</span>
              </Link>
            ) : null}
          </div>
        ))}
      </div>
      <p className="mt-6 text-xs leading-relaxed text-text-dim">
        Prices on this page are synthetic example data. The verdicts are not: they come from the SDK&apos;s exact mirrors of{" "}
        <code className="font-mono">oracle.ak</code> and the oracle relay&apos;s window search. Live claims open with the Cardano
        Preview pool. Read{" "}
        <Link href="/docs/settlement" className="text-text-muted underline underline-offset-4 hover:text-text">
          how settlement works
        </Link>{" "}
        and the{" "}
        <Link href="/docs/risks" className="text-text-muted underline underline-offset-4 hover:text-text">
          oracle risks
        </Link>
        .
      </p>
    </AppShell>
  );
}
