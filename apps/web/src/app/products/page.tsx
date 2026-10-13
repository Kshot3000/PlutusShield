import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ProductsCatalog } from "@/components/products/ProductsCatalog";
import { Badge } from "@/components/ui/Badge";
import { CATALOG_STATS as S, PRODUCTS_CATALOG } from "@/lib/productsCatalog";

const siteUrl = "https://kshot3000.github.io/PlutusShield";

export const metadata: Metadata = {
  title: "Cover products",
  description: `PlutusShield cover products for Cardano and Midnight: ${S.live} live on testnet (stablecoin depeg, smart-contract exploit) with ADA or USDC premiums, and protocol SLA cover priced but not buyable until an uptime oracle exists. Triggers, settlement, privacy and deployed parameters from public records. Testnet only, not audited.`,
  openGraph: {
    title: "Cover products · PlutusShield",
    description: `${S.live} live cover products on Cardano Preview + Midnight Preprod, paid in ADA or USDC; SLA cover priced, not yet buyable.`,
    url: `${siteUrl}/products/`,
    type: "website",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "PlutusShield cover products",
  itemListElement: PRODUCTS_CATALOG.map(({ product: p, statusLabel }, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: p.name,
    description: `${statusLabel}. ${p.tagline}`,
    url: `${siteUrl}/products/#${p.id}`,
  })),
};

export default function ProductsPage() {
  return (
    <AppShell
      active="cover"
      title="Cover products"
      description="What PlutusShield covers, how each claim pays, which chain does what, and what you can pay in. Two products sell on testnet today; SLA cover is priced but stays quote-only until an uptime oracle exists."
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <ProductsCatalog />

      <section className="card-surface mt-6 p-6 sm:p-8" aria-labelledby="products-reading">
        <div className="flex flex-wrap gap-2">
          <Badge variant="gold">How to read this</Badge>
          <Badge>Testnet only</Badge>
          <Badge>Not audited</Badge>
        </div>
        <h2 id="products-reading" className="mt-4 font-display text-[1.6rem] leading-tight text-text">
          What &ldquo;live&rdquo; means here, and what it doesn&apos;t
        </h2>
        <div className="mt-4 grid gap-4 text-sm leading-relaxed text-text-muted md:grid-cols-3">
          <p>
            Live means a deployed Cardano Preview pool sells the product to a CIP-30 wallet for test ADA or test USDC
            (tUSDCx). Exploit cover has paid committee-approved claims; no depeg claim has paid because the USDM peg
            has held. Both are in the{" "}
            <Link href="/claims" className="text-text underline underline-offset-4 hover:text-cardano">
              claims register
            </Link>
            . Nothing is on mainnet, and nothing goes there before an external audit.
          </p>
          <p>
            Midnight carries privacy, not premiums: the policy&apos;s holder commitment, sealed claim evidence and the
            committee&apos;s votes. Premiums are ADA or USDC only; NIGHT premiums are not supported. See{" "}
            <Link href="/docs/privacy" className="text-text underline underline-offset-4 hover:text-midnight">
              privacy
            </Link>
            .
          </p>
          <p>
            Rates shown are the quote engine&apos;s base at tier B, the tier every live pool fixed at InitPool; the
            premium you pay also scales with pool utilization. Read{" "}
            <Link href="/docs/pricing" className="text-text underline underline-offset-4 hover:text-cardano">
              pricing
            </Link>{" "}
            and the{" "}
            <Link href="/book" className="text-text underline underline-offset-4 hover:text-cardano">
              underwriting book
            </Link>
            .
          </p>
        </div>
      </section>
    </AppShell>
  );
}
