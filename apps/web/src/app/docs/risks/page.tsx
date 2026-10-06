import type { Metadata } from "next";
import { DocsLayout } from "@/components/docs/DocsLayout";
import { C, Callout, DocLink, List, P, Section, Strong, Table } from "@/components/docs/Prose";

export const metadata: Metadata = {
  title: "Risks & disclosures",
  description:
    "Honest PlutusShield disclosures: unaudited, not deployed, purchases closed, oracle and issuer trust assumptions, LP capital risk, and model limitations.",
};

export default function RisksPage() {
  return (
    <DocsLayout
      slug="risks"
      title="Risks & disclosures"
      description="What exists, what doesn't, and what you would be trusting. This page is meant to be blunt."
      toc={[
        { id: "status", label: "Project status" },
        { id: "contract-risk", label: "Smart-contract risk" },
        { id: "oracle-trust", label: "Oracle trust" },
        { id: "cross-chain", label: "Cross-chain & roles" },
        { id: "lp-risk", label: "Underwriter risk" },
        { id: "buyer-risk", label: "Buyer risk" },
        { id: "model", label: "Model & privacy limits" },
        { id: "legal", label: "Not legal insurance" },
      ]}
      sourcePaths={[
        "contracts/cardano/README.md",
        "contracts/midnight/README.md",
        "docs/ARCHITECTURE.md",
        "packages/sdk/src/products.ts",
      ]}
    >
      <Section id="status" title="Project status">
        <Table
          caption="Status"
          head={["Item", "Status"]}
          rows={[
            ["Audit", <Strong key="a">Not audited.</Strong>],
            ["Cardano deployment", "Not deployed to any network. Preview deploy tooling and runbook exist, the full flow passes in the Lucid Emulator, and the Preview deployer is awaiting faucet funding"],
            ["Midnight deployment", "Not deployed to any network"],
            ["Buying cover", "Closed. /cover is a quote preview"],
            ["Underwriting", "Closed. /pool is a simulator"],
            ["Real funds", "None. The protocol holds no money"],
            ["Tests", "Cardano: 92 Aiken checks passing. Midnight: 18 simulation tests passing, full ZK compile OK"],
          ]}
        />
        <P>
          Passing tests show the code does what the tests check, nothing more. They don&apos;t replace an
          external audit. Mainnet capital is planned only after an external audit of both the Cardano and
          Midnight contracts.
        </P>
      </Section>

      <Section id="contract-risk" title="Smart-contract risk">
        <List>
          <li>The validator or circuits may contain bugs that lose or lock funds.</li>
          <li>
            <Strong>No admin key and no pause.</Strong> All parameters are fixed when the script is deployed.
            That removes the risk of a malicious admin, but it also means a bug or a bad parameter can&apos;t be
            patched in place. The fix is a new deployment plus LPs moving their capital.
          </li>
          <li>
            The toolchains are pinned (Aiken v1.1.24 with stdlib v4.0.0, compactc 0.31.1, compact-runtime
            0.16.0). Compiler bugs are possible, and Midnight tooling is young.
          </li>
        </List>
      </Section>

      <Section id="oracle-trust" title="Oracle trust">
        <P>
          Parametric settlement is only as good as its oracles. The validator authenticates feeds (an allowlisted
          token under a fixed policy) and requires a quorum. It does <Strong>not</Strong> check where the price
          came from.
        </P>
        <List>
          <li>
            Whoever controls the oracle minting policy and the feed tokens decides what data exists. If{" "}
            <C>quorum</C> feeds collude or are compromised, they can trigger payouts that drain the pool. If they
            go offline or refuse to publish, valid claims can&apos;t settle.
          </li>
          <li>
            Feed operators compute the time-weighted price off-chain. Each feed attests its own window, and the
            validator doesn&apos;t require the windows to match.
          </li>
          <li>There is no on-chain dispute or challenge period for oracle data.</li>
          <li>
            The same feeds gate <Strong>sales</Strong>. A Buy needs a fresh healthy-peg reading from every
            allowlisted feed, so if any feed goes stale, offline, or reports a depeg, new cover can&apos;t be sold
            (existing policies are unaffected). A feed that lags a real depeg could still let someone buy, but
            the waiting period means the depeg must last past the policy&apos;s start and a full trigger window
            after it.
          </li>
          <li>
            Each oracle reading is its own UTxO, so an older healthy reading stays usable for a Buy until it is
            past the max price age (2h by default), even after a newer reading reports a depeg. The reference
            client always uses the newest reading per feed; closing this on-chain needs a state-thread oracle
            with one live UTxO per feed.
          </li>
          <li>
            The oracle relay service that would publish feeds is <Strong>planned, not built</Strong>, and no
            production feed set or quorum has been chosen.
          </li>
        </List>
      </Section>

      <Section id="cross-chain" title="Cross-chain & roles">
        <List>
          <li>
            Cardano and Midnight are <Strong>not trustlessly linked</Strong>. The issuer mirrors policies into
            Midnight (<C>registerPolicy</C>) and expires them there (<C>expirePolicy</C>). If the issuer is wrong
            or offline, the two chains can disagree.
          </li>
          <li>
            The Midnight assessor is one role commitment fixed at deployment. Assessed claims depend on that
            party&apos;s honesty and availability. Governance rotation is planned.
          </li>
          <li>
            An approved Midnight claim doesn&apos;t yet trigger a Cardano payout. That path is planned. See{" "}
            <DocLink href="/docs/settlement#assessed">Assessed claims</DocLink>.
          </li>
        </List>
      </Section>

      <Section id="lp-risk" title="Underwriter risk">
        <List>
          <li>
            LP capital pays claims. A severe or correlated event can wipe out most of the pool. Live cover is
            backed 1:1 (capital ≥ active cover), but that backing <Strong>is</Strong> LP money.
          </li>
          <li>
            There&apos;s no withdrawal delay, so better-informed LPs can withdraw free capital ahead of an
            unfolding event. Only the 90% utilization capital lock limits this.
          </li>
          <li>
            Each currency tranche is its own risk pool. ADA LPs back only ADA policies, and USDC LPs back only
            USDC policies. With one product per deployment, each tranche&apos;s risk is concentrated in that
            product.
          </li>
          <li>
            USDC tranche LPs and buyers also carry the risk of USDCx itself: Circle&apos;s USDC-backed native
            asset issued through xReserve. On Preview, the USDC tranche uses a mock tUSDCx that the deployer key
            can mint at will, so it has test value only.
          </li>
        </List>
      </Section>

      <Section id="buyer-risk" title="Buyer risk">
        <List>
          <li>
            Parametric cover pays on the <Strong>trigger</Strong>, not on your actual loss. You can lose money
            without a payout (for example, a dip to 0.96, or a depeg that lasted under 24h), and the reverse can
            also happen.
          </li>
          <li>
            Claims must land before <C>expiry + claim_grace_ms</C>, and the trigger window must sit inside your
            cover period.
          </li>
          <li>
            The user token is a bearer asset. Whoever holds it can claim. If you lose the wallet, you lose the
            claim right.
          </li>
          <li>
            Cover doesn&apos;t start the moment you buy. It starts after the waiting period (24h by default, 60
            min on Preview), and an event that begins before <C>start</C> isn&apos;t covered.
          </li>
          <li>
            If the policy expires unclaimed, the ~2.5 ADA reference deposit is returned to the address you set as{" "}
            <C>refund_to</C> at purchase, even if you later transfer the user token.
          </li>
        </List>
      </Section>

      <Section id="model" title="Model & privacy limits">
        <List>
          <li>
            Base rates, risk tiers, and the utilization curve are <Strong>starting assumptions</Strong>, not
            actuarial data. They may misprice risk in either direction. See <DocLink href="/docs/pricing">Pricing</DocLink>.
          </li>
          <li>
            LP projections in the pool simulator are illustrative, not forecasts.
          </li>
          <li>
            Coverage amounts are public on Cardano today, even though they&apos;re committed on Midnight. See{" "}
            <DocLink href="/docs/privacy#limits">Privacy limits</DocLink>.
          </li>
        </List>
      </Section>

      <Section id="legal" title="Not legal insurance">
        <Callout tone="danger" title="Disclosure">
          <p>
            PlutusShield is experimental, open-source software for smart-contract-based cover.
            It isn&apos;t an insurance company, an insurance contract, or financial advice. Its legal treatment
            varies by jurisdiction. Nothing on this site is an offer to sell cover.
          </p>
        </Callout>
      </Section>
    </DocsLayout>
  );
}
