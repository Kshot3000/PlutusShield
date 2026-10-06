import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { MirroredOnMidnight } from "@/components/midnight/LiveContractActivity";
import { explorerTx } from "@/lib/preview";
import { MIDNIGHT_PREPROD as M, shortHash } from "@/lib/midnightPreprod";
import { EXPLOIT_PREVIEW, adaOf, exploitPayoutFor } from "@/lib/exploitPreview";

const steps = [
  {
    step: "1 · Seal",
    who: "Claimant, this page",
    body: "The bundle is serialized canonically, hashed, and committed with a fresh 32-byte salt: evidenceCommitment = SHA-256(tag ‖ digest ‖ salt). You keep the encrypted bundle and the key file.",
  },
  {
    step: "2 · fileClaim",
    who: "Holder, on Midnight",
    body: "The holder proves in zero knowledge that their policy key opens the record's holder commitment, and the ledger stores only the 32-byte evidence commitment. Status: ACTIVE → CLAIM_PENDING.",
  },
  {
    step: "3 · Verify off-ledger",
    who: "Assessor",
    body: "With the bundle and key file, the assessor checks four things: it decrypts, it's a canonical exploit bundle, it opens to its commitment, and that commitment is byte-for-byte the one on the ledger. Anything else is refused before a decision.",
  },
  {
    step: "4 · resolveClaim",
    who: "Assessor, on Midnight",
    body: "Only the assessor's role key passes the circuit. Approve → PAID, and the commitment stays on the record. Reject → back to ACTIVE with the commitment cleared, so a re-filing with a new salt can't be linked to it.",
  },
];

function Hash({ h, block }: { h: string; block: number }) {
  return (
    <span className="font-mono text-[11px] text-text" title={h}>
      {shortHash(h)} <span className="text-text-dim">· block {block.toLocaleString("en-US")}</span>
    </span>
  );
}

/** How a filed commitment gets resolved, plus the live claims drill on Midnight Preprod. */
export function ClaimLifecycle() {
  // Midnight claims drill rows, plus each exploit-pool policy whose claim was resolved on Midnight.
  const drill = [
    ...M.claimsDrill,
    ...EXPLOIT_PREVIEW.policies
      .filter((p) => p.midnight?.resolveClaim && p.midnight.fileClaim?.txHash)
      .filter((p) => !M.claimsDrill.some((d) => d.policyId === p.policyId))
      .map((p) => ({
        policyId: p.policyId,
        cardanoBuyTx: p.buyTx,
        cover: `Exploit cover · ${adaOf(p.coverage)}`,
        evidenceCommitment: p.midnight!.evidence,
        fileClaim: { txHash: p.midnight!.fileClaim!.txHash!, block: p.midnight!.fileClaim!.block ?? 0 },
        resolveClaim: p.midnight!.resolveClaim!,
      })),
  ];
  return (
    <section aria-labelledby="claim-lifecycle-title" className="glass-panel relative mt-10 overflow-hidden p-6 sm:p-8">
      <div
        className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,var(--midnight-soft),transparent)] blur-2xl"
        aria-hidden="true"
      />
      <div className="relative max-w-2xl">
        <p className="font-mono-label text-[10px] text-midnight">After you file</p>
        <h2 id="claim-lifecycle-title" className="mt-2 font-display text-2xl leading-tight text-text sm:text-[1.75rem]">
          How a filed commitment is <em className="text-midnight-grad">resolved.</em>
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">
          The registry can&apos;t read your evidence, so it can&apos;t judge it. It can make sure the assessor judges exactly what
          you filed, and that only the assessor can decide.
        </p>
      </div>

      <ol className="relative mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((s) => (
          <li key={s.step} className="rounded-2xl border border-[var(--hairline)] bg-white/[0.02] p-4">
            <p className="font-mono-label text-[9.5px] text-text-dim">{s.step}</p>
            <p className="mt-1 text-[11px] text-midnight">{s.who}</p>
            <p className="mt-1.5 text-xs leading-relaxed text-text-muted">{s.body}</p>
          </li>
        ))}
      </ol>

      <div className="relative mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-mono-label text-[10px] text-text-dim">Live claims drill · {M.network}</h3>
          <p className="text-[11px] text-text-dim">Test policies, demo evidence. No real incident, no real funds.</p>
        </div>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-[var(--hairline)] bg-white/[0.02]">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead>
              <tr className="font-mono-label text-[9.5px] text-text-dim">
                <th className="px-4 py-2.5 font-normal">Policy (Cardano Preview Buy)</th>
                <th className="px-4 py-2.5 font-normal">fileClaim</th>
                <th className="px-4 py-2.5 font-normal">resolveClaim</th>
                <th className="px-4 py-2.5 font-normal">Status now</th>
                <th className="px-4 py-2.5 font-normal">Cardano payout</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--hairline)]">
              {drill.map((d) => (
                <tr key={d.policyId}>
                  <td className="px-4 py-3 align-top">
                    <span className="font-mono text-[11px] text-text" title={d.policyId}>
                      {shortHash(d.policyId)}
                    </span>
                    <a
                      href={explorerTx(d.cardanoBuyTx)}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-0.5 block font-mono text-[10.5px] text-text-dim underline decoration-dotted underline-offset-4 hover:text-text"
                    >
                      Buy {shortHash(d.cardanoBuyTx)} ↗
                    </a>
                    <span className="mt-0.5 block text-[10.5px] text-text-dim">{d.cover}</span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <Hash h={d.fileClaim.txHash} block={d.fileClaim.block} />
                    <span className="mt-0.5 block font-mono text-[10px] text-text-dim" title={d.evidenceCommitment}>
                      evidence {shortHash(d.evidenceCommitment)}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <Hash h={d.resolveClaim.txHash} block={d.resolveClaim.block} />
                    <span className={`mt-0.5 block text-[11px] ${d.resolveClaim.approved ? "text-success" : "text-text-muted"}`}>
                      {d.resolveClaim.approved ? "Approved → PAID" : "Rejected → ACTIVE, evidence cleared"}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <MirroredOnMidnight policyId={d.policyId} />
                  </td>
                  <td className="px-4 py-3 align-top">
                    {(() => {
                      const paid = exploitPayoutFor(d.policyId);
                      if (paid)
                        return (
                          <>
                            <span className="text-[11px] text-success">Paid on Cardano Preview</span>
                            <a
                              href={explorerTx(paid.settleTx!)}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-0.5 block font-mono text-[10.5px] text-text-dim underline decoration-dotted underline-offset-4 hover:text-text"
                            >
                              Settle {shortHash(paid.settleTx!)} ↗
                            </a>
                            <span className="mt-0.5 block text-[10.5px] text-text-dim">{adaOf(paid.payout)}, assessor-signed</span>
                          </>
                        );
                      return (
                        <span className="text-[11px] text-text-dim">
                          {d.resolveClaim.approved ? "None: depeg pool (oracle-only settle)" : "None: rejected"}
                        </span>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-text-dim">
          Both bundles were sealed with this page&apos;s code (<span className="font-mono">packages/sdk/src/evidence.ts</span>) and
          checked by the assessor against the on-ledger commitment before each <span className="font-mono">resolveClaim</span>.
          &ldquo;Status now&rdquo; is decoded live from the registry&apos;s public state on the Preprod indexer.
        </p>
      </div>

      <div className="relative mt-5 rounded-2xl border border-success/25 bg-success/[0.05] p-4 text-xs leading-relaxed text-text-muted">
        <p>
          <span className="text-success">Payout wired for exploit cover.</span> The depeg pool still settles only on an oracle
          quorum (its parameters are fixed, no admin key), so approved claims on depeg policies stay unpaid on Cardano. Exploit
          policies live in a separate exploit-cover pool whose Settle needs the assessor&apos;s signature, so an approved
          Midnight claim there is paid in ADA or USDC on Cardano Preview.{" "}
          <a href="#exploit-payout-title" className="underline underline-offset-4 hover:text-text">
            See the payout
          </a>
          .
        </p>
      </div>

      <div className="relative mt-5 flex flex-wrap gap-2">
        <Button href={M.record} external variant="secondary" size="sm">
          Claims record <span aria-hidden="true">↗</span>
        </Button>
        <Button href="/app" variant="ghost" size="sm">
          Live contract activity
        </Button>
      </div>
    </section>
  );
}
