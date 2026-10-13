import type { Metadata } from "next";
import { DocsLayout } from "@/components/docs/DocsLayout";
import { src } from "@/components/docs/nav";
import { C, Callout, DocLink, List, P, Section, Strong, Table } from "@/components/docs/Prose";
import report from "@/data/test-report.json";

const t = report.suites;
const recorded = new Date(report.recordedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export const metadata: Metadata = {
  title: "Security & audit scope",
  description:
    "PlutusShield's pre-audit security pack: in-scope Cardano validators and Midnight circuits, the invariants each enforces mapped to the tests that check them, privileged roles, known gaps, and how to report a vulnerability privately.",
};

const ADVISORY = "https://github.com/Kshot3000/PlutusShield/security/advisories/new";

/** Repo path as a source link. */
function S({ path, label }: { path: string; label?: string }) {
  return <DocLink href={src(path)}>{label ?? path}</DocLink>;
}

/** Test names exactly as they appear in the suites, so a reviewer can grep them. */
function T({ children }: { children: string }) {
  return (
    <code className="inline-block max-w-full rounded-md border border-[var(--hairline)] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[0.8em] leading-snug text-accent-strong [overflow-wrap:anywhere]">
      {children}
    </code>
  );
}

export default function SecurityPage() {
  return (
    <DocsLayout
      slug="security"
      title="Security & audit scope"
      description="What an auditor would review, the rules the contracts must never break, the tests that pin each rule down, and who holds which keys today. Written for reviewers; nothing here is a claim of safety."
      toc={[
        { id: "status", label: "Where things stand" },
        { id: "scope", label: "In scope" },
        { id: "cardano-invariants", label: "Cardano invariants" },
        { id: "midnight-invariants", label: "Midnight invariants" },
        { id: "roles", label: "Privileged roles" },
        { id: "gaps", label: "Known gaps" },
        { id: "reproduce", label: "Reproduce the suite" },
        { id: "report", label: "Report a vulnerability" },
      ]}
      sourcePaths={[
        "SECURITY.md",
        "contracts/cardano/validators/cover.ak",
        "contracts/cardano/validators/exploit_cover.ak",
        "contracts/cardano/lib/plutusshield/oracle.ak",
        "contracts/midnight/src/policy-cover-v2.compact",
        "contracts/midnight/test/policy-cover-v2.test.mjs",
      ]}
    >
      <Section id="status" title="Where things stand">
        <Callout tone="danger" title="Not audited">
          <p>
            PlutusShield runs on testnets only (Cardano Preview, Midnight Preprod) with test value. No mainnet
            deployment and no mainnet capital happen before an external audit of both the Cardano validators
            and the Midnight circuits. This page is the scope we would hand that auditor.
          </p>
        </Callout>
        <Table
          caption={`Automated checks on main (recorded ${recorded} at commit ${report.commit} by pnpm test:report)`}
          head={["Suite", "Command", "Result"]}
          rows={[
            ["Cardano validators (Aiken)", <C key="c">pnpm test:cardano</C>, `${t.aiken.pass} of ${t.aiken.total} checks passing`],
            ["Cardano end-to-end (Lucid emulator)", <C key="c">pnpm test:deploy</C>, `Full depeg + exploit-cover flow: ${t.emulator.total} steps, ${t.emulator.refused} of them refused Buys, Settles, Expires and bad committees`],
            ["Midnight circuits (Compact simulator)", <C key="c">pnpm test:midnight</C>, `${t.midnight.pass} of ${t.midnight.total} tests (v1 + v2 registry, claims relay, holder claim kits and the Settle gate, relay plan, ledger decoding)`],
            ["SDK (quote, pool ledger, codecs, evidence, claim kit, committee)", <C key="c">pnpm test:sdk</C>, `${t.sdk.pass} of ${t.sdk.total} tests`],
            ["Oracle relay", <C key="c">pnpm test:relay</C>, `${t.relay.pass} of ${t.relay.total} tests`],
            ["Committee enrollment kit", <C key="c">pnpm --filter @plutusshield/committee test</C>, `${t.committee.pass} of ${t.committee.total} tests`],
          ]}
        />
        <P>
          Passing tests show the code does what the tests check, nothing more. The value of this page is the
          mapping below: every rule we rely on names the code that enforces it and the test that would fail if
          it broke, so a reviewer can look for the rules that have no test.
        </P>
      </Section>

      <Section id="scope" title="In scope">
        <Table
          caption="Audit scope"
          head={["Component", "Source", "Holds funds or decides payouts?"]}
          rows={[
            [
              "Depeg cover validator",
              <S key="s" path="contracts/cardano/validators/cover.ak" />,
              "Yes. Pool NFT, LP shares per tranche, policy mint, Buy / Settle / Expire, Deposit / Withdraw",
            ],
            [
              "Exploit cover validator",
              <S key="s" path="contracts/cardano/validators/exploit_cover.ak" />,
              "Yes. Same pool model; Settle needs M-of-N assessor-committee signatures instead of an oracle quorum",
            ],
            [
              "Oracle, pricing and naming libraries",
              <span key="s">
                <S path="contracts/cardano/lib/plutusshield/oracle.ak" label="oracle.ak" />,{" "}
                <S path="contracts/cardano/lib/plutusshield/pricing.ak" label="pricing.ak" />,{" "}
                <S path="contracts/cardano/lib/plutusshield/names.ak" label="names.ak" />,{" "}
                <S path="contracts/cardano/lib/plutusshield/types.ak" label="types.ak" />
              </span>,
              "Yes. Feed authentication, quorum, sale circuit-breaker, premium floor, token names",
            ],
            [
              "Midnight policy registry v2 (live)",
              <S key="s" path="contracts/midnight/src/policy-cover-v2.compact" />,
              "Decides assessed claims (2-of-3 voteClaim). Holds no funds",
            ],
            [
              "Midnight policy registry v1 (history)",
              <S key="s" path="contracts/midnight/src/policy-cover.compact" />,
              "Single-assessor resolveClaim, kept for the first Preprod records",
            ],
            [
              "Off-chain code a payout depends on",
              <span key="s">
                <S path="packages/sdk/src" label="packages/sdk" />,{" "}
                <S path="services/oracle-relay/src" label="services/oracle-relay" />,{" "}
                <S path="contracts/midnight/relay" label="contracts/midnight/relay" />
              </span>,
              "Indirectly. Builds datums and commitments, computes the TWAP the feeds publish, mirrors policies into Midnight",
            ],
          ]}
        />
        <P>
          Out of scope: the marketing site, the share cards, and the demo scripts. The web app&apos;s transaction
          builders (<S path="apps/web/src/lib/tx" label="apps/web/src/lib/tx" />) are in scope only insofar as
          the validator must reject anything a malicious client could build. The validator is the security
          boundary, not the UI.
        </P>
      </Section>

      <Section id="cardano-invariants" title="Cardano invariants">
        <P>
          Each row is a rule the validator must enforce on every transaction, with Aiken tests that would fail
          if it didn&apos;t. Test names are verbatim, so you can find each one with <C>grep -n</C>.
        </P>
        <Table
          caption="Cardano invariants and their tests"
          head={["Invariant", "Tests"]}
          rows={[
            [
              "Exactly one pool per deployment: InitPool consumes the seed UTxO, and the pool can't move without its NFT",
              <span key="t" className="flex flex-wrap gap-1.5"><T>init_pool_consumes_seed</T><T>init_pool_without_seed_fails</T><T>pool_cannot_be_spent_without_its_nft</T></span>,
            ],
            [
              "Malformed parameters are refused at InitPool (zero quorum, disabled price check, duplicate or missing assets)",
              <span key="t" className="flex flex-wrap gap-1.5"><T>init_pool_rejects_zero_quorum_params</T><T>init_pool_rejects_disabled_price_check</T><T>init_pool_rejects_duplicate_assets</T><T>init_pool_rejects_no_assets</T></span>,
            ],
            [
              "LP shares are minted and burned pro rata, per tranche, and never across tranches",
              <span key="t" className="flex flex-wrap gap-1.5"><T>deposit_overminting_shares_fails</T><T>deposit_minting_other_tranche_lp_fails</T><T>withdraw_more_than_share_value_fails</T><T>usdc_withdraw_cannot_also_take_ada</T></span>,
            ],
            [
              "Live cover stays fully backed: withdrawals stop at the capital lock, and buys stop at the utilization and single-policy caps",
              <span key="t" className="flex flex-wrap gap-1.5"><T>withdraw_below_capital_lock_fails</T><T>buy_beyond_utilization_cap_fails</T><T>buy_above_single_policy_cap_fails</T><T>usdc_buy_capacity_is_per_tranche</T></span>,
            ],
            [
              "The premium is at least the on-chain floor, in the policy's own currency, booked on its own tranche",
              <span key="t" className="flex flex-wrap gap-1.5"><T>buy_underpriced_premium_fails</T><T>usdc_buy_underpriced_fails</T><T>usdc_policy_paid_in_ada_fails</T><T>usdc_buy_booked_on_ada_tranche_fails</T><T>buy_in_unaccepted_asset_fails</T></span>,
            ],
            [
              "The SDK quote and the validator floor agree exactly",
              <span key="t" className="flex flex-wrap gap-1.5"><T>premium_golden_vector_matches_sdk</T><T>capacity_rules_match_sdk_caps</T><T>sdk_golden_vectors</T></span>,
            ],
            [
              "Cover can't be backdated and starts only after the waiting period",
              <span key="t" className="flex flex-wrap gap-1.5"><T>buy_backdated_start_fails</T><T>buy_inside_waiting_period_fails</T><T>settle_event_before_start_fails</T></span>,
            ],
            [
              "Sale circuit-breaker: a Buy needs a fresh healthy reading from every allowlisted feed, so no cover is sold into a depeg",
              <span key="t" className="flex flex-wrap gap-1.5"><T>buy_during_active_depeg_fails</T><T>buy_with_one_feed_depegged_fails</T><T>buy_omitting_the_depegged_feed_fails</T><T>buy_with_stale_peg_reading_fails</T><T>buy_with_forged_peg_feed_fails</T><T>omitting_a_feed_blocks_sale</T></span>,
            ],
            [
              "Depeg Settle needs a quorum of distinct, authenticated, allowlisted feeds whose window meets the trigger inside the cover period",
              <span key="t" className="flex flex-wrap gap-1.5"><T>settle_unauthenticated_oracle_fails</T><T>settle_unlisted_feed_name_fails</T><T>settle_single_oracle_below_quorum_fails</T><T>same_feed_twice_does_not_make_quorum</T><T>settle_trigger_not_met_fails</T><T>settle_window_too_short_fails</T><T>settle_event_after_expiry_fails</T></span>,
            ],
            [
              "A policy pays at most once, exactly its coverage, from its own tranche, and only within the claim grace",
              <span key="t" className="flex flex-wrap gap-1.5"><T>settle_overpaying_pool_fails</T><T>double_claim_keeping_policy_alive_fails</T><T>second_claim_after_payout_fails</T><T>usdc_policy_cannot_be_paid_from_ada_tranche</T><T>settle_after_grace_fails</T></span>,
            ],
            [
              "Expiry returns the reference deposit to the buyer's refund address (whoever submits it) and releases only that policy's tranche",
              <span key="t" className="flex flex-wrap gap-1.5"><T>expire_by_third_party_still_refunds_buyer</T><T>expire_keeping_deposit_fails</T><T>expire_short_refund_fails</T><T>expire_during_grace_fails</T><T>expire_releases_only_the_policy_tranche</T></span>,
            ],
            [
              "Policy tokens are minted only through the pool, and a holder can burn only their own user token, never the reference token",
              <span key="t" className="flex flex-wrap gap-1.5"><T>mint_via_pool_requires_pool_input</T><T>burn_user_tokens_cannot_burn_ref_token</T><T>policy_utxo_unlocks_only_with_ref_burn</T></span>,
            ],
            [
              "Exploit Settle needs M distinct committee signatures; outsiders and duplicates don't count",
              <span key="t" className="flex flex-wrap gap-1.5"><T>exploit_settle_one_of_three_fails</T><T>exploit_settle_one_assessor_plus_outsiders_fails</T><T>exploit_settle_duplicate_signer_counted_once_fails</T><T>exploit_settle_signed_by_someone_else_fails</T><T>committee_signatures_counts_members_once</T></span>,
            ],
            [
              "A malformed committee can't be deployed (empty, duplicate member, bad key length, threshold outside 1..N)",
              <span key="t" className="flex flex-wrap gap-1.5"><T>exploit_init_rejects_empty_committee</T><T>exploit_init_rejects_duplicate_assessor</T><T>exploit_init_rejects_short_assessor_hash</T><T>exploit_init_rejects_zero_threshold</T><T>exploit_init_rejects_threshold_above_size</T></span>,
            ],
            [
              "Exploit payouts are exact and end the cover",
              <span key="t" className="flex flex-wrap gap-1.5"><T>exploit_settle_overpaying_fails</T><T>exploit_settle_underpaying_fails</T><T>exploit_settle_keeping_active_cover_fails</T><T>exploit_settle_without_burning_user_token_fails</T></span>,
            ],
          ]}
        />
      </Section>

      <Section id="midnight-invariants" title="Midnight invariants">
        <P>
          The registry holds no funds, so its rules protect privacy and the claim decision. Tests run the
          compiled circuits in the Compact simulator; the names are verbatim from{" "}
          <S path="contracts/midnight/test/policy-cover.test.mjs" label="policy-cover.test.mjs" /> and{" "}
          <S path="contracts/midnight/test/policy-cover-v2.test.mjs" label="policy-cover-v2.test.mjs" />.
        </P>
        <Table
          caption="Midnight invariants and their tests"
          head={["Invariant", "Tests"]}
          rows={[
            [
              "The ledger stores commitments only, never the holder key or the coverage amount",
              <span key="t" className="flex flex-wrap gap-1.5"><T>issuer registers a policy; record stores only commitments</T></span>,
            ],
            [
              "Only the issuer registers, each policy id once, and only with the holder and coverage the Cardano datum committed to",
              <span key="t" className="flex flex-wrap gap-1.5"><T>non-issuer cannot register</T><T>duplicate policy id rejected</T><T>registerPolicy refuses a holder or coverage the Cardano datum did not commit to</T></span>,
            ],
            [
              "proveCover proves coverage at or above a threshold without revealing it, and only for the real holder with the real opening",
              <span key="t" className="flex flex-wrap gap-1.5"><T>holder proves cover &gt;= threshold without revealing amount</T><T>proof fails above the committed amount</T><T>proof fails with a forged opening</T><T>stranger cannot prove or claim on someone else&apos;s policy</T></span>,
            ],
            [
              "Holder rotation moves control completely: the old key loses every power, and rotation is blocked while a claim is pending or after the policy ends",
              <span key="t" className="flex flex-wrap gap-1.5"><T>after rotation the old key can no longer prove, claim or rotate</T><T>cannot rotate while a claim is pending</T><T>cannot rotate after payout or expiry</T></span>,
            ],
            [
              "Committee: three distinct members fixed at deployment; one vote per member per claim round; outsiders can't vote",
              <span key="t" className="flex flex-wrap gap-1.5"><T>constructor fixes a distinct 3-member committee and a 1..3 threshold</T><T>a single member cannot vote twice, and outsiders cannot vote at all</T></span>,
            ],
            [
              "A claim is decided only at the threshold, and a re-filed claim starts from zero votes",
              <span key="t" className="flex flex-wrap gap-1.5"><T>2-of-3: one approval leaves the claim pending, the second pays it</T><T>a re-filed claim opens a fresh round; earlier votes do not carry over</T><T>votes need a pending claim; paid or expired policies cannot be voted</T></span>,
            ],
            [
              "Votes are public and attributable, so every decision names who made it",
              <span key="t" className="flex flex-wrap gap-1.5"><T>votes are attributable: the ledger records who voted which way</T></span>,
            ],
            [
              "The SDK's commitments equal the compiled circuits byte for byte, so a Cardano datum and a Midnight record always agree",
              <span key="t" className="flex flex-wrap gap-1.5"><T>SDK holder / coverage / registration commitments equal the contract pure circuits on random inputs</T><T>SDK evidenceCommitment equals the contract pure circuit on random inputs</T><T>v2 keeps v1 commitment schemes byte-for-byte (SDK, Cardano datum and evidence stay valid)</T></span>,
            ],
          ]}
        />
      </Section>

      <Section id="roles" title="Privileged roles">
        <P>
          There is no admin key and no pause on either chain: parameters are fixed at deployment. These are the
          keys that still matter, and who holds them on the testnets today.
        </P>
        <Table
          caption="Privileged roles"
          head={["Role", "Can", "Can't", "Held by today"]}
          rows={[
            [
              "Oracle feed operators (3 Preview feeds, quorum 2)",
              "Publish peg readings. A quorum can trigger depeg payouts; any one feed going stale or reporting a depeg closes sales",
              "Pay a policy outside its cover period or above its coverage, or pay from the wrong tranche",
              "One team operator signs all three feeds",
            ],
            [
              "Exploit-cover assessor committee (Cardano, 2-of-3)",
              "Co-sign an exploit Settle that pays a policy's exact coverage",
              "Pay more or less than the coverage, pay after the claim grace, or settle with one signature",
              "Team-run (all three keys). Outside operators enroll through /assessors",
            ],
            [
              "Midnight committee seats (v2, 2-of-3)",
              "Vote a pending claim approved or rejected",
              "Vote twice in a round, vote without a pending claim, or move Cardano funds",
              "Team-run (all three seats)",
            ],
            [
              "Midnight issuer",
              "Mirror Cardano policies in (registerPolicy) and expire them (expirePolicy)",
              "Register a holder or coverage the buyer didn't commit to in the Cardano datum, or prove or claim for a holder",
              "Team relay",
            ],
            [
              "Mock tUSDCx minting key (Preview only)",
              "Mint test USDC at will",
              "Anything on mainnet: real USDCx is Circle's asset",
              "Deployer key",
            ],
          ]}
        />
        <P>
          Cardano can&apos;t read Midnight. An exploit payout is trusted to the Cardano committee&apos;s
          signatures; each Settle carries tx metadata (label <C>7732</C>) naming the Midnight decision, so every
          payout can be checked against a public Midnight record after the fact, but the validator itself
          doesn&apos;t verify it.
        </P>
      </Section>

      <Section id="gaps" title="Known gaps">
        <P>Open items an auditor should know about before starting. Each one is also disclosed on the Risks page.</P>
        <List>
          <li>
            <Strong>Stale-but-healthy readings.</Strong> Each oracle reading is its own UTxO, so a healthy
            reading stays usable for a Buy until it passes the max price age (2h by default), even after a newer
            reading reports a depeg. The waiting period limits the damage; the fix is a state-thread oracle with
            one live UTxO per feed.
          </li>
          <li>
            <Strong>No oracle dispute window.</Strong> A colluding quorum of feeds can trigger payouts, and
            nothing on-chain challenges them.
          </li>
          <li>
            <Strong>Single-operator testnet roles.</Strong> Every feed, committee key, committee seat, and the
            issuer is team-run on the testnets, so today&apos;s quorums prove the mechanics, not independence.
          </li>
          <li>
            <Strong>No upgrade path.</Strong> With no admin key, a bug is fixed by a new deployment and LPs
            moving their capital.
          </li>
          <li>
            <Strong>No withdrawal delay.</Strong> Better-informed LPs can withdraw free capital ahead of an
            event; only the capital lock limits this.
          </li>
          <li>
            <Strong>Coverage is public on Cardano.</Strong> The Midnight record hides it, but the Cardano
            datum doesn&apos;t yet.
          </li>
          <li>
            <Strong>Exploit claim filing is holder-side.</Strong> <C>fileClaim</C> needs the holder&apos;s
            Midnight key in a proving client. On <DocLink href="/claim/evidence">/claim/evidence</DocLink>, File with
            Lace uses the local holder prove bridge for Compact prove and Lace for balance + submit; until that path
            has a finalized Preprod drill tx, production filing is the passphrase-encrypted claim kit (
            <C>--claim … --kit …</C>). Either way the key never goes to the operator relay.
          </li>
          <li>
            <Strong>Young toolchains.</Strong> Pinned to Aiken v1.1.24 (stdlib v4.0.0), compactc 0.31.1 and
            compact-runtime 0.16.0. Compiler bugs are a real risk, but they sit outside this audit.
          </li>
        </List>
      </Section>

      <Section id="reproduce" title="Reproduce the suite">
        <P>
          From a clean clone with Node 20+, pnpm 9, Aiken v1.1.24 and the Compact toolchain installed, one
          command runs everything in the table above:
        </P>
        <pre className="glass overflow-x-auto rounded-2xl px-5 py-4 font-mono text-[13px] text-text">
          <code>pnpm install && pnpm test</code>
        </pre>
        <P>
          The live testnet records the tests are compared against are public:{" "}
          <S path="contracts/cardano/deploy/deployments/preview.json" label="the Preview deployment record" />,{" "}
          <S path="contracts/midnight/deployments/preprod-v2.json" label="the Preprod v2 deployment record" />, and
          every policy&apos;s timeline on <DocLink href="/policy">/policy</DocLink>.
        </P>
      </Section>

      <Section id="report" title="Report a vulnerability">
        <P>
          Please report privately through{" "}
          <DocLink href={ADVISORY}>a GitHub security advisory</DocLink> on the repository rather than a public
          issue. Include the component, the transaction or test that shows the problem, and the testnet tx hash
          if you reproduced it on Preview or Preprod. The full policy is in{" "}
          <S path="SECURITY.md" />.
        </P>
        <Callout tone="warn" title="Testnet only">
          <p>
            Only testnet value is at stake today, so please test against Preview and Preprod, never against
            other people&apos;s mainnet funds. There is no paid bug bounty yet.
          </p>
        </Callout>
      </Section>
    </DocsLayout>
  );
}
