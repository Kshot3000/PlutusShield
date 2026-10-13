import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ClaimsRegister } from "@/components/claims/ClaimsRegister";
import { Badge } from "@/components/ui/Badge";
import { CLAIMS_REGISTER } from "@/lib/claimsRegister";
import { adaOf } from "@/lib/exploitPreview";

const s = CLAIMS_REGISTER.stats;

export const metadata: Metadata = {
  title: "Claims register",
  description: `Every claim PlutusShield has decided on Cardano Preview and Midnight Preprod: ${s.decided} decided, ${s.denied} denied, ${adaOf(s.paidLovelace)} paid, with each fileClaim, committee vote and Settle linked to its transaction. Testnet only, not audited.`,
  openGraph: {
    title: "Claims register · PlutusShield",
    description: `${s.decided} claims decided, ${adaOf(s.paidLovelace)} paid on Cardano Preview, every step linked on-chain.`,
    url: "https://kshot3000.github.io/PlutusShield/claims/",
    type: "website",
  },
};

export default function ClaimsRegisterPage() {
  return (
    <AppShell
      active="claim"
      title="Claims register"
      description="Every claim PlutusShield has decided, approved or denied, with the Midnight filing, the committee's votes and the Cardano payout each linked to its transaction. Built from the public deployment records, so nothing here is curated by hand."
    >
      <ClaimsRegister />

      <section className="card-surface mt-6 p-6 sm:p-8" aria-labelledby="register-reading">
        <div className="flex flex-wrap gap-2">
          <Badge variant="gold">How to read this</Badge>
          <Badge>Testnet drills</Badge>
          <Badge>Not audited</Badge>
        </div>
        <h2 id="register-reading" className="mt-4 font-display text-[1.6rem] leading-tight text-text">
          What a row proves, and what it doesn&apos;t
        </h2>
        <div className="mt-4 grid gap-4 text-sm leading-relaxed text-text-muted md:grid-cols-3">
          <p>
            A row is a policy whose claim reached a decision. Midnight steps show only the claim&apos;s evidence commitment and the
            votes; the evidence itself stays with the holder and the assessors. Cardano steps are ordinary Preview transactions.
          </p>
          <p>
            Every claim here is a testnet drill on a test policy. No real exploit or loss is behind any of them. They exist to show the
            whole path works, including a denial, a split committee vote, and a payout the validator refused.
          </p>
          <p>
            The register is rebuilt from the deployment records on every site build. To check a claim yourself, open its transactions,
            or read the{" "}
            <Link href="/docs/settlement" className="text-text underline underline-offset-4 hover:text-cardano">
              settlement rules
            </Link>{" "}
            and the{" "}
            <Link href="/assessors" className="text-text underline underline-offset-4 hover:text-cardano">
              assessor committee
            </Link>
            .
          </p>
        </div>
        <div className="mt-6 flex flex-wrap gap-4 text-sm">
          <Link href="/claim/evidence" className="font-medium text-midnight underline-offset-4 hover:underline">
            File an exploit claim <span aria-hidden="true">&nbsp;→</span>
          </Link>
          <Link href="/claim" className="font-medium text-cardano underline-offset-4 hover:underline">
            Check a depeg claim <span aria-hidden="true">&nbsp;→</span>
          </Link>
        </div>
      </section>
    </AppShell>
  );
}
