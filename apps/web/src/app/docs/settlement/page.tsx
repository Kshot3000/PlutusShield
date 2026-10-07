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
        <P>
          Try it in the <DocLink href="/claim">claim checker</DocLink>. It runs the SDK&apos;s exact mirror of these
          rules (<C>settlementCheck</C>) against example prices, so you can see which window pays, when the claim
          window closes, and what happens when feeds go offline.
        </P>
        <P>
          On Preview, live policies carry their action in <DocLink href="/cover#my-policies">My policies</DocLink>. Once
          the quorum attests a depeg inside a policy&apos;s cover period, the wallet holding its claim token gets a{" "}
          <Strong>Claim</Strong> button that signs the <C>Settle</C> directly; the coverage lands in that wallet in the
          same transaction. After expiry plus the grace period, any wallet can <Strong>Release</Strong> an unclaimed
          policy (<C>Expire</C>), and its deposit goes back to the buyer. Both use one shared builder (
          <C>lib/tx/claim.ts</C>) that the emulator test run and <C>pnpm web-claim</C> also submit.
        </P>
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

      <Section id="sale-guard" title="The same feeds gate sales">
        <P>
          A parametric pool is only fair if nobody can buy cover after the event has started. Every{" "}
          <C>Buy</C> runs a circuit-breaker against the same allowlisted feeds, with a waiting period on top:
        </P>
        <Formula label="attests_peg (oracle.ak) and validate_buy (cover.ak)">{`datum.covered_asset == trigger.covered_asset
datum.price_bps      ≥ trigger.threshold_bps            -- healthy peg
datum.window_end     ≥ tx_upper_bound − max_price_age_ms  -- fresh
-- for EVERY allowlisted feed (not a quorum), and
policy.start         ≥ tx_upper_bound + waiting_period_ms`}</Formula>
        <P>
          Settlement needs a quorum, but sales need every feed. The buyer chooses which feed UTxOs to attach,
          so with a 2-of-3 rule they could leave out the one feed that already shows a depeg. If any feed is
          depegged, stale, or missing, no cover can be sold. A depeg that begins during the waiting period is never covered, because a trigger window must
          start at or after <C>policy.start</C>. Defaults: 24h waiting period, readings at most 2h old. Preview
          uses 60 min and 2h so test drills stay quick.
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
        <P>The Aiken test suite (131 checks) includes these settlement and sale cases:</P>
        <Table
          caption="Settlement and sale test coverage"
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
            ["Buy while feeds show 0.91, or 1 of 3 feeds depegged", "Sale refused"],
            ["Buy attaching only the 2 healthy feeds, omitting the depegged one", "Sale refused"],
            ["Buy with peg readings older than the max age, or none at all", "Sale refused"],
            ["Buy landing inside the waiting period", "Sale refused"],
            ["Expire that keeps the buyer's deposit, or refunds 1 lovelace short", "Rejected"],
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
            [<C key="b">voteClaim(id, true)</C>, "Committee member", "One vote per member per claim round. 2-of-3 approvals → PAID. claimsPaid +1, activePolicies −1"],
            [<C key="c">voteClaim(id, false)</C>, "Committee member", "2-of-3 rejections → CLAIM_PENDING returns to ACTIVE. Evidence commitment cleared"],
          ]}
        />
        <P>
          While a claim is pending, the policy can&apos;t prove cover, be rotated to a new holder, or be expired.
          On Midnight the decision sits with a committee too: the v2 registry&apos;s three assessor role
          commitments, fixed at deployment, each voting once per claim round (the v1 registry&apos;s single
          assessor key is kept as history). The Cardano payout below needs its own 2-of-3 assessor committee
          on top of that. Holder authorization works as described
          in <DocLink href="/docs/privacy">Privacy</DocLink>.
        </P>
        <P>
          Claimants build the commitment with the <DocLink href="/claim/evidence">evidence vault</DocLink>, which
          encrypts the bundle in the browser and computes the contract&apos;s <C>evidenceCommitment</C>. The
          committee member opens the bundle with the claimant&apos;s key file and checks it against the record
          before voting with <C>voteClaim</C>. Details in{" "}
          <DocLink href="/docs/privacy#evidence-vault">the vault&apos;s trust model</DocLink>.
        </P>
        <P>
          This runs on Midnight Preprod today. The v1 drill filed demo evidence on two mirrored test policies;
          the assessor verified each bundle against its on-ledger commitment, then approved one (PAID) and
          rejected the other (back to ACTIVE, commitment cleared). On the v2 committee registry, the first live
          decision was a split vote — seat 0 approve, seat 1 reject (still CLAIM_PENDING under 2-of-3), seat 2
          approve → PAID. Tx hashes are on the{" "}
          <DocLink href="/claim/evidence">evidence vault page</DocLink> and in the public deployment record.
        </P>
        <P>
          <Strong>Payout on Cardano.</Strong> Exploit cover has its own pool and validator,{" "}
          <C>validators/exploit_cover.ak</C>, parameterised with the same <C>CoverParams</C> plus an assessor{" "}
          <C>Committee</C>: a list of assessor key hashes and a threshold (2-of-3 on Preview). InitPool refuses a
          malformed committee: empty, a hash that isn&apos;t 28 bytes, a duplicate key, or a threshold outside
          1..=size. Its <C>Settle</C> has no oracle path: it requires signatures from at least <C>threshold</C>{" "}
          distinct committee members, a validity range inside [policy start, expiry + grace], both policy tokens
          burned, exactly the coverage paid from the policy&apos;s tranche, and active cover released. <C>Buy</C>{" "}
          keeps the pricing, capacity, and waiting period, without the peg circuit-breaker (there is no peg). The
          depeg validator is untouched, so the live depeg pool keeps its script hash.
        </P>
        <Table
          caption="Exploit Settle (exploit_cover.ak, 2-of-3 committee)"
          head={["Attempt", "Result"]}
          rows={[
            ["Any 2 of the 3 assessors sign, inside the claim window, pays exactly the coverage", "Paid"],
            ["2 assessors plus extra non-committee signers (holder, others)", "Paid: outsiders are ignored"],
            ["Only 1 of the 3 assessors signs, alone or padded with outsiders", "Rejected"],
            ["The same assessor listed twice", "Rejected: counted once"],
            ["Signed only by keys outside the committee", "Rejected"],
            ["Pays one lovelace more or less than the coverage", "Rejected"],
            ["After expiry + grace, or before cover starts", "Rejected"],
            ["Keeps active cover, or keeps the user token", "Rejected"],
          ]}
        />
        <Callout tone="planned">
          <p>
            Trust model: Cardano can&apos;t read Midnight state, so the committee&apos;s signatures are the bridge.
            Each assessor signs only after checking that the Midnight registry shows the claim resolved APPROVED
            (PAID), and the Settle carries the Midnight claim id, evidence commitment, and the Midnight decision
            tx as metadata (label 7732), covered by the signed tx body. No single key can release capital: a payout needs 2
            of the 3 committee keys, and one lost or compromised key can be outvoted without stopping payouts. It
            runs on Cardano Preview: the v2 pool paid a claim on 2-of-3 signatures, and a 1-of-3 Settle was rejected
            by both the local evaluator and the Preview provider&apos;s (links on the{" "}
            <DocLink href="/claim/evidence">evidence vault page</DocLink>). The first exploit pool (v1, one assessor
            key) is kept as history. Still open: the three Preview keys are run by the PlutusShield team, not yet
            independent operators; the v1 registry&apos;s single assessor key is history — the live v2 registry
            decides by the same 2-of-3 <C>voteClaim</C> committee (and no Midnight decision can move Cardano
            capital alone); and committee rotation means a new pool. Depeg policies still settle only on
            an oracle quorum, so an approved Midnight claim on a depeg policy isn&apos;t paid on Cardano.
          </p>
        </Callout>
      </Section>
    </DocsLayout>
  );
}
