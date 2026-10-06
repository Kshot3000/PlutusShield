import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { EvidenceVault } from "@/components/claim/EvidenceVault";
import { ClaimLifecycle } from "@/components/claim/ClaimLifecycle";

export const metadata: Metadata = {
  title: "Exploit evidence vault",
  description:
    "Seal private evidence for a PlutusShield smart-contract exploit claim: encrypted in your browser with AES-256-GCM, committed with the exact formula the Midnight registry uses, and verifiable by an assessor.",
};

const notes = [
  {
    title: "Private by construction",
    body: "The bundle is encrypted before it exists anywhere but this tab. The Midnight ledger only ever sees a 32-byte commitment, salted so nobody can confirm a guess about its contents.",
  },
  {
    title: "Binding for the claimant",
    body: "Once a commitment is filed, the claimant can't swap the evidence. Any change to the bundle, even one character, produces a different commitment and fails the assessor's check.",
  },
  {
    title: "Disclosed only to the assessor",
    body: "You choose who gets the key file. Today that's an off-ledger handoff to the assessor. The registry keeps the commitment on an approved claim and clears it on a rejected one.",
  },
];

export default function EvidencePage() {
  return (
    <AppShell
      active="claim"
      title="Evidence vault"
      description="Exploit cover can't settle on an oracle, so claims are assessed. Seal your evidence here: it's encrypted on this device, and only a commitment is meant for the Midnight ledger."
    >
      <p className="-mt-2 mb-6 text-[13px] text-text-dim">
        <Link href="/claim" className="text-text-muted underline underline-offset-4 hover:text-text">
          ← Depeg claim checker
        </Link>
      </p>
      <EvidenceVault />
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {notes.map((n) => (
          <div key={n.title} className="glass-panel relative rounded-[1.4rem] p-6">
            <p className="text-sm font-semibold text-text">{n.title}</p>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">{n.body}</p>
          </div>
        ))}
      </div>
      <ClaimLifecycle />
      <p className="mt-6 text-xs leading-relaxed text-text-dim">
        The registry (<code className="font-mono">policy-cover.compact</code>) is live on Midnight Preprod, and the claims
        drill above ran <code className="font-mono">fileClaim</code> and <code className="font-mono">resolveClaim</code> there
        from the operator relay. Filing straight from this page (a browser Midnight wallet and proof) is next; today the page
        seals the bundle and shows the exact <code className="font-mono">fileClaim</code> arguments. Exploit cover can&apos;t be
        bought on Cardano yet, and approved claims aren&apos;t paid out on Cardano yet. Read the{" "}
        <Link href="/docs/privacy#evidence-vault" className="text-text-muted underline underline-offset-4 hover:text-text">
          vault&apos;s trust model
        </Link>{" "}
        and the{" "}
        <Link href="/docs/settlement#assessed" className="text-text-muted underline underline-offset-4 hover:text-text">
          assessed claim flow
        </Link>
        .
      </p>
    </AppShell>
  );
}
