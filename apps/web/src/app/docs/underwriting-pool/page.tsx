import type { Metadata } from "next";
import { DocsLayout } from "@/components/docs/DocsLayout";
import { C, Callout, DocLink, Formula, List, P, Section, Strong, Table } from "@/components/docs/Prose";

export const metadata: Metadata = {
  title: "Underwriting pool",
  description:
    "How the PlutusShield underwriting pool works: per-currency tranches (ADA, USDC), LP shares, deposits, withdrawals, the capital lock, and how premiums and claims move share value.",
};

export default function UnderwritingPoolPage() {
  return (
    <DocsLayout
      slug="underwriting-pool"
      title="Underwriting pool"
      description="Underwriters fund one script-locked pool that holds a separate tranche per currency. Premiums raise a tranche's share value, claims lower it, and a capital lock keeps every live policy backed."
      toc={[
        { id: "pool-utxo", label: "The pool UTxO" },
        { id: "tranches", label: "Currency tranches" },
        { id: "deposit", label: "Deposit" },
        { id: "withdraw", label: "Withdraw & capital lock" },
        { id: "share-value", label: "How share value moves" },
        { id: "solvency", label: "Solvency invariant" },
        { id: "not-implemented", label: "Not implemented" },
      ]}
      sourcePaths={[
        "contracts/cardano/validators/cover.ak",
        "contracts/cardano/lib/plutusshield/types.ak",
        "packages/sdk/src/pool.ts",
        "packages/sdk/src/assets.ts",
      ]}
    >
      <Section id="pool-utxo" title="The pool UTxO">
        <P>
          The pool is a single UTxO at the <C>cover</C> script address, authenticated by the pool NFT. Its datum
          holds one ledger per accepted currency. Capital isn&apos;t stored in the datum. A tranche&apos;s
          capital is simply how much of its asset the pool UTxO holds.
        </P>
        <Formula label="PoolDatum (types.ak)">{`PoolDatum { tranches: List<Tranche> }      -- tranches[i] belongs to params.assets[i]

Tranche {
  total_shares: Int   -- LP share tokens of this tranche outstanding
  active_cover: Int   -- sum of coverage over live policies in this asset
}

capital[i] = quantity of params.assets[i].asset in the pool UTxO
             (for ada: all lovelace in the UTxO, including its min-UTxO ada)`}</Formula>
        <P>Every pool spend must recreate the pool at the same address, with a value that holds only:</P>
        <List>
          <li>
            ada, the pool NFT, and each token tranche&apos;s asset, in exactly the quantities counted as capital.
            Foreign tokens are rejected.
          </li>
          <li>
            If the pool has no ada tranche, its min-UTxO ada can never decrease.
          </li>
        </List>
      </Section>

      <Section id="tranches" title="Currency tranches">
        <P>
          <C>CoverParams.assets</C> lists the accepted currencies: 1 to 256 distinct assets, each with its own
          premium floor (<C>AssetTerms.min_premium</C>). A currency&apos;s position in that list is its tranche
          index. That index appears in the LP token name (<C>&quot;lp&quot; ‖ index byte</C>, so{" "}
          <C>6c7000</C> for tranche 0) and in the <C>Deposit</C> and <C>Withdraw</C> redeemers.
        </P>
        <Table
          caption="Default tranche layout"
          head={["Tranche", "Mainnet asset", "Preview asset", "LP token"]}
          rows={[
            ["0 · ADA", "ada", "ada", <C key="a">lp ‖ 00</C>],
            [
              "1 · USDC",
              "USDCx (Circle, via xReserve), 6 decimals",
              "Mock tUSDCx minted by the deployer key (Circle has no Preview USDCx)",
              <C key="b">lp ‖ 01</C>,
            ],
          ]}
        />
        <P>
          Each policy is denominated in exactly one tranche asset (<C>PolicyDatum.asset</C>). Its premium is paid
          in that asset, its capacity and price are computed against that tranche only, and its payout comes
          from that tranche in that asset. Tranches never price against each other, so no FX oracle is needed.{" "}
          <Strong>A USDC claim can never be paid from ADA capital</Strong>, and vice versa.
        </P>
        <P>
          Every pool action touches exactly one tranche. All other tranches must keep their capital unchanged.
          The one exception is that the ada tranche may <Strong>gain</Strong> lovelace when it isn&apos;t the
          target, for example a min-UTxO top-up when a token tranche first receives capital. That only donates
          to ada LPs.
        </P>
      </Section>

      <Section id="deposit" title="Deposit">
        <Formula label="Deposit { tranche: t } (cover.ak)">{`amount = capital_out[t] − capital_in[t]           must be > 0
shares = amount                                    if tranches[t].total_shares == 0
shares = amount × total_shares / capital_in[t]     otherwise (floored), must be > 0
mint exactly shares × lp_name(t)
tranches[t] = { total_shares + shares, active_cover }`}</Formula>
        <P>
          The first depositor into a tranche sets its share price at 1:1. After that, shares are minted at the
          current share price, rounded down in the pool&apos;s favour. A deposit too small to mint one share is
          rejected, and so is a deposit into one tranche that mints another tranche&apos;s LP token.
        </P>
      </Section>

      <Section id="withdraw" title="Withdraw & capital lock">
        <Formula label="Withdraw { tranche: t, shares } (cover.ak)">{`0 < shares ≤ tranches[t].total_shares
payout = shares × capital_in[t] / total_shares       (floored, paid in tranche t's asset)
capital_out[t] = capital_in[t] − payout
burn exactly shares × lp_name(t)
active_cover[t] × 10_000 ≤ capital_out[t] × max_utilization_bps     -- capital lock`}</Formula>
        <P>
          The capital lock means LPs can only withdraw <Strong>free</Strong> capital. What remains in the tranche
          must still back that tranche&apos;s active cover at the product&apos;s max utilization (90%). The
          smallest capital a tranche can keep is <C>ceil(active_cover × 10_000 / max_utilization_bps)</C>. The SDK
          exposes this as <C>lockedCapital</C>, and <C>maxWithdrawableShares</C> gives the largest burn the lock
          allows.
        </P>
        <Table
          caption="Capital lock example from the validator tests"
          head={["Tranche", "Withdraw", "Remaining capital", "Result"]}
          rows={[
            ["1,000,000 capital · 300,000 active", "660,000 shares", "340,000 (88% utilization)", "Accepted"],
            ["1,000,000 capital · 300,000 active", "700,000 shares", "300,000 (needs ≥ 333,333.34)", "Rejected"],
          ]}
        />
      </Section>

      <Section id="share-value" title="How share value moves">
        <P>
          A tranche&apos;s share value is <C>capital[t] / total_shares[t]</C>. Each action changes it like this:
        </P>
        <Table
          caption="Effect of each pool action on the policy's tranche"
          head={["Action", "capital[t]", "active_cover[t]", "LP effect"]}
          rows={[
            ["Deposit", "+ amount", "unchanged", "New shares at current price"],
            ["Withdraw", "− payout", "unchanged", "Shares burned at current price"],
            ["Buy", "+ premium", "+ coverage", "Premium accrues to the tranche's LPs pro rata"],
            ["Settle", "− coverage", "− coverage", "Claim loss shared by the tranche's LPs pro rata"],
            ["Expire", "unchanged", "− coverage", "Capacity freed, premium kept"],
          ]}
        />
        <P>
          The <DocLink href="/pool">pool simulator</DocLink> runs <C>packages/sdk/src/pool.ts</C>, an exact bigint
          copy of these per-tranche rules, so its previews match what the validator would accept. Its LP
          projection (premium APR, break-even claim rate) is an illustrative model, not a forecast. Real income
          depends on demand.
        </P>
      </Section>

      <Section id="solvency" title="Solvency invariant">
        <P>
          Buy and Withdraw both require <C>active_cover[t] ≤ 90% × capital[t]</C> after the action. Settle removes
          the same amount from a tranche&apos;s capital and active cover, and Expire only lowers active cover.
          So, per tranche, <Strong>capital ≥ active_cover</Strong> always holds: every live policy is backed 1:1
          in its own currency, with no fractional reserve.
        </P>
        <P>
          After a large claim, a tranche&apos;s utilization can rise above 90%. While it stays there, new Buys
          and LP withdrawals in that tranche are blocked until expiries or new deposits bring it back down.
          Other tranches are unaffected.
        </P>
        <Callout tone="danger" title="LP capital is at risk">
          <p>
            Underwriting means selling protection. If triggered claims pay out, the tranche&apos;s capital and the
            value of its LP shares fall. In a severe, correlated event, LPs can lose most of their deposit.
          </p>
        </Callout>
      </Section>

      <Section id="not-implemented" title="Not implemented">
        <List>
          <li>No protocol fee. All premiums go to the policy&apos;s tranche.</li>
          <li>
            No withdrawal delay or cooldown. LPs can withdraw free capital at any time, including while an event
            is unfolding. Only the capital lock limits this.
          </li>
          <li>
            One product per deployment, and no capital sharing across tranches or deployments.
          </li>
        </List>
      </Section>
    </DocsLayout>
  );
}
