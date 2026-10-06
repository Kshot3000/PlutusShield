import type { Metadata } from "next";
import { DocsLayout } from "@/components/docs/DocsLayout";
import { C, Callout, DocLink, Formula, List, P, Section, Steps, Strong, Table } from "@/components/docs/Prose";

export const metadata: Metadata = {
  title: "Settlement & claims",
  description:
    "How PlutusShield claims settle: oracle-quorum parametric depeg settlement on Cardano, claim windows, double-claim protection, and the assessed claim flow on Midnight.",
};

export default function SettlementPage() {
  return (
    <DocsLayout
      slug="settlement"
      title="Settlement & claims"
      description="Parametric cover pays when a quorum of authenticated oracle feeds attests the trigger. There is no claims form and no committee. Assessed claims go through Midnight."
      toc={[
        { id: "parametric", label: "Parametric settlement" },
        { id: "oracle-auth", label: "Authenticating feeds" },
        { id: "trigger", label: "What counts as a trigger" },
        { id: "settle-rules", label: "Settle transaction rules" },
        { id: "tested", label: "Attack cases tested" },
        { id: "assessed", label: "Assessed claims (Midnight)" },
      ]}
      sourcePaths={[
        "contracts/cardano/lib/plutusshield/oracle.ak",
        "contracts/cardano/validators/cover.ak",
        "contracts/midnight/src/policy-cover.compact",
      ]}
    >
      <Section id="parametric" title="Parametric settlement">
        <P>
          A depeg policy settles in one Cardano transaction. The holder references oracle feed UTxOs, burns
          their policy tokens, and takes exactly <C>coverage</C> from the policy&apos;s own currency tranche, paid
          in the policy&apos;s asset (ADA or USDC). The validator checks everything.
          Nobody approves the claim.
        </P>
        <Formula label="Trigger (types.ak) and the default depeg trigger (sdk depegTrigger)">{`Trigger { covered_asset, threshold_bps, window_ms }

depeg:  threshold_bps = 9_500        -- price below 0.95 of peg
        window_ms     = 86_400_000   -- over a window of at least 24h`}</Formula>
      </Section>

      <Section id="oracle-auth" title="Authenticating feeds">
        <P>
          Oracle data is read from <Strong>reference inputs</Strong>, so feeds aren&apos;t spent and can serve
          many claims. A reference input counts as a feed only if:
        </P>
        <List>
          <li>
            It holds exactly one token under <C>params.oracle.policy_id</C>, with quantity 1.
          </li>
          <li>
            That token&apos;s name is on the allowlist <C>params.oracle.feeds</C>.
          </li>
          <li>
            Its inline datum decodes as <C>OracleDatum</C>. Anything else is ignored, never trusted.
          </li>
        </List>
        <Formula label="OracleDatum (types.ak)">{`OracleDatum {
  covered_asset: ByteArray   -- e.g. "USDM"
  price_bps:     Int         -- time-weighted price over the window vs peg, 10_000 = 1.00
  window_start:  Int         -- POSIX ms
  window_end:    Int
}`}</Formula>
        <P>
          Each feed name is counted <Strong>at most once</Strong>, so the same feed referenced twice can&apos;t
          make a quorum. Settlement needs <C>quorum ≥ 1</C> and at least <C>quorum</C> distinct agreeing feeds.
          The validator tests use a 2-of-3 allowlist. Production values will be set at deployment.
        </P>
      </Section>

      <Section id="trigger" title="What counts as a trigger">
        <P>A feed&apos;s datum agrees with the policy when all of these hold:</P>
        <Formula label="attests (oracle.ak)">{`datum.covered_asset == trigger.covered_asset
datum.price_bps      <  trigger.threshold_bps
datum.window_end − datum.window_start ≥ trigger.window_ms
datum.window_start   ≥ policy.start
datum.window_end     ≤ policy.expiry`}</Formula>
        <P>
          In plain terms, the feed reports a time-weighted price below the threshold over a window at least as
          long as required, and that window lies entirely inside the cover period. A depeg that began before the
          policy started, or ended after it expired, doesn&apos;t count. Each feed attests its own window. The
          validator does not require the feeds&apos; windows to be identical.
        </P>
      </Section>

      <Section id="settle-rules" title="Settle transaction rules">
        <Steps
          items={[
            {
              title: "Burn both policy tokens",
              body: (
                <>
                  The transaction burns exactly the reference token and the user token for this policy. Burning
                  the user token means the claimant must hold it. On Cardano, the claim right is a bearer asset.
                </>
              ),
            },
            {
              title: "Spend the policy UTxO",
              body: (
                <>
                  Exactly one input carries the reference token and its <C>PolicyDatum</C>. That UTxO is
                  spendable only because its reference token is burned.
                </>
              ),
            },
            {
              title: "Claim before the grace deadline",
              body: (
                <>
                  The validity upper bound must be <C>≤ expiry + claim_grace_ms</C>. The grace period lets a holder
                  claim for a trigger window that ended on or just before expiry. The tests use 3 days.
                </>
              ),
            },
            {
              title: "Oracle quorum attests",
              body: <>The quorum and trigger rules above hold against the transaction&apos;s reference inputs.</>,
            },
            {
              title: "Pay exactly coverage, once",
              body: (
                <>
                  In the policy&apos;s tranche, <C>capital_out = capital − coverage</C> and <C>active_cover</C> drops by
                  the same amount. Every other tranche is untouched. Once the reference token is burned, the policy
                  no longer exists, so it can&apos;t be claimed twice.
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section id="tested" title="Attack cases tested">
        <P>The Aiken test suite (72 checks) includes these settlement cases:</P>
        <Table
          caption="Settlement test coverage"
          head={["Case", "Expected"]}
          rows={[
            ["Quorum of 2 allowlisted feeds, depeg to 0.91 for 26h", "Pays"],
            ["Claim within grace after expiry", "Pays"],
            ["Claim after grace", "Rejected"],
            ["Depeg window starts after expiry, or before start", "Rejected"],
            ["Look-alike feed token from another policy", "Rejected"],
            ["Feed name not on the allowlist", "Rejected"],
            ["Single feed below quorum, or the same feed twice", "Rejected"],
            ["Price 0.96, above the 0.95 threshold", "Rejected"],
            ["Below peg for 12h of the required 24h", "Rejected"],
            ["Pool pays out more than coverage", "Rejected"],
            ["Burn only the user token to keep the policy alive", "Rejected"],
            ["Replay a claim after the policy UTxO is gone", "Rejected"],
            ["USDC policy settles from the USDC tranche", "Pays"],
            ["USDC policy paid out of the ADA tranche", "Rejected"],
          ]}
        />
      </Section>

      <Section id="assessed" title="Assessed claims (Midnight)">
        <P>
          Exploit cover can&apos;t be fully parametric, so its claims go through the private registry on
          Midnight. Only a <Strong>commitment</Strong> to the evidence bundle (exploit writeups, transaction
          dumps) goes on the ledger.
        </P>
        <Table
          caption="Midnight claim circuits"
          head={["Circuit", "Caller", "Rule"]}
          rows={[
            [<C key="a">fileClaim(id, evidenceCommitment)</C>, "Holder", "Policy must be ACTIVE. Evidence commitment non-zero. → CLAIM_PENDING"],
            [<C key="b">resolveClaim(id, true)</C>, "Assessor", "CLAIM_PENDING → PAID. claimsPaid +1, activePolicies −1"],
            [<C key="c">resolveClaim(id, false)</C>, "Assessor", "CLAIM_PENDING → ACTIVE. Evidence commitment cleared"],
          ]}
        />
        <P>
          While a claim is pending, the policy can&apos;t prove cover, be rotated to a new holder, or be expired.
          The assessor is a single role commitment fixed at deployment. Holder authorization works as described
          in <DocLink href="/docs/privacy">Privacy</DocLink>.
        </P>
        <Callout tone="planned">
          <p>
            Paying an approved Midnight claim from the Cardano pool isn&apos;t wired yet. The Cardano validator
            currently settles only parametric triggers. A governance-rotatable assessor (or committee) and the
            oracle relay service that publishes feed datums are also planned, not built.
          </p>
        </Callout>
      </Section>
    </DocsLayout>
  );
}
