import type { Metadata } from "next";
import { DocsLayout } from "@/components/docs/DocsLayout";
import { C, Callout, DocLink, Formula, P, Section, Strong, Table } from "@/components/docs/Prose";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "How PlutusShield prices cover: base rates, risk tiers, the kinked utilization curve, capacity caps, and the integer premium floor enforced on-chain.",
};

export default function PricingPage() {
  return (
    <DocsLayout
      slug="pricing"
      title="Pricing"
      description="One model, two implementations. The SDK quotes in floating point for the UI. The validator enforces an integer floor at or just below the quote."
      toc={[
        { id: "formula", label: "The premium formula" },
        { id: "utilization", label: "Utilization curve" },
        { id: "parameters", label: "Parameters" },
        { id: "capacity", label: "Capacity caps" },
        { id: "on-chain-floor", label: "On-chain floor" },
        { id: "worked-example", label: "Worked example" },
      ]}
      sourcePaths={[
        "packages/sdk/src/quote.ts",
        "packages/sdk/src/products.ts",
        "packages/sdk/src/cardano.ts",
        "contracts/cardano/lib/plutusshield/pricing.ak",
      ]}
    >
      <Section id="formula" title="The premium formula">
        <P>
          A premium depends on four things: the product&apos;s base annual rate, the covered asset&apos;s risk
          tier, how much of the policy&apos;s currency tranche is already committed, and how long the cover runs.
          ADA and USDC policies use the same formula, each against its own tranche.
        </P>
        <Formula label="SDK quote (quote.ts), capital and activeCover of the policy's tranche">{`u_before   = activeCover / capital
u_after    = (activeCover + cover) / capital
uMult      = ( m(u_before) + m(u_after) ) / 2
annualRate = baseAnnualRate × riskMultiplier × uMult
premium    = max( minPremium, cover × annualRate × days / 365 )   -- rounded to 0.01, minPremium defaults to 5`}</Formula>
        <P>
          Averaging the multiplier before and after the purchase prices a policy on the capacity it actually
          uses. A large policy that pushes the pool up the curve pays for the scarcer capacity it consumes.
        </P>
      </Section>

      <Section id="utilization" title="Utilization curve">
        <P>
          <C>m(u)</C> is kinked, like a lending-market rate model. It rises gently up to 70% utilization, then
          steeply, so the last units of capacity are expensive and the pool is protected from cheap
          over-commitment.
        </P>
        <Formula label="utilizationMultiplier (quote.ts)">{`u clamped to [0, 1]
m(u) = 1 + 0.25 × u / 0.7                   if u ≤ 0.7
m(u) = 1.25 + 1.5 × (u − 0.7) / 0.3         if u > 0.7`}</Formula>
        <Table
          caption="Utilization multiplier at selected points"
          head={["Utilization", "0%", "35%", "70% (kink)", "80%", "90% (cap)", "100%"]}
          rows={[["m(u)", "1.00×", "1.125×", "1.25×", "1.75×", "2.25×", "2.75×"]]}
        />
      </Section>

      <Section id="parameters" title="Parameters">
        <P>
          These are PlutusShield&apos;s starting model assumptions for testnet, not market data. Governance is
          meant to tune them. On-chain they become <C>ProductTerms</C> in basis points (
          <C>productTerms()</C> in the SDK does the conversion).
        </P>
        <Table
          caption="Product parameters"
          head={["Product", "Base annual rate", "Term", "On-chain base_rate_bps"]}
          rows={[
            ["Stablecoin depeg", "2.0%", "14–365 days", "200"],
            ["Smart-contract exploit", "4.5%", "30–365 days", "450"],
            ["Protocol SLA", "1.5%", "7–180 days", "150"],
          ]}
        />
        <Table
          caption="Risk tiers and global limits"
          head={["Parameter", "Value", "On-chain"]}
          rows={[
            ["Risk tier A / B / C", "0.8× / 1.0× / 1.5×", "risk_mult_bps 8_000 / 10_000 / 15_000"],
            ["Utilization kink", "70%", "utilization_kink_bps 7_000"],
            ["Max utilization", "90%", "max_utilization_bps 9_000"],
            ["Max single policy", "10% of pool capital", "max_single_policy_bps 1_000"],
            ["Minimum premium", "5 units of the policy's currency (5 ADA or 5 USDC)", "Per tranche: AssetTerms.min_premium = 5_000_000 base units (both 6 decimals)"],
          ]}
        />
      </Section>

      <Section id="capacity" title="Capacity caps">
        <P>
          Both caps are checked against the policy&apos;s own tranche, using capital and active cover from
          before the purchase. A USDC policy is backed only by USDC capital, and an ADA policy only by ADA
          capital.
        </P>
        <Formula label="within_capacity (pricing.ak)">{`capital > 0
coverage × 10_000                ≤ capital × max_single_policy_bps    -- ≤ 10% of capital
(active_cover + coverage) × 10_000 ≤ capital × max_utilization_bps    -- ≤ 90% utilization`}</Formula>
        <P>
          An empty pool sells nothing. Because active cover can never exceed 90% of capital, every live policy is
          fully backed. See <DocLink href="/docs/underwriting-pool">Underwriting pool</DocLink>.
        </P>
      </Section>

      <Section id="on-chain-floor" title="On-chain floor">
        <P>
          The validator has no floating point. <C>required_premium</C> repeats the same formula in integer basis
          points with floor division at every step, so the on-chain minimum never exceeds the SDK&apos;s unrounded
          price for the same inputs. A Buy is accepted when the premium paid is <Strong>at least</Strong> this
          floor.
        </P>
        <Formula label="required_premium (pricing.ak)">{`m_bps(u) = 10_000 + 2_500 × u / 7_000                       u ≤ 7_000
m_bps(u) = 12_500 + 15_000 × (u − 7_000) / 3_000            u > 7_000

u_before = active_cover × 10_000 / capital
u_after  = (active_cover + coverage) × 10_000 / capital
m_sum    = m_bps(u_before) + m_bps(u_after)

priced   = coverage × base_rate_bps × risk_mult_bps × m_sum × days
           / (10_000 × 10_000 × 2 × 10_000 × 365)
floor    = max(min_premium, priced)        -- min_premium of the policy's tranche asset`}</Formula>
        <P>
          The displayed quote is rounded to cents, which can land a fraction of a cent under the floor. So when
          building a transaction, the SDK&apos;s <C>chainPremium</C> pays{" "}
          <C>max(ceil(quote × unit), floor)</C>. That is never less than what the UI showed, and never less than
          the validator&apos;s minimum. The SDK&apos;s <C>requiredPremium</C> is a bigint copy of the on-chain
          function.
        </P>
      </Section>

      <Section id="worked-example" title="Worked example">
        <P>
          This is the golden vector shared by <C>pricing.ak</C> and the SDK tests: depeg cover, tier B, 10,000
          units for 365 days, against a tranche with 1,000,000 capital and 300,000 already committed. The math is identical for ADA
          and USDC, since both use 6 decimals.
        </P>
        <Formula label="Float quote vs integer floor">{`u_before = 0.30  → m = 1.10714…        m_bps(3_000) = 11_071
u_after  = 0.31  → m = 1.11071…        m_bps(3_100) = 11_107
uMult    = 1.10893…                    m_sum        = 22_178
annualRate = 0.02 × 1.0 × 1.10893 = 2.2179%

SDK quote      = 10,000 × 0.022179 × 365/365 = 221.79
On-chain floor = 221.78   (221_780_000 base units)`}</Formula>
        <P>
          A 30-day policy of the same size against the same tranche has an on-chain floor of 18.228493 ada. The SDK
          quotes 18.23. The validator test suite accepts a premium exactly at the floor and rejects one lovelace
          below it.
        </P>
        <Callout tone="info" title="Try it">
          <p>
            The <DocLink href="/cover">quote calculator</DocLink> runs this same SDK engine in your browser.
          </p>
        </Callout>
      </Section>
    </DocsLayout>
  );
}
