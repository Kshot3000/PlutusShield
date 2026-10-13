import type { Metadata } from "next";
import { OPEN_DATA_ENDPOINTS, OPEN_DATA_SCHEMA } from "@plutusshield/sdk";
import { DocsLayout } from "@/components/docs/DocsLayout";
import { C, Callout, DocLink, Formula, List, P, Section, Strong, Table } from "@/components/docs/Prose";
import { GENERATED_AT, SITE_ROOT, openDataPayload } from "@/lib/openData";

export const metadata: Metadata = {
  title: "Open data API",
  description:
    "PlutusShield publishes read-only JSON feeds of its cover products, claims register, underwriting book and oracle publishes on Cardano Preview and Midnight Preprod. No API key, no wallet, rebuilt on every deploy.",
};

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function JsonLink({ path }: { path: string }) {
  return (
    <a href={`${base}/${path}`} className="font-mono text-[12.5px] text-text underline decoration-[var(--hairline)] underline-offset-4 hover:text-cardano">
      /{path}
    </a>
  );
}

const products = openDataPayload("products").data as { products: { id: string }[] };
const claims = openDataPayload("claims").data as { claims: unknown[] };
const book = openDataPayload("book").data as { pools: unknown[] };
const oracle = openDataPayload("oracle").data as { publishes: unknown[] };

const COUNTS: Record<string, string> = {
  index: `${OPEN_DATA_ENDPOINTS.length} datasets`,
  products: `${products.products.length} products`,
  claims: `${claims.claims.length} decided claims`,
  book: `${book.pools.length} pools`,
  oracle: `${oracle.publishes.length} publishes`,
};

const built = new Date(GENERATED_AT).toUTCString().replace(" GMT", " UTC");

export default function ApiDocsPage() {
  return (
    <DocsLayout
      slug="api"
      title="Open data API"
      description="Everything the products, claims, book and oracle pages show is also published as plain JSON, so dashboards, aggregators and partner protocols can read PlutusShield without a wallet, a key, or our UI."
      toc={[
        { id: "datasets", label: "Datasets" },
        { id: "envelope", label: "The envelope" },
        { id: "read", label: "Reading it" },
        { id: "fields", label: "Field notes" },
        { id: "limits", label: "Limits" },
      ]}
      sourcePaths={["packages/sdk/src/openData.ts", "packages/sdk/test/openData.test.ts", "apps/web/src/lib/openData.ts", "apps/web/src/app/api/v1"]}
    >
      <Section id="datasets" title="Datasets">
        <P>
          Static files on the same host as the site, served by GitHub Pages with CORS open to any origin. The site
          rebuilds them from the public deployment records and chain snapshots on every deploy; this page was built{" "}
          {built}.
        </P>
        <Table
          caption="Open data endpoints"
          head={["Endpoint", "What it holds", "Now", "Page"]}
          rows={OPEN_DATA_ENDPOINTS.map((e) => [
            <JsonLink key={e.path} path={e.path} />,
            e.description,
            COUNTS[e.dataset],
            e.page ? <DocLink key={e.dataset} href={`/${e.page}`}>/{e.page}</DocLink> : "—",
          ])}
        />
      </Section>

      <Section id="envelope" title="The envelope">
        <P>
          Every file has the same wrapper, so a reader can refuse data it does not understand before it reads{" "}
          <C>data</C>. The schema string only changes on a breaking change; new fields can appear inside{" "}
          <C>data</C> without one.
        </P>
        <Formula label={OPEN_DATA_SCHEMA}>{`{
  "schema": "${OPEN_DATA_SCHEMA}",
  "dataset": "claims",                      // index | products | claims | book | oracle
  "generatedAt": "${GENERATED_AT}",   // one build time for all files
  "networks": { "cardano": "preview", "midnight": "preprod" },
  "testnetOnly": true,
  "audited": false,
  "source": "https://github.com/Kshot3000/PlutusShield",
  "page": "${SITE_ROOT}/claims/",
  "data": { ... }
}`}</Formula>
      </Section>

      <Section id="read" title="Reading it">
        <P>From a shell:</P>
        <Formula label="curl + jq">{`curl -s ${SITE_ROOT}/api/v1/claims.json | jq '.data.stats'
curl -s ${SITE_ROOT}/api/v1/oracle.json | jq '.data.latest'`}</Formula>
        <P>
          From TypeScript, the SDK fetches a dataset and checks its envelope (schema, dataset, networks, testnet and
          not-audited flags) before handing it back, and throws with the reason when anything is off:
        </P>
        <Formula label="@plutusshield/sdk">{`import { fetchOpenData } from "@plutusshield/sdk";

const claims = await fetchOpenData("${SITE_ROOT}", "claims");
console.log(claims.data.stats.paidLovelace);   // "125000000" style base-unit string`}</Formula>
      </Section>

      <Section id="fields" title="Field notes">
        <List>
          <li>
            <Strong>Amounts</Strong> are base-unit strings (lovelace, or USDC micro-units with the tranche&apos;s{" "}
            <C>decimals</C>), so nothing loses precision in JSON.
          </li>
          <li>
            <Strong>Times</Strong> are ISO 8601 in UTC. Oracle readings are basis points of the 1.00 peg (
            <C>10000</C> = exactly on peg); the depeg trigger is <C>triggerBps</C>.
          </li>
          <li>
            <Strong>Transactions</Strong> carry both the hash and an explorer URL: Cardanoscan Preview for Cardano,
            the Midnight Preprod explorer for Midnight. Commitments and member keys are never given explorer links.
          </li>
          <li>
            <Strong>Products</Strong> list <C>premiumCurrencies</C> a buyer can pay in today (ADA, USDC) separately
            from <C>plannedCurrencies</C>. A product with <C>status: &quot;priced&quot;</C> has a quote URL and no
            buy URL.
          </li>
          <li>
            <Strong>Nothing private</Strong> is in these files: no holder keys, no coverage openings, no evidence. They
            are the same public records the pages render.
          </li>
        </List>
      </Section>

      <Section id="limits" title="Limits">
        <Callout tone="warn" title="Testnet only, not audited">
          These are Cardano Preview and Midnight Preprod records of test policies and drills, not real cover or real
          losses. The files are only as fresh as the last deploy: for the newest oracle reading, read the feeds on{" "}
          <DocLink href="/oracle">/oracle</DocLink>, which queries Cardano Preview live.
        </Callout>
      </Section>
    </DocsLayout>
  );
}
