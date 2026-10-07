import { Button } from "@/components/ui/Button";
import { explorerTx } from "@/lib/preview";
import { shortHash } from "@/lib/midnightPreprod";
import { MIDNIGHT_V2 as V, type CommitteeClaim } from "@/lib/midnightPreprodV2";

const statusTone: Record<string, string> = {
  PAID: "border-success/30 bg-success/[0.08] text-success",
  ACTIVE: "border-[var(--hairline)] bg-white/[0.03] text-text-muted",
  CLAIM_PENDING: "border-midnight/30 bg-midnight/[0.08] text-midnight",
};
const statusLabel: Record<string, string> = { PAID: "PAID", ACTIVE: "Rejected → ACTIVE", CLAIM_PENDING: "Pending" };

function Hash({ h, title }: { h: string; title?: string }) {
  return (
    <span className="font-mono text-[11px] text-text" title={title ?? h}>
      {shortHash(h)}
    </span>
  );
}

function Tally({ yes, no }: { yes: number; no: number }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${yes} approvals, ${no} rejections of ${V.threshold} needed`}>
      {Array.from({ length: V.threshold }, (_, i) => (
        <span key={`y${i}`} className={`h-1.5 w-4 rounded-full ${i < yes ? "bg-success" : "bg-white/10"}`} aria-hidden="true" />
      ))}
      <span className="mx-1 text-[10px] text-text-dim">·</span>
      {Array.from({ length: V.threshold }, (_, i) => (
        <span key={`n${i}`} className={`h-1.5 w-4 rounded-full ${i < no ? "bg-danger/80" : "bg-white/10"}`} aria-hidden="true" />
      ))}
    </span>
  );
}

function ClaimVotes({ c }: { c: CommitteeClaim }) {
  const reg = V.registrations.find((x) => x.policyId === c.policyId);
  return (
    <div className="mt-4 overflow-x-auto rounded-2xl border border-[var(--hairline)] bg-white/[0.02]">
      <table className="w-full min-w-[640px] text-left text-xs">
        <caption className="px-4 pt-3 text-left font-mono-label text-[9.5px] text-text-dim">
          Policy {shortHash(c.policyId)}
          {c.buyTx ? " · Cardano Preview Buy " : ""}
          {c.buyTx && (
            <a href={explorerTx(c.buyTx)} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-4 hover:text-cardano">
              {shortHash(c.buyTx)} ↗
            </a>
          )}
        </caption>
        <thead>
          <tr className="font-mono-label text-[9.5px] text-text-dim">
            <th className="px-4 py-2.5 font-normal">Step</th>
            <th className="px-4 py-2.5 font-normal">Who</th>
            <th className="px-4 py-2.5 font-normal">Midnight tx</th>
            <th className="px-4 py-2.5 font-normal">Tally after (approve · reject)</th>
            <th className="px-4 py-2.5 font-normal">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--hairline)]">
          {reg?.registerPolicy && (
            <tr>
              <td className="px-4 py-3">registerPolicy</td>
              <td className="px-4 py-3 text-text-muted">Issuer</td>
              <td className="px-4 py-3"><Hash h={reg.registerPolicy.txHash} /></td>
              <td className="px-4 py-3 text-text-dim">Binding to the Cardano datum re-checked in circuit</td>
              <td className="px-4 py-3 text-text-muted">ACTIVE</td>
            </tr>
          )}
          {reg?.proveCover && (
            <tr>
              <td className="px-4 py-3">proveCover</td>
              <td className="px-4 py-3 text-text-muted">Holder</td>
              <td className="px-4 py-3"><Hash h={reg.proveCover.txHash} /></td>
              <td className="px-4 py-3 text-text-dim">Cover proven without revealing amount or holder</td>
              <td className="px-4 py-3 text-text-muted">ACTIVE</td>
            </tr>
          )}
          {c.fileClaim && (
            <tr>
              <td className="px-4 py-3">fileClaim</td>
              <td className="px-4 py-3 text-text-muted">Holder</td>
              <td className="px-4 py-3"><Hash h={c.fileClaim.txHash} /></td>
              <td className="px-4 py-3 text-text-dim">
                Evidence commitment <Hash h={c.evidenceCommitment} />
              </td>
              <td className="px-4 py-3 text-midnight">CLAIM_PENDING</td>
            </tr>
          )}
          {c.votes.map((v) => (
            <tr key={v.txHash}>
              <td className="px-4 py-3">voteClaim · {v.approved ? "approve" : "reject"}</td>
              <td className="px-4 py-3 text-text-muted">
                Seat #{v.seat} <Hash h={v.member} />
              </td>
              <td className="px-4 py-3">
                <Hash h={v.txHash} />
                {v.block != null && <span className="block text-[10.5px] text-text-dim">block {v.block.toLocaleString("en-US")}</span>}
              </td>
              <td className="px-4 py-3">
                <Tally yes={v.approvals} no={v.rejections} />
              </td>
              <td className="px-4 py-3">
                <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] ${statusTone[v.statusAfter] ?? statusTone.ACTIVE}`}>
                  {statusLabel[v.statusAfter] ?? v.statusAfter}
                </span>
              </td>
            </tr>
          ))}
          {!c.votes.length && (
            <tr>
              <td colSpan={5} className="px-4 py-3 text-[11px] text-text-muted">
                No committee votes yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Midnight policy-cover v2: claims decided by an M-of-3 assessor committee
 * vote in zero knowledge. Every vote is a public, attributable tx; no single
 * key decides a claim on either chain.
 */
export function MidnightCommittee() {
  const votes = V.claims.reduce((n, c) => n + c.votes.length, 0);
  return (
    <section aria-labelledby="midnight-committee-title" className="glass-panel relative mt-10 overflow-hidden p-6 sm:p-8">
      <div
        className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,var(--midnight-soft),transparent)] blur-2xl"
        aria-hidden="true"
      />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="font-mono-label text-[10px] text-midnight">Claims committee · {V.network} · policy-cover v2</p>
          <h2 id="midnight-committee-title" className="mt-2 font-display text-2xl leading-tight text-text sm:text-[1.75rem]">
            {V.quorumLabel} on <em className="text-midnight-grad">Midnight</em>, {V.quorumLabel} on <em className="text-cardano-grad">Cardano.</em>
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">
            v2 replaces the single-assessor <span className="font-mono">resolveClaim</span> with{" "}
            <span className="font-mono">voteClaim</span>. Each committee member proves its seat by opening one of three public role
            commitments inside the circuit. {V.threshold} approvals mark the claim PAID, {V.threshold} rejections send it back to ACTIVE
            with the evidence cleared, and a split vote waits for the last seat. One vote per seat per claim round, every vote on the
            public ledger.
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--hairline)] bg-white/[0.02] px-4 py-3 text-right">
          <p className="font-mono-label text-[9.5px] text-text-dim">Committee votes on Preprod</p>
          <p className="mt-1 font-display text-3xl text-text">{votes}</p>
        </div>
      </div>

      <ul className="relative mt-6 grid gap-2 sm:grid-cols-3">
        {V.committee.map((m) => {
          const cast = V.claims.flatMap((c) => c.votes).filter((v) => v.seat === m.seat);
          return (
            <li key={m.commitment} className="rounded-xl border border-midnight/25 bg-midnight/[0.04] px-3 py-2.5">
              <p className="font-mono-label text-[9px] text-text-dim">Seat #{m.seat} · role commitment</p>
              <p className="mt-0.5">
                <Hash h={m.commitment} />
              </p>
              <p className="mt-0.5 text-[10.5px] text-text-dim">
                {cast.length ? cast.map((v) => (v.approved ? "Approved" : "Rejected")).join(", ") : "No votes cast yet"}
              </p>
            </li>
          );
        })}
      </ul>

      {V.live ? (
        V.claims.map((c) => <ClaimVotes key={`${c.policyId}-${c.evidenceCommitment}`} c={c} />)
      ) : (
        <p className="relative mt-4 rounded-xl border border-[var(--hairline)] bg-white/[0.02] px-4 py-3 text-[12px] text-text-muted">
          The v2 registry is being deployed to Preprod with this committee. v1 keeps serving the relay and the live counters until then.
        </p>
      )}

      <dl className="relative mt-4 grid gap-3 text-[11px] sm:grid-cols-3">
        <div>
          <dt className="text-text-dim">v2 contract</dt>
          <dd className="mt-0.5">{V.contractAddress ? <Hash h={V.contractAddress} /> : <span className="text-text-muted">Deploying</span>}</dd>
        </div>
        <div>
          <dt className="text-text-dim">Deploy tx</dt>
          <dd className="mt-0.5">
            {V.deployTxId ? <Hash h={V.deployTxId} /> : <span className="text-text-muted">Pending</span>}
            {V.deployBlock != null && <span className="ml-1 text-text-dim">block {V.deployBlock.toLocaleString("en-US")}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-text-dim">Compiler</dt>
          <dd className="mt-0.5 text-text">{V.compiler}</dd>
        </div>
      </dl>

      <p className="relative mt-4 text-[11px] leading-relaxed text-text-dim">
        Trust model, plainly: the three seat secrets are held by the PlutusShield team on Preprod today, not yet by independent
        operators. Each seat checks the sealed evidence off-ledger before voting. Demo evidence and test policies only, not audited.
      </p>

      <div className="relative mt-5 flex flex-wrap gap-2">
        <Button href={V.record} external variant="secondary" size="sm">
          v2 Preprod record <span aria-hidden="true">↗</span>
        </Button>
        <Button href={V.source} external variant="ghost" size="sm">
          policy-cover-v2.compact <span aria-hidden="true">↗</span>
        </Button>
      </div>
    </section>
  );
}
