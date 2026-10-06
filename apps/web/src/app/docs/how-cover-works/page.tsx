import type { Metadata } from "next";
import { DocsLayout } from "@/components/docs/DocsLayout";
import { C, Callout, DocLink, Formula, List, P, Section, Steps, Strong, Table } from "@/components/docs/Prose";

export const metadata: Metadata = {
  title: "How cover works",
  description:
    "PlutusShield policy lifecycle on Cardano and Midnight: pool init, buy, settle, expire, and the exact rules the cover validator enforces.",
};

export default function HowCoverWorksPage() {
  return (
    <DocsLayout
      slug="how-cover-works"
      title="How cover works"
      description="A policy is two tokens and a datum on Cardano, plus a private record on Midnight. Here is the full lifecycle and every rule the validator checks."
      toc={[
        { id: "one-validator", label: "One validator, two roles" },
        { id: "lifecycle", label: "Lifecycle" },
        { id: "buy-rules", label: "What a purchase must satisfy" },
        { id: "policy-datum", label: "The policy datum" },
        { id: "products", label: "Products" },
      ]}
      sourcePaths={[
        "contracts/cardano/validators/cover.ak",
        "contracts/cardano/lib/plutusshield/types.ak",
        "contracts/cardano/lib/plutusshield/names.ak",
        "packages/sdk/src/products.ts",
      ]}
    >
      <Section id="one-validator" title="One validator, two roles">
        <P>
          All Cardano logic lives in one parameterised Plutus V3 multi-validator, <C>cover(params)</C>. Its script
          hash is both the <Strong>minting policy</Strong> of every PlutusShield token and the{" "}
          <Strong>payment credential</Strong> that locks the pool and every policy reference UTxO. There is no admin
          key: the accepted currencies, product terms, oracle allowlist, quorum and claim grace period are fixed
          in <C>CoverParams</C> when the script is deployed.
        </P>
        <Table
          caption="PlutusShield tokens"
          head={["Token", "Asset name", "Lives at", "Meaning"]}
          rows={[
            ["Pool NFT", <C key="a">pool</C>, "Script address", "Marks the one genuine pool UTxO. Minted once by consuming params.seed."],
            ["LP share", <C key="b">lp ‖ tranche byte</C>, "LP wallets", "Fungible, pro-rata claim on one currency tranche (6c7000 = ADA, 6c7001 = USDC)."],
            [
              "Policy reference token",
              <C key="c">000643b0 ‖ id[0..28]</C>,
              "Script address, with PolicyDatum",
              "Live policy state (CIP-67 label 100).",
            ],
            [
              "Policy user token",
              <C key="d">000de140 ‖ id[0..28]</C>,
              "Buyer's wallet",
              "Bearer right to claim (CIP-67 label 222). Burning it is how you claim.",
            ],
          ]}
        />
        <P>
          Every LP or policy action spends the pool UTxO, and the pool spend checks the transaction&apos;s exact
          mint and burn, the capital change in the one tranche it touches, that every other tranche is untouched,
          and the next pool datum. The mint handler&apos;s{" "}
          <C>ViaPool</C> redeemer only requires that the pool UTxO is an input. A policy UTxO can be spent only if
          its reference token is burned in the same transaction, which only the pool&apos;s <C>Settle</C> and{" "}
          <C>Expire</C> paths allow.
        </P>
      </Section>

      <Section id="lifecycle" title="Lifecycle">
        <Steps
          items={[
            {
              title: "InitPool",
              chain: "Cardano",
              body: (
                <>
                  Mints the pool NFT exactly once by spending <C>params.seed</C>. The pool starts with one empty
                  tranche per accepted currency, and the params are sanity-checked. For example, there must be
                  1 to 256 distinct assets, quorum must be between 1 and the number of feeds, and the
                  single-policy cap must not exceed the utilization cap.
                </>
              ),
            },
            {
              title: "Deposit / Withdraw",
              chain: "Cardano",
              body: (
                <>
                  Underwriters add capital to one currency tranche for that tranche&apos;s LP shares, and redeem
                  shares for capital in the same asset, subject to the capital lock. See <DocLink href="/docs/underwriting-pool">Underwriting pool</DocLink>.
                </>
              ),
            },
            {
              title: "Buy",
              chain: "Cardano",
              body: (
                <>
                  The buyer picks a currency (ADA or USDC) and pays the premium in it, into that tranche. The
                  transaction mints one reference token, locked at the script with a <C>PolicyDatum</C>, and one
                  user token for the buyer. That tranche&apos;s <C>active_cover</C> grows by the coverage
                  amount.
                </>
              ),
            },
            {
              title: "registerPolicy",
              chain: "Midnight",
              body: (
                <>
                  After the Cardano mint confirms, the issuer mirrors the policy into the private registry, keyed
                  by the same 32-byte policy id. The record holds a holder commitment and a coverage commitment. See{" "}
                  <DocLink href="/docs/privacy">Privacy</DocLink>.
                </>
              ),
            },
            {
              title: "Settle (claim)",
              chain: "Cardano",
              body: (
                <>
                  If a quorum of allowlisted oracle feeds attests the trigger inside the cover period, the holder
                  burns both policy tokens, and the policy&apos;s tranche pays exactly <C>coverage</C> in the
                  policy&apos;s asset. The claim must land before{" "}
                  <C>expiry + claim_grace_ms</C>. See <DocLink href="/docs/settlement">Settlement</DocLink>.
                </>
              ),
            },
            {
              title: "Expire",
              chain: "Cardano",
              body: (
                <>
                  Once the validity range starts after <C>expiry + claim_grace_ms</C>, <Strong>anyone</Strong> can
                  burn the reference token to retire the policy. Capital stays in the pool, and the tranche&apos;s{" "}
                  <C>active_cover</C> drops by the coverage, which frees capacity. The user token can be burned in
                  the same transaction or later with <C>BurnUserTokens</C>.
                </>
              ),
            },
          ]}
        />
        <Formula label="Redeemers (types.ak)">{`MintAction = InitPool | ViaPool | BurnUserTokens
PoolAction = Deposit { tranche } | Withdraw { tranche, shares } | Buy | Settle | Expire`}</Formula>
      </Section>

      <Section id="buy-rules" title="What a purchase must satisfy">
        <P>
          <C>validate_buy</C> accepts a Buy only if <Strong>all</Strong> of these hold. Product terms are fixed by
          the deployment. The buyer can&apos;t choose them.
        </P>
        <List>
          <li>
            Exactly one reference token and one user token are minted for the derived policy id. The reference
            output sits at the script and holds only that token plus ada.
          </li>
          <li>
            <C>policy_id</C> equals <C>blake2b_256(cbor(pool OutputReference spent))</C>. Each pool UTxO is spent
            once, so ids are unique.
          </li>
          <li>
            <C>product_id</C> and <C>trigger</C> equal the product&apos;s, so a buyer can&apos;t pick a looser
            threshold.
          </li>
          <li>
            <C>asset</C> is one of the accepted currencies. It selects the tranche. Premium, capacity, the
            premium floor (with that asset&apos;s <C>min_premium</C>), and the active-cover update all use that
            tranche only. Every other tranche&apos;s capital is unchanged.
          </li>
          <li>
            <C>midnight_commitment</C> is exactly 32 bytes.
          </li>
          <li>
            <C>coverage &gt; 0</C>. The term is a whole number of days between <C>min_days</C> and{" "}
            <C>max_days</C>.
          </li>
          <li>
            No backdating: the transaction&apos;s validity upper bound must be <C>≤ start</C>.
          </li>
          <li>
            The capacity caps hold against the tranche&apos;s pre-purchase capital, and the premium paid (the
            tranche&apos;s capital increase) is at least the integer floor. See <DocLink href="/docs/pricing">Pricing</DocLink>.
          </li>
          <li>
            The tranche&apos;s next ledger is exactly <C>active_cover + coverage</C>, with shares unchanged.
          </li>
        </List>
      </Section>

      <Section id="policy-datum" title="The policy datum">
        <Formula label="PolicyDatum (types.ak)">{`PolicyDatum {
  policy_id:           ByteArray  -- 32 bytes, blake2b_256(cbor(pool OutputReference))
  product_id:          ByteArray  -- "depeg"
  asset:               AssetClass -- currency of coverage, premium and payout; picks the tranche
  coverage:            Int        -- base units of that asset
  premium:             Int
  start, expiry:       Int        -- POSIX ms, expiry = start + days * 86_400_000
  trigger:             Trigger    -- { covered_asset, threshold_bps, window_ms }
  midnight_commitment: ByteArray  -- 32-byte Midnight coverage commitment
}`}</Formula>
        <P>
          <C>packages/sdk</C> builds this datum (<C>buildPolicyDatum</C>), derives ids and token names, and
          encodes Plutus Data byte-for-byte as the validator does. Golden vectors are checked on both sides.
        </P>
      </Section>

      <Section id="products" title="Products">
        <P>
          The quote engine prices three product lines. One deployment of <C>cover</C> serves one product with one
          trigger, and can accept several currencies (ADA and USDC by default).
        </P>
        <Table
          caption="Product lines"
          head={["Product", "Settlement", "Status"]}
          rows={[
            [
              "Stablecoin depeg",
              "Parametric. Oracle TWAP below 0.95 of peg for 24h (threshold_bps 9_500, window 86_400_000 ms)",
              "Implemented in the Cardano validator (MVP)",
            ],
            [
              "Smart-contract exploit",
              "Assessed. Evidence commitment on Midnight plus an assessor decision",
              "Priced in SDK. Midnight claim flow implemented. Cardano payout path planned",
            ],
            ["Protocol SLA", "Parametric. Uptime oracle below an SLA threshold", "Priced in SDK. Oracle and deployment planned"],
          ]}
        />
        <Callout tone="warn" title="Purchases are closed">
          <p>
            The contracts aren&apos;t deployed on any network yet, so <DocLink href="/cover">/cover</DocLink> only
            quotes. The Cardano Preview deploy tooling is ready and the full flow passes in an emulator, but no
            pool exists on Preview yet. Buying opens after that deployment.
          </p>
        </Callout>
      </Section>
    </DocsLayout>
  );
}
