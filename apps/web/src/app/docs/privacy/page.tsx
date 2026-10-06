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
        { id: "policy-key", label: "From a Cardano Buy to Midnight" },
        { id: "authorization", label: "Authorization without public keys" },
        { id: "prove-cover", label: "proveCover: the partner hook" },
        { id: "rotation", label: "Holder rotation" },
        { id: "evidence", label: "Evidence commitments" },
        { id: "evidence-vault", label: "The evidence vault" },
        { id: "public", label: "What stays public" },
        { id: "limits", label: "Current limits" },
      ]}
      sourcePaths={["contracts/midnight/src/policy-cover.compact", "contracts/midnight/test/policy-cover.test.mjs", "contracts/midnight/README.md", "packages/sdk/src/midnight.ts", "packages/sdk/src/evidence.ts"]}
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

      <Section id="policy-key" title="From a Cardano Buy to Midnight">
        <P>
          When you buy on <C>/cover</C>, your browser makes a <Strong>policy key</Strong> before the wallet
          prompt: a random 32-byte holder secret and a random coverage salt. Only one 32-byte value from it goes
          on Cardano, in the policy datum&apos;s <C>midnight_commitment</C>:
        </P>
        <Formula label="packages/sdk/src/midnight.ts = policy-cover.compact">{`holder       = roleCommitment(holderSecret, holderTag())
             = SHA-256(pad32("plutusshield:role:") ‖ pad32("holder") ‖ holderSecret)
coverage     = coverageCommitment(amount, salt)
             = SHA-256(salt ‖ u64le(amount))                  // persistentCommit<Uint<64>>
registration = registrationCommitment(policyId, holder, coverage)
             = SHA-256(pad32("plutusshield:register:v1") ‖ policyId ‖ holder ‖ coverage)

Cardano PolicyDatum.midnight_commitment = registration`}</Formula>
        <P>
          <C>registerPolicy(policyId, holder, coverage, expiry, cardanoCommitment)</C> takes that datum field
          and refuses any holder or coverage commitment that doesn&apos;t reproduce it. The issuer can delay a
          registration, but it can&apos;t register a different key or amount than the one the buyer committed
          to. Because the stored record is public, anyone can recompute the binding against the Cardano datum.
        </P>
        <P>
          The policy key is the private proof of ownership on Midnight: <C>proveCover</C>,{" "}
          <C>fileClaim</C>, and <C>rotateHolder</C> all check the holder secret through the{" "}
          <C>localSecretKey</C> witness. It&apos;s saved in your browser (localStorage, keyed by policy id)
          before you sign, and you can download it as plain JSON or as a passphrase-encrypted backup
          (PBKDF2-SHA-256, 600,000 iterations, then AES-256-GCM). <C>My policies</C> shows whether each
          policy&apos;s key is on this device and whether it re-derives the on-chain commitment. You can also restore a key from a backup there.
        </P>
        <P>
          The SDK formulas are checked against the compiled contract&apos;s pure circuits on random inputs. A
          policy registered from an SDK-made key proves cover with that key. A wrong secret, a wrong salt, a
          swapped holder, an inflated amount, or another policy&apos;s id is rejected (
          <C>contracts/midnight/test/policy-cover.test.mjs</C>).
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
          commitment before accepting. Eight simulation tests cover rotation, part of the registry&apos;s 26.
        </P>
      </Section>

      <Section id="evidence" title="Evidence commitments">
        <P>
          <C>fileClaim</C> records only a non-zero commitment to the evidence bundle. The evidence itself stays
          with the claimant and is shared with assessors off-ledger. A rejected claim clears the commitment. An
          approved claim keeps it on the <C>PAID</C> record. See{" "}
          <DocLink href="/docs/settlement#assessed">Assessed claims</DocLink>.
        </P>
        <P>
          The contract publishes the commitment scheme as a pure circuit, so claimants, assessors, and the SDK all
          compute the same 32 bytes:
        </P>
        <Formula label="policy-cover.compact · packages/sdk/src/evidence.ts">{`evidenceTag() = pad(32, "plutusshield:evidence:v1")

evidenceCommitment(digest, salt) =
  persistentHash<Vector<3, Bytes<32>>>([ evidenceTag(), digest, salt ])
  = SHA-256(tag ‖ digest ‖ salt)

digest = SHA-256(canonical JSON of the bundle)
salt   = 32 random bytes, kept in the claimant's key file`}</Formula>
        <P>
          <C>fileClaim</C> can&apos;t check the opening: the bundle never enters a circuit. The assessor checks it
          off-ledger, before calling <C>resolveClaim</C>.
        </P>
      </Section>

      <Section id="evidence-vault" title="The evidence vault">
        <P>
          The <DocLink href="/claim/evidence">evidence vault</DocLink> is the client side of an exploit claim. It
          runs entirely in the browser on WebCrypto; the same code (<C>sealEvidence</C>, <C>verifyEvidence</C>)
          runs in Node for tooling.
        </P>
        <Steps
          items={[
            {
              title: "Canonical bundle",
              body: (
                <>
                  Policy id, protocol and affected contracts, incident type and description, start and detection
                  times (UTC), exploit transaction ids, the loss amount and asset, and the name, size, and SHA-256 of
                  each supporting file. Serialized as JSON with sorted keys and no whitespace (RFC 8785 ordering), so
                  the same evidence always gives the same bytes.
                </>
              ),
            },
            {
              title: "Commit",
              body: <>Digest the bytes and commit with a fresh random salt, as above. The salt makes the commitment hiding: nobody can confirm a guessed bundle from the ledger, and re-filing the same evidence produces an unlinkable commitment.</>,
            },
            {
              title: "Encrypt",
              body: <>AES-256-GCM under a fresh random 256-bit key and 96-bit nonce. The file header (schema, policy id, commitment) is bound as additional data, so editing it breaks decryption. The claimant downloads two files: the encrypted bundle, which is safe to store anywhere, and the key file (AES key + salt).</>,
            },
            {
              title: "File and disclose",
              body: <>The holder submits <C>fileClaim(policyId, commitment)</C> and sends both files to the assessor privately.</>,
              chain: "Midnight",
            },
            {
              title: "Assess",
              body: <>The assessor decrypts, checks the plaintext is the canonical encoding of a valid bundle, recomputes the commitment, compares it with <C>PolicyRecord.evidence</C>, and matches supporting files by hash. Then they judge the claim and call <C>resolveClaim</C>.</>,
              chain: "Midnight",
            },
          ]}
        />
        <Table
          caption="Trust model"
          head={["Party", "Learns", "Can't do"]}
          rows={[
            ["Midnight ledger / public", "That a claim was filed on a policy id, and a 32-byte commitment", "Read or confirm the evidence"],
            ["Anyone holding only the encrypted bundle", "Policy id and commitment (in the header)", "Decrypt it, or alter it without detection"],
            ["Assessor (given the key file)", "The full bundle, and whether it is exactly what was filed", "Claim the holder filed different evidence"],
            ["Claimant after filing", "Everything", "Swap in different evidence: any change fails the commitment check"],
          ]}
        />
        <P>
          Tests: 13 SDK tests (round trip, tamper detection on ciphertext, nonce, header, and salt, wrong and
          mismatched keys, non-canonical plaintext, commitment determinism, attachment matching), plus 3 Midnight
          simulation tests that check the SDK against the compiled <C>evidenceCommitment</C> circuit on random inputs
          and run file → verify → resolve with SDK-sealed bundles.
        </P>
        <Callout tone="warn" title="Limits of the vault today">
          <p>
            <Strong>Filing isn&apos;t live.</Strong> The registry is not deployed to any Midnight network, so the
            page shows the <C>fileClaim</C> call but can&apos;t submit it.
          </p>
          <p>
            <Strong>Disclosure is all or nothing.</Strong> The key file opens the whole bundle. There is no
            field-level selective disclosure or in-circuit proof about the evidence yet.
          </p>
          <p>
            <Strong>The key file is the only copy.</Strong> Nothing is stored server-side. Lose it and the bundle
            can&apos;t be opened; leak it and its holder can read everything.
          </p>
          <p>
            <Strong>Integrity, not truth.</Strong> Verification proves the assessor has the evidence that was filed.
            Whether the exploit happened and the loss is real is still the assessor&apos;s judgment, against the chain
            data the transaction ids point to.
          </p>
        </Callout>
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
            <C>expirePolicy</C> are issuer-only. <C>registerPolicy</C> can&apos;t substitute a holder or amount
            the Cardano datum didn&apos;t commit to, but the issuer decides when (and whether) to register, and
            when to expire. There is no trustless bridge. On Cardano, by contrast, <C>Expire</C> is time-locked
            and callable by anyone.
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
