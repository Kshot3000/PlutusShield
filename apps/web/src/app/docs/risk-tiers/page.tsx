import type { Metadata } from "next";
import { DEPEG_CRITERIA, EXPLOIT_CRITERIA, RISK_MULTIPLIER, TIER_THRESHOLDS, maxScorecardPoints, type Criterion } from "@plutusshield/sdk";
import { DocsLayout } from "@/components/docs/DocsLayout";
import { C, Callout, DocLink, P, Section, Strong, Table } from "@/components/docs/Prose";
import { RiskScorecard } from "@/components/docs/RiskScorecard";

export const metadata: Metadata = {
  title: "Risk tiers",
  description:
    "How PlutusShield sets a pool's risk tier: an open underwriting scorecard for exploit and depeg cover, hard stops that decline cover, caps, and the risk_mult_bps it fixes at InitPool.",
};

const rubricRows = (criteria: Criterion[]) =>
  criteria.map((c) => [
    c.label,
    c.options
      .map((o) => `${o.label}: ${o.hardStop ? "declines" : `${o.points}`}${o.cap ? `, caps at ${o.cap.tier}` : ""}`)
      .join(" · "),
    c.why,
  ]);

export default function RiskTiersPage() {
  return (
    <DocsLayout
      slug="risk-tiers"
      title="Risk tiers"
      description="The tier is set by the underwriter per pool, not picked by the buyer. This is the open scorecard that gets from a protocol or stablecoin to that tier."
      toc={[
        { id: "where", label: "Where the tier lives" },
        { id: "scorecard", label: "Score a protocol" },
        { id: "exploit", label: "Exploit cover rubric" },
        { id: "depeg", label: "Depeg cover rubric" },
        { id: "thresholds", label: "Thresholds and caps" },
      ]}
      sourcePaths={["packages/sdk/src/riskTier.ts", "packages/sdk/test/riskTier.test.ts", "packages/sdk/src/products.ts", "contracts/cardano/lib/plutusshield/types.ak"]}
    >
      <Section id="where" title="Where the tier lives">
        <P>
          Every pool fixes its risk multiplier once, at <C>InitPool</C>, as <C>risk_mult_bps</C> in its
          <C>ProductTerms</C>. Each Buy from that pool is priced with the same multiplier, and the validator&apos;s
          premium floor uses it, so a buyer cannot choose a cheaper tier for the same risk. Both live Preview
          pools (USDM depeg and the exploit-cover v2 committee pool) are tier B, <C>10_000</C> bps. The tier
          picker on <DocLink href="/cover/">/cover</DocLink> is there to compare prices across pools.
        </P>
        <Callout tone="warn" title="Model assumptions">
          <P>
            The criteria, points and thresholds below are PlutusShield&apos;s starting underwriting rules for
            testnet. They are not market data and not a rating of any named protocol. Governance is meant to
            tune them, and an independent assessor committee will apply them before any mainnet pool opens.
          </P>
        </Callout>
      </Section>

      <Section id="scorecard" title="Score a protocol">
        <P>
          Answer the questions for the protocol or stablecoin you want covered. The result comes from the same
          <C>scoreRiskTier</C> function the SDK tests check, so it is exactly what an underwriter would set.
        </P>
        <RiskScorecard />
      </Section>

      <Section id="exploit" title="Exploit cover rubric">
        <Table
          caption="Smart-contract exploit cover criteria"
          head={["Criterion", "Answers and points", "Why it matters"]}
          rows={rubricRows(EXPLOIT_CRITERIA)}
        />
        <P>Maximum {maxScorecardPoints("exploit")} points.</P>
      </Section>

      <Section id="depeg" title="Depeg cover rubric">
        <Table caption="Stablecoin depeg cover criteria" head={["Criterion", "Answers and points", "Why it matters"]} rows={rubricRows(DEPEG_CRITERIA)} />
        <P>
          Maximum {maxScorecardPoints("depeg")} points. The three-venue rule mirrors the live depeg oracle, which
          takes a quorum of three independent Preview feeds before a claim can settle (see{" "}
          <DocLink href="/oracle/">/oracle</DocLink>).
        </P>
      </Section>

      <Section id="thresholds" title="Thresholds and caps">
        <Table
          caption="Tier thresholds"
          head={["Tier", "Share of max points", "Risk multiplier", "risk_mult_bps"]}
          rows={[
            ...TIER_THRESHOLDS.map((t) => [
              `Tier ${t.tier}`,
              `${Math.round(t.minShare * 100)}% or more`,
              `${RISK_MULTIPLIER[t.tier].toFixed(1)}×`,
              Math.round(RISK_MULTIPLIER[t.tier] * 10_000).toLocaleString("en-US"),
            ]),
            ["Declined", `Under ${Math.round(TIER_THRESHOLDS[TIER_THRESHOLDS.length - 1].minShare * 100)}%, or any hard stop`, "—", "No pool"],
          ]}
        />
        <P>
          <Strong>Hard stops</Strong> decline cover however well the rest scores: no audit, an unresolved past
          loss, an algorithmic or unbacked stablecoin, a peg that broke and never recovered, or fewer than three
          price venues. <Strong>Caps</Strong> limit the best reachable tier: a single admin key with no timelock,
          under three months live, a stablecoin under six months old or without redemption cap at C, and a single
          price source caps at B. A cap never improves a tier the points already put lower.
        </P>
      </Section>
    </DocsLayout>
  );
}
