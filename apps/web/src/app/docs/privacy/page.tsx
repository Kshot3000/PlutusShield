import type { Metadata } from "next";
import { DocsLayout } from "@/components/docs/DocsLayout";
import { C, Callout, DocLink, Formula, List, P, Section, Steps, Strong, Table } from "@/components/docs/Prose";

export const metadata: Metadata = {
  title: "Privacy on Midnight",
  description:
    "PlutusShield's private policy registry on Midnight: holder and coverage commitments, the proveCover partner hook, evidence commitments, and private holder rotation.",
};

export default function PrivacyPage() {
  return (
    <DocsLayout
      slug="privacy"
      title="Privacy on Midnight"
      description="Each Cardano policy has a private twin on Midnight. It stores commitments, never keys or amounts, so a holder can prove facts about their cover without revealing them."
      toc={[
        { id: "record", label: "The private record" },
        { id: "commitments", label: "Commitments" },
        { id: "authorization", label: "Authorization without public keys" },
        { id: "prove-cover", label: "proveCover: the partner hook" },
        { id: "rotation", label: "Holder rotation" },
        { id: "evidence", label: "Evidence commitments" },
        { id: "public", label: "What stays public" },
        { id: "limits", label: "Current limits" },
      ]}
      sourcePaths={["contracts/midnight/src/policy-cover.compact", "contracts/midnight/test/policy-cover.test.mjs", "contracts/midnight/README.md"]}
    >
      <Section id="record" title="The private record">
        <P>
          <C>policy-cover.compact</C> keeps a <C>Map&lt;Bytes&lt;32&gt;, PolicyRecord&gt;</C> keyed by the same
          32-byte policy id the Cardano validator derives. The issuer mirrors each policy with{" "}
          <C>registerPolicy</C> after the Cardano mint confirms. The buyer produces both commitments in their
          own client.
        </P>
        <Table
          caption="PolicyRecord fields"
          head={["Field", "Stored", "Why"]}
          rows={[
            ["holder", "Role commitment of the holder's secret key", "Ownership without a public key on the ledger"],
            ["coverage", "persistentCommit(amount, salt)", "Coverage size hidden inside the commitment"],
            ["expiry", "Uint<64>", "Public term end"],
            ["status", "NONE · ACTIVE · CLAIM_PENDING · PAID · EXPIRED", "Public lifecycle"],
            ["evidence", "Commitment to the claim evidence bundle", "Evidence stays off-ledger"],
          ]}
        />
      </Section>

      <Section id="commitments" title="Commitments">
        <Formula label="policy-cover.compact">{`roleCommitment(sk, tag) =
  persistentHash<Vector<3, Bytes<32>>>([ pad(32, "plutusshield:role:"), tag, sk ])

tags: pad(32, "issuer") · pad(32, "holder") · pad(32, "assessor")

coverageCommitment(amount, salt) = persistentCommit<Uint<64>>(amount, salt)`}</Formula>
        <P>
          The secret key and the coverage opening <C>(amount, salt)</C> are <Strong>witnesses</Strong>. The
          caller&apos;s local wallet supplies them when it builds a proof (<C>localSecretKey()</C>,{" "}
          <C>coverageAmount(id)</C>, <C>coverageSalt(id)</C>), and they never touch the ledger. Separate role
          tags mean the same key produces unrelated commitments for different roles.
        </P>
      </Section>

      <Section id="authorization" title="Authorization without public keys">
        <P>
          The contract never calls <C>ownPublicKey()</C>. To act as the holder, a caller recomputes{" "}
          <C>roleCommitment(localSecretKey(), holderTag())</C> inside the circuit and must match the stored{" "}
          <C>holder</C>. The only value disclosed is that commitment, which is already on the ledger. The issuer
          and assessor roles work the same way: the issuer commitment is derived from the deployer&apos;s key in
          the constructor, and the assessor commitment is passed in at deployment.
        </P>
      </Section>

      <Section id="prove-cover" title="proveCover: the partner hook">
        <Formula label="proveCover(policyId, minCoverage)">{`policy exists and status == ACTIVE
caller's roleCommitment(sk, "holder") == record.holder
coverageCommitment(amount, salt)      == record.coverage
amount ≥ minCoverage
→ coverProofs += 1`}</Formula>
        <P>
          A successful proof shows that the caller holds an active policy with at least <C>minCoverage</C>. It
          doesn&apos;t reveal the exact amount or the caller&apos;s key. A forged opening fails the commitment
          check. A threshold above the committed amount fails the comparison. The test suite covers both.
        </P>
        <P>
          This is the integration point for partners. A DEX or lending market can offer &quot;insured-only&quot;
          pools or better terms to users who prove cover, and learn nothing else from the proof.
        </P>
      </Section>

      <Section id="rotation" title="Holder rotation">
        <P>
          <C>rotateHolder(policyId, newHolderCommitment)</C> lets the current holder move an active policy to a
          new key. Use it after losing a device, to migrate wallets, or to transfer cover privately. Neither the
          old key nor the new key is revealed.
        </P>
        <Steps
          items={[
            { title: "Only the current holder", body: <>Same witness check as <C>proveCover</C> and <C>fileClaim</C>. Strangers and the issuer are rejected.</> },
            { title: "Only while ACTIVE", body: <>Policies that are <C>CLAIM_PENDING</C>, <C>PAID</C>, or <C>EXPIRED</C> stay with the holder of record. Nobody can re-key a policy mid-claim.</> },
            { title: "A real change", body: <>The new commitment must be non-zero and different from the current one.</> },
            { title: "Only the holder changes", body: <>Coverage, expiry, and evidence are untouched. The public <C>holderRotations</C> counter goes up.</> },
            { title: "Immediate effect", body: <>The old key fails <C>proveCover</C>, <C>fileClaim</C>, and <C>rotateHolder</C> from then on. The new key passes them and can rotate again.</> },
          ]}
        />
        <P>
          To transfer cover, the current holder also gives the new holder the coverage opening{" "}
          <C>(amount, salt)</C> off-ledger. The new holder can check it against the public <C>coverage</C>{" "}
          commitment before accepting. Eight simulation tests cover rotation, part of the registry&apos;s 18.
        </P>
      </Section>

      <Section id="evidence" title="Evidence commitments">
        <P>
          <C>fileClaim</C> records only a non-zero commitment to the evidence bundle. The evidence itself stays
          with the claimant and is shared with assessors off-ledger. A rejected claim clears the commitment. An
          approved claim keeps it on the <C>PAID</C> record. See{" "}
          <DocLink href="/docs/settlement#assessed">Assessed claims</DocLink>.
        </P>
      </Section>

      <Section id="public" title="What stays public">
        <List>
          <li>Policy ids, statuses, expiries, and the stored commitments.</li>
          <li>
            The counters <C>activePolicies</C>, <C>claimsFiled</C>, <C>claimsPaid</C>, <C>coverProofs</C>, and{" "}
            <C>holderRotations</C>.
          </li>
          <li>The fact that a given policy was proven, claimed, or rotated, though not by whom.</li>
        </List>
      </Section>

      <Section id="limits" title="Current limits">
        <Callout tone="warn" title="Read before relying on privacy">
          <p>
            <Strong>Coverage is public on Cardano.</Strong> The Cardano <C>PolicyDatum</C> stores{" "}
            <C>coverage</C> and <C>premium</C> in plaintext because the validator must pay exactly that amount.
            The Midnight record uses the same policy id. Anyone who links the two can read the amount.
          </p>
          <p>
            <Strong>The Cardano claim right is a visible token.</Strong> The policy user token sits in an
            ordinary wallet. Rotating the Midnight holder doesn&apos;t move it. A full transfer also moves that
            token.
          </p>
          <p>
            <Strong>The issuer relays between chains.</Strong> <C>registerPolicy</C> and{" "}
            <C>expirePolicy</C> are issuer-only, so Midnight mirrors Cardano only as faithfully as the issuer
            relays it. There is no trustless bridge. On Cardano, by contrast, <C>Expire</C> is time-locked and
            callable by anyone.
          </p>
        </Callout>
        <Callout tone="planned">
          <p>
            Hiding amounts on Cardano too (for example, keying the Midnight registry by a blinded id or settling
            against a commitment), governance rotation of the issuer and assessor roles, and a Midnight testnet
            deployment are open work. None of them is shipped.
          </p>
        </Callout>
      </Section>
    </DocsLayout>
  );
}
