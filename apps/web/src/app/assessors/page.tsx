import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { CommandBlock } from "@/components/assessors/CommandBlock";
import { HashCell } from "@/components/assessors/HashCell";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  COMMITTEE,
  DUTIES,
  ENROLL_ISSUE,
  FIRST_DRILL,
  KIT_CLI,
  KIT_DIR,
  KIT_FILES,
  KIT_LIB,
  KIT_README,
  KIT_STEPS,
  KIT_TESTS,
  RELAY_SRC,
  RUNBOOK,
  cardanoAddressHref,
  cardanoTxHref,
} from "@/lib/assessors";
import { adaOf } from "@/lib/exploitPreview";
import { shortHash } from "@/lib/midnightPreprod";

export const metadata: Metadata = {
  title: "Assessors",
  description:
    "How independent assessors join PlutusShield's 2-of-3 claims committee: co-sign Cardano Preview Settle payouts and cast zero-knowledge voteClaim votes on Midnight Preprod. Offline enrollment kit, the current committee, and the first committee drill. Testnet only, not audited.",
};

const chainBadge = {
  cardano: { variant: "cardano" as const, label: "Cardano" },
  midnight: { variant: "midnight" as const, label: "Midnight" },
  both: { variant: "accent" as const, label: "Off-ledger" },
};

const principles = [
  { k: "0", t: "single keys that can release capital" },
  { k: "1", t: "lost key can't stall a payout" },
  { k: "1", t: "bad key is simply outvoted" },
];

/** Render `inline code` spans in plain copy (so flags like --seat don't become typographic dashes). */
function withCode(text: string) {
  return text.split(/`([^`]+)`/).map((part, i) =>
    i % 2 ? (
      <code key={i} className="font-mono text-[0.92em] text-text [overflow-wrap:anywhere]">
        {part}
      </code>
    ) : (
      part
    ),
  );
}

const related = [
  { href: "/claim/evidence", eyebrow: "Claimant side", title: "Evidence vault", body: "Seal a bundle in the browser, file only its commitment, and verify a bundle the way an assessor does." },
  { href: "/policy", eyebrow: "One policy, both chains", title: "Policy tracker", body: "Follow a policy from its Cardano Buy through Midnight registration, claim, committee votes and Settle." },
  { href: "/demo", eyebrow: "Three minutes", title: "Guided demo", body: "Five steps with the live testnet transactions, including the 2-of-3 committee payout." },
  { href: "/app", eyebrow: "Live counters", title: "Your shield", body: "The v2 committee registry's claims, votes and activity read from Midnight Preprod." },
  { href: "/docs/settlement#assessed", eyebrow: "Trust model", title: "Assessed claims", body: "Why Cardano can't read Midnight, and why the committee's signatures are the bridge." },
];

export default function AssessorsPage() {
  const { cardano: payout, midnight: drill } = FIRST_DRILL;
  return (
    <AppShell
      active="claim"
      title="Assessors"
      description="Exploit claims can't settle on an oracle, so a committee decides them: two of three seats on both chains, and no single key that can move capital. Here is how an independent assessor takes a seat."
    >
      {/* No typographic ligatures in commands (e.g. "--seat", "-<n>"). */}
      <div className="[&_code]:[font-variant-ligatures:none] [&_pre]:[font-variant-ligatures:none]">
      {/* Honest status */}
      <section className="card-surface p-6 sm:p-8" aria-labelledby="assessor-status">
        <div className="grid gap-8 lg:grid-cols-[1.25fr_1fr] lg:items-center">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="gold">Testnet only</Badge>
              <Badge>Not audited</Badge>
              <Badge variant="cardano">Cardano Preview</Badge>
              <Badge variant="midnight">Midnight Preprod</Badge>
            </div>
            <h2 id="assessor-status" className="mt-5 font-display text-[1.9rem] leading-[1.06] text-text sm:text-[2.5rem] text-balance">
              Three seats. Two signatures. <em className="text-shield-grad">No single key.</em>
            </h2>
            <p className="mt-3 max-w-xl text-[14.5px] leading-relaxed text-text-muted text-pretty">
              Honest status: today all three Cardano Preview committee keys and all three Midnight Preprod seats are run by
              the PlutusShield team. The rules are already enforced on-chain; who holds the seats is what changes next.
              Independent operators come before any mainnet capital, and the enrollment kit for them is in the repo.
            </p>
            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
              <Button href="#kit" className="w-full sm:w-auto">
                Enroll with the kit
              </Button>
              <Button href={KIT_README} external variant="secondary" className="w-full sm:w-auto">
                Kit README <span aria-hidden="true">↗</span>
              </Button>
              <Button href="#committee" variant="ghost" className="w-full sm:w-auto">
                See today&apos;s committee
              </Button>
            </div>
          </div>

          <div className="rounded-[1.4rem] border border-[var(--hairline)] bg-white/[0.02] p-5 sm:p-6">
            <div className="flex items-baseline justify-between gap-4">
              <p className="font-mono-label text-[10px] text-text-dim">Committee seats</p>
              <p className="font-mono-label text-[10px] text-gold">
                {COMMITTEE.threshold}-of-{COMMITTEE.size} on both chains
              </p>
            </div>
            <ul className="mt-4 grid grid-cols-3 gap-2.5">
              {COMMITTEE.seats.map((s) => (
                <li key={s.seat} className="rounded-2xl border border-[var(--hairline)] bg-black/30 px-2 py-3 text-center">
                  <p className="font-mono text-[11px] text-text-dim">Seat {s.seat}</p>
                  <div className="mx-auto mt-2.5 flex h-9 w-9 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--gold)_40%,transparent)] bg-[var(--gold-soft)]">
                    <span className="h-2 w-2 rounded-full bg-gold" aria-hidden="true" />
                  </div>
                  <p className="mt-2.5 whitespace-nowrap text-[11.5px] text-text sm:text-[12px]">Team-run</p>
                </li>
              ))}
            </ul>
            <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-[var(--hairline)] pt-4 text-[12.5px]">
              <div>
                <dt className="text-text-dim">Independent operators</dt>
                <dd className="mt-0.5 font-display text-2xl text-text">0 / {COMMITTEE.size}</dd>
              </div>
              <div>
                <dt className="text-text-dim">Enrollment kit</dt>
                <dd className="mt-1.5 text-text">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" aria-hidden="true" />
                    Shipped, offline
                  </span>
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* Why 2-of-3 */}
      <section className="mt-14 sm:mt-20" aria-labelledby="why">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="font-mono-label text-[10.5px] text-accent">Why 2-of-3</p>
            <h2 id="why" className="mt-3 font-display text-[1.9rem] leading-[1.06] text-text sm:text-4xl text-balance">
              The committee is the bridge, so it can&apos;t be one key.
            </h2>
            <p className="mt-3 max-w-md text-[14px] leading-relaxed text-text-muted text-pretty">
              Cardano can&apos;t read Midnight state. An exploit payout on Cardano therefore rests on the people who checked the
              Midnight decision. PlutusShield makes that a threshold on both chains instead of a trusted operator.
            </p>
            <ul className="mt-6 space-y-2.5">
              {principles.map((p) => (
                <li key={p.t} className="flex items-baseline gap-3">
                  <span className="w-6 font-display text-2xl text-gold">{p.k}</span>
                  <span className="text-[14px] text-text-muted">{p.t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <article className="card-surface p-6" aria-labelledby="why-cardano">
              <Badge variant="cardano">Cardano Preview · money</Badge>
              <h3 id="why-cardano" className="mt-4 text-[17px] font-semibold text-text">
                Settle needs two committee signatures
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-text-muted text-pretty">
                The exploit-cover validator takes <code className="font-mono text-[12.5px] text-text">Committee &#123; assessors, threshold &#125;</code>{" "}
                as a script parameter. It counts distinct committee key hashes among the tx signers (outsiders and repeats
                don&apos;t count) and pays only at {COMMITTEE.threshold}. A 1-of-3 Settle was built and rejected by both the local
                and the Preview evaluator.
              </p>
              <a href={COMMITTEE.cardano.validator} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex text-[13px] font-medium text-cardano underline-offset-4 hover:underline">
                exploit_cover.ak <span aria-hidden="true">&nbsp;↗</span>
              </a>
            </article>
            <article className="card-surface p-6" aria-labelledby="why-midnight">
              <Badge variant="midnight">Midnight Preprod · secrets</Badge>
              <h3 id="why-midnight" className="mt-4 text-[17px] font-semibold text-text">
                voteClaim decides, in zero knowledge
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-text-muted text-pretty">
                policy-cover v2 stores only a commitment per seat. Each <code className="font-mono text-[12.5px] text-text">voteClaim</code>{" "}
                proves its voter holds that seat&apos;s secret, one vote per seat per claim round, and the claim flips to PAID at{" "}
                {COMMITTEE.threshold} approvals. The evidence itself never touches the ledger, only its commitment.
              </p>
              <a href={COMMITTEE.midnight.source} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex text-[13px] font-medium text-midnight underline-offset-4 hover:underline">
                policy-cover-v2.compact <span aria-hidden="true">&nbsp;↗</span>
              </a>
            </article>
          </div>
        </div>
      </section>

      {/* What an assessor does */}
      <section className="mt-14 sm:mt-20" aria-labelledby="duties">
        <p className="font-mono-label text-[10.5px] text-midnight">On every exploit claim</p>
        <h2 id="duties" className="mt-3 max-w-2xl font-display text-[1.9rem] leading-[1.06] text-text sm:text-4xl text-balance">
          What an assessor actually does
        </h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {DUTIES.map((d, i) => {
            const b = chainBadge[d.chain];
            return (
              <li key={d.title} className="card-surface flex flex-col p-6">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[12px] text-text-dim">{String(i + 1).padStart(2, "0")}</span>
                  <Badge variant={b.variant}>{b.label}</Badge>
                </div>
                <h3 className="mt-4 text-[16px] font-semibold text-text">{d.title}</h3>
                <p className="mt-2 flex-1 text-[13.5px] leading-relaxed text-text-muted text-pretty">{withCode(d.body)}</p>
                {d.code ? (
                  <code className="mt-4 block break-words rounded-xl border border-[var(--hairline)] bg-black/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-text">
                    {d.code}
                  </code>
                ) : null}
                {d.link ? (
                  <Link href={d.link.href} className="mt-4 inline-flex text-[13px] font-medium text-accent underline-offset-4 hover:underline">
                    {d.link.label} <span aria-hidden="true">&nbsp;→</span>
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ol>
        <p className="mt-4 text-[12px] leading-relaxed text-text-dim">
          The vote command is the Midnight Preprod relay (
          <a href={RELAY_SRC} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-text">
            policy-cover-preprod.mjs
          </a>
          , <code className="font-mono">PLUTUSSHIELD_COVER_VERSION=2</code>), run from the assessor&apos;s own machine with their seat file
          as <code className="font-mono">midnight-committee/member-&lt;seat&gt;.json</code>. It refuses to vote unless the bundle
          opens to the commitment on the ledger.
        </p>
      </section>

      {/* Enrollment kit */}
      <section id="kit" className="mt-14 scroll-mt-28 sm:mt-20" aria-labelledby="kit-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono-label text-[10.5px] text-gold">Enrollment kit · contracts/committee</p>
            <h2 id="kit-title" className="mt-3 max-w-2xl font-display text-[1.9rem] leading-[1.06] text-text sm:text-4xl text-balance">
              Take a seat in five commands. Offline.
            </h2>
            <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-text-muted text-pretty">
              No wallet, no network, no transaction. Your secrets are generated on your machine and never leave it; the only
              thing you share is a signed public record.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button href={KIT_DIR} external variant="secondary" size="sm">
              Browse the kit <span aria-hidden="true">↗</span>
            </Button>
            <Button href={KIT_TESTS} external variant="ghost" size="sm">
              Tests <span aria-hidden="true">↗</span>
            </Button>
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.35fr_1fr]">
          <ol className="flex min-w-0 flex-col gap-4">
            {KIT_STEPS.map((s) => (
              <li key={s.n} className="card-surface p-5 sm:p-6">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[12px] text-gold">{s.n}</span>
                  <h3 className="text-[15.5px] font-semibold text-text">{s.title}</h3>
                </div>
                <p className="mt-2 text-[13.5px] leading-relaxed text-text-muted text-pretty">{withCode(s.body)}</p>
                <div className="mt-4">
                  <CommandBlock cmd={s.cmd} />
                </div>
                {s.note ? <p className="mt-2.5 text-[12px] leading-relaxed text-text-dim">{withCode(s.note)}</p> : null}
              </li>
            ))}
          </ol>

          <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
            <div className="card-surface p-5 sm:p-6">
              <p className="font-mono-label text-[10px] text-text-dim">What keygen writes</p>
              <ul className="mt-4 divide-y divide-[var(--hairline)]">
                {KIT_FILES.map((f) => (
                  <li key={f.file} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <code className="font-mono text-[12px] text-text">{f.file}</code>
                      <p className="mt-0.5 text-[12px] leading-snug text-text-dim">{f.what}</p>
                    </div>
                    <Badge variant={f.secret ? "gold" : "default"} className="shrink-0">
                      {f.secret ? "Secret · 0600" : "Public"}
                    </Badge>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[12px] leading-relaxed text-text-muted">
                Nobody from PlutusShield will ever ask for the secret files. Back them up offline.
              </p>
            </div>

            <div className="card-surface p-5 sm:p-6">
              <p className="font-mono-label text-[10px] text-text-dim">Inside enrollment.json</p>
              <pre className="mt-4 overflow-x-auto rounded-xl border border-[var(--hairline)] bg-black/40 p-4 font-mono text-[11px] leading-relaxed text-text-muted">
{`{
  "schema": "plutusshield/assessor-enrollment@1",
  "operator": { "handle": "@you", "affiliations": ["ExampleDEX"] },
  "cardano":  { "network": "preview", "vkey": "…",
                "keyHash": "<blake2b-224(vkey)>", "address": "addr_test1v…" },
  "midnight": { "network": "preprod",
                "seatCommitment": "<SHA-256 role commitment>" },
  "statement": "I control … I will vote or sign only after
                checking sealed evidence myself … recuse …",
  "signature": { "alg": "ed25519", "sig": "…" }
}`}
              </pre>
              <p className="mt-3 text-[12px] leading-relaxed text-text-muted text-pretty">
                The Cardano key signs a canonical payload binding your handle to this exact seat commitment. Owning the Midnight
                seat secret can&apos;t be shown by a signature (it is a hash preimage), so it is proven by a{" "}
                <code className="font-mono">voteClaim</code> on a drill claim after the redeploy.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button href={KIT_LIB} external variant="ghost" size="sm">
                  lib/kit.ts <span aria-hidden="true">↗</span>
                </Button>
                <Button href={KIT_CLI} external variant="ghost" size="sm">
                  cli.ts <span aria-hidden="true">↗</span>
                </Button>
              </div>
            </div>

            <div className="rounded-[1.4rem] border border-[color-mix(in_srgb,var(--gold)_30%,transparent)] bg-[var(--gold-soft)] p-5 sm:p-6">
              <p className="text-[14px] font-semibold text-text">Want a seat?</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-text-muted text-pretty">
                Run the kit, then open an issue on the repo with your public <code className="font-mono">enrollment.json</code>{" "}
                pasted in. Never attach the <code className="font-mono">.sk</code>, <code className="font-mono">.skey</code> or{" "}
                <code className="font-mono">midnight-seat.json</code> files.
              </p>
              <Button href={ENROLL_ISSUE} external size="sm" className="mt-4">
                Open an enrollment issue <span aria-hidden="true">↗</span>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Current committee */}
      <section id="committee" className="mt-14 scroll-mt-28 sm:mt-20" aria-labelledby="committee-title">
        <p className="font-mono-label text-[10.5px] text-accent">From the public deployment records</p>
        <h2 id="committee-title" className="mt-3 max-w-2xl font-display text-[1.9rem] leading-[1.06] text-text sm:text-4xl text-balance">
          Today&apos;s committee, seat by seat
        </h2>
        <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-text-muted text-pretty">
          Public values only: the Cardano key hashes the validator checks and the Midnight commitments the contract stores.
          The keys and seat secrets behind them never leave the operator&apos;s machine.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="card-surface p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant="cardano">Exploit-cover pool v2 · Cardano Preview</Badge>
              <span className="font-mono-label text-[10px] text-text-dim">{COMMITTEE.cardano.quorumLabel} Settle</span>
            </div>
            <dl className="mt-4 space-y-2.5 text-[12.5px]">
              <div>
                <dt className="text-text-dim">Script address</dt>
                <dd className="mt-0.5">
                  <HashCell value={COMMITTEE.cardano.address} href={cardanoAddressHref(COMMITTEE.cardano.address)} tone="cardano" />
                </dd>
              </div>
              <div>
                <dt className="text-text-dim">Script hash</dt>
                <dd className="mt-0.5">
                  <HashCell value={COMMITTEE.cardano.scriptHash} />
                </dd>
              </div>
            </dl>
            <a href={COMMITTEE.cardano.record} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex text-[13px] font-medium text-cardano underline-offset-4 hover:underline">
              preview-exploit-v2.json <span aria-hidden="true">&nbsp;↗</span>
            </a>
          </div>
          <div className="card-surface p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant="midnight">policy-cover v2 · Midnight Preprod</Badge>
              <span className="font-mono-label text-[10px] text-text-dim">{COMMITTEE.midnight.quorumLabel} voteClaim</span>
            </div>
            <dl className="mt-4 space-y-2.5 text-[12.5px]">
              <div>
                <dt className="text-text-dim">Contract address</dt>
                <dd className="mt-0.5">
                  {COMMITTEE.midnight.contractAddress ? (
                    <HashCell value={COMMITTEE.midnight.contractAddress} href={COMMITTEE.midnight.contractHref} tone="midnight" />
                  ) : (
                    <span className="text-text-muted">not deployed</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-text-dim">Threshold</dt>
                <dd className="mt-0.5 text-text">
                  {COMMITTEE.threshold} approvals of {COMMITTEE.size} seats
                </dd>
              </div>
            </dl>
            <a href={COMMITTEE.midnight.record} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex text-[13px] font-medium text-midnight underline-offset-4 hover:underline">
              preprod-v2.json <span aria-hidden="true">&nbsp;↗</span>
            </a>
          </div>
        </div>

        <ul className="mt-4 grid gap-4 lg:grid-cols-3">
          {COMMITTEE.seats.map((s) => (
            <li key={s.seat} className="card-surface p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[15px] font-semibold text-text">
                  Seat {s.seat} <span className="font-mono text-[12px] font-normal text-text-dim">· {s.name}</span>
                </p>
                <Badge variant="gold">Team-run</Badge>
              </div>
              <dl className="mt-4 space-y-3 text-[12.5px]">
                <div>
                  <dt className="flex items-center gap-1.5 text-text-dim">
                    <span className="h-1.5 w-1.5 rounded-full bg-cardano" aria-hidden="true" />
                    Cardano key hash
                  </dt>
                  <dd className="mt-1">
                    <code title={s.cardanoKeyHash} className="block break-all font-mono text-[11.5px] text-text">
                      {s.cardanoKeyHash}
                    </code>
                  </dd>
                </div>
                <div>
                  <dt className="text-text-dim">Preview address</dt>
                  <dd className="mt-1">
                    <code title={s.cardanoAddress} className="block break-all font-mono text-[11px] text-text-muted">
                      {s.cardanoAddress}
                    </code>
                  </dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1.5 text-text-dim">
                    <span className="h-1.5 w-1.5 rounded-full bg-midnight" aria-hidden="true" />
                    Midnight seat commitment
                  </dt>
                  <dd className="mt-1">
                    {s.midnightCommitment ? (
                      <code title={s.midnightCommitment} className="block break-all font-mono text-[11.5px] text-text">
                        {s.midnightCommitment}
                      </code>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] leading-relaxed text-text-dim">
          Seat n here is Cardano committee index n+1 and Midnight member n, the same pairing the kit&apos;s plan uses.
        </p>
      </section>

      {/* First committee drill */}
      {payout || drill ? (
        <section className="mt-14 sm:mt-20" aria-labelledby="drill">
          <p className="font-mono-label text-[10.5px] text-midnight">Proof it works</p>
          <h2 id="drill" className="mt-3 max-w-2xl font-display text-[1.9rem] leading-[1.06] text-text sm:text-4xl text-balance">
            The first committee drills, on-chain
          </h2>
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-text-muted text-pretty">
            Demo evidence and test value, decided by the team-run seats. The point is the mechanics: a split vote still
            resolves, and a payout needs two keys.
          </p>
          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            {drill ? (
              <div className="card-surface p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant="midnight">Midnight Preprod · voteClaim</Badge>
                  <span className="font-mono text-[11px] text-text-dim">claim {shortHash(drill.policyId)}</span>
                </div>
                <ol className="mt-4 divide-y divide-[var(--hairline)]">
                  {drill.fileClaim ? (
                    <li className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-[13px]">
                      <span className="text-text-muted">fileClaim (evidence commitment only)</span>
                      <HashCell value={drill.fileClaim.txHash} href={drill.fileClaim.href} tone="midnight" />
                    </li>
                  ) : null}
                  {drill.votes.map((v) => (
                    <li key={v.txHash} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-[13px]">
                      <span className="flex items-center gap-2 text-text">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${v.approved ? "bg-[var(--success)]" : "bg-[var(--danger)]"}`}
                          aria-hidden="true"
                        />
                        Seat {v.seat} {v.approved ? "approves" : "rejects"}
                        <span className="font-mono text-[11px] text-text-dim">
                          {v.approvals}–{v.rejections} · {v.statusAfter}
                        </span>
                      </span>
                      <HashCell value={v.txHash} href={v.href} tone="midnight" />
                    </li>
                  ))}
                </ol>
                <p className="mt-3 text-[12.5px] text-text-muted">
                  Decided <span className="font-semibold text-text">{drill.decided}</span> at {COMMITTEE.threshold} approvals, one
                  seat dissenting.
                </p>
              </div>
            ) : null}
            {payout ? (
              <div className="card-surface p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant="cardano">Cardano Preview · Settle</Badge>
                  <span className="font-mono text-[11px] text-text-dim">policy {shortHash(payout.policyId)}</span>
                </div>
                <p className="mt-5 font-display text-4xl text-text">{adaOf(payout.payout)}</p>
                <p className="mt-1 text-[13px] text-text-muted">
                  paid from the exploit-cover pool, co-signed by{" "}
                  <span className="text-text">{payout.signedBy.join(" + ")}</span>
                </p>
                <div className="mt-4">
                  <HashCell value={payout.settleTx} href={payout.href} tone="cardano" />
                </div>
                <p className="mt-4 text-[12px] leading-relaxed text-text-dim">
                  The same Settle with one signature (assessor-2 alone) failed script evaluation locally and on Preview, so it could never be submitted. This payout followed a claim
                  approved on the v1 Midnight registry; the live v2 registry decides by the voteClaim committee shown alongside.
                </p>
                {COMMITTEE.cardano.initTx ? (
                  <a href={cardanoTxHref(COMMITTEE.cardano.initTx)} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex text-[12.5px] text-cardano underline-offset-4 hover:underline">
                    InitPool with the 2-of-3 committee <span aria-hidden="true">&nbsp;↗</span>
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Path to independent seats */}
      <section className="card-surface mt-14 p-6 sm:mt-20 sm:p-10" aria-labelledby="path">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="font-mono-label text-[10.5px] text-gold">Before mainnet</p>
            <h2 id="path" className="mt-3 font-display text-[1.9rem] leading-[1.06] text-text sm:text-[2.4rem] text-balance">
              From team-run seats to independent ones
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-text-muted text-pretty">
              The committee is a script parameter on Cardano and a constructor argument on Midnight, so seating new operators
              means a new exploit-cover pool and a new policy-cover v2 contract. Nothing is rotated in place, and today&apos;s
              pool and contract stay readable as history. The redeploy is not automated by the kit, on purpose.
            </p>
          </div>
          <ol className="space-y-3">
            {RUNBOOK.map((r, i) => (
              <li key={r} className="flex gap-4">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--hairline)] font-mono text-[11px] text-text-muted">
                  {i + 1}
                </span>
                <span className="text-[14px] leading-relaxed text-text-muted">{r}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Related */}
      <section className="mt-14 sm:mt-20" aria-labelledby="related">
        <h2 id="related" className="font-mono-label text-[10.5px] text-text-dim">
          Related live pages
        </h2>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {related.map((r) => (
            <li key={r.href}>
              <Link
                href={r.href}
                className="card-surface group flex h-full flex-col p-5 transition-colors hover:border-white/15"
              >
                <span className="font-mono-label text-[9.5px] text-text-dim">{r.eyebrow}</span>
                <span className="mt-2 text-[15px] font-semibold text-text">
                  {r.title} <span aria-hidden="true" className="text-text-dim transition-colors group-hover:text-accent">→</span>
                </span>
                <span className="mt-1.5 text-[13px] leading-relaxed text-text-muted">{r.body}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-xs leading-relaxed text-text-dim">
          Preview and Preprod test value only. Not audited, not an offer of insurance. Committee facts are mirrored at build time
          from{" "}
          <a href={COMMITTEE.cardano.record} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-text">
            preview-exploit-v2.json
          </a>{" "}
          and{" "}
          <a href={COMMITTEE.midnight.record} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-text">
            preprod-v2.json
          </a>
          ; the kit commands are the ones in{" "}
          <a href={KIT_README} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-text">
            contracts/committee
          </a>
          .
        </p>
      </section>
      </div>
    </AppShell>
  );
}
