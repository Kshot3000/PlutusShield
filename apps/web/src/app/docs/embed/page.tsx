import type { Metadata } from "next";
import { EMBED_RESIZE_MESSAGE, EMBED_DEFAULTS, EMBED_MAX_AMOUNT, PRODUCTS } from "@plutusshield/sdk";
import { DocsLayout } from "@/components/docs/DocsLayout";
import { C, Callout, DocLink, Formula, List, P, Section, Table } from "@/components/docs/Prose";
import { EmbedBuilder } from "@/components/embed/EmbedBuilder";
import { SITE_ROOT } from "@/lib/openData";

export const metadata: Metadata = {
  title: "Embed a cover quote",
  description:
    "Put a live PlutusShield depeg or exploit cover quote inside a Cardano dApp with one iframe: priced by the same quote engine as /cover against the Preview pools, no wallet in the widget, testnet only.",
};

export default function EmbedDocsPage() {
  return (
    <DocsLayout
      slug="embed"
      title="Embed a cover quote"
      description="A DEX, lender or vault can show its users what protecting their position would cost, right next to the deposit button. The widget prices cover with the same quote engine as /cover and hands the user to PlutusShield to buy it from their own wallet."
      toc={[
        { id: "builder", label: "Snippet builder" },
        { id: "params", label: "URL params" },
        { id: "resize", label: "Auto-size" },
        { id: "sdk", label: "From the SDK" },
        { id: "safety", label: "What it never does" },
      ]}
      sourcePaths={[
        "packages/sdk/src/embed.ts",
        "packages/sdk/test/embed.test.ts",
        "apps/web/src/components/embed/EmbedQuote.tsx",
        "apps/web/src/app/embed/quote/page.tsx",
      ]}
    >
      <Section id="builder" title="Snippet builder">
        <P>
          Pick the cover your users would want, copy the iframe, and paste it into your page. The preview on the right is
          the real widget served from <C>/embed/quote/</C>.
        </P>
        <EmbedBuilder />
      </Section>

      <Section id="params" title="URL params">
        <P>
          Every setting is a query param on <C>{`${SITE_ROOT}/embed/quote/`}</C>. Defaults are left out of the snippet.
          A bad value never breaks the widget: it falls back to the default (a term outside the product&apos;s range is
          clamped into it) and the widget lists what it ignored.
        </P>
        <Table
          caption="Embed query params"
          head={["Param", "Values", "Default"]}
          rows={[
            [<C key="p">p</C>, "depeg or exploit (SLA cover has no live pool, so it is refused)", EMBED_DEFAULTS.product],
            [<C key="c">c</C>, "ADA or USDC: the tranche that prices and would pay the policy", EMBED_DEFAULTS.currency],
            [<C key="a">a</C>, `Cover amount, above 0 and at most ${EMBED_MAX_AMOUNT.toLocaleString("en-US")}; the pool's 10% single-policy and 90% utilization caps still apply`, String(EMBED_DEFAULTS.amount)],
            [
              <C key="d">d</C>,
              `Term in days: ${PRODUCTS.depeg.minDays}–${PRODUCTS.depeg.maxDays} for depeg, ${PRODUCTS.exploit.minDays}–${PRODUCTS.exploit.maxDays} for exploit`,
              String(EMBED_DEFAULTS.days),
            ],
            [<C key="t">t</C>, "dark or light", EMBED_DEFAULTS.theme],
            [<C key="ref">ref</C>, "Your partner tag (a-z, 0-9, dashes, up to 32), shown as “via ref” and carried into the plan label", "none"],
          ]}
        />
        <P>
          The widget&apos;s button opens <DocLink href="/plan">/plan</DocLink> in a new tab with the same cover encoded as a
          plan share link, so the user lands on a priced plan with a Buy link for each policy.
        </P>
      </Section>

      <Section id="resize" title="Auto-size">
        <P>
          The widget posts its content height to the parent page as a <C>{EMBED_RESIZE_MESSAGE}</C> message whenever it
          changes. The optional script in the builder sets each PlutusShield iframe&apos;s height from that message and only
          trusts messages from the iframe they claim to size.
        </P>
        <Formula label="message">{`{ "type": "${EMBED_RESIZE_MESSAGE}", "height": 412 }`}</Formula>
      </Section>

      <Section id="sdk" title="From the SDK">
        <P>Build the same snippet, or price the widget&apos;s cover yourself, from TypeScript:</P>
        <Formula label="@plutusshield/sdk">{`import { embedSnippet, embedQuote, decodeEmbedConfig } from "@plutusshield/sdk";

const cfg = { product: "exploit", currency: "USDC", amount: 250, days: 90, theme: "light", ref: "my-dex" } as const;
const html = embedSnippet(cfg, { siteRoot: "${SITE_ROOT}" });

// Same quote() as /cover; planQuery rebuilds the cover on /plan.
const { quote, planQuery } = embedQuote(cfg, { capital: 2_000, activeCover: 50 });`}</Formula>
      </Section>

      <Section id="safety" title="What it never does">
        <List>
          <li>It never connects or asks for a wallet, and never builds or signs a transaction. Buying happens on PlutusShield, from the user&apos;s own CIP-30 wallet.</li>
          <li>It reads no cookies or storage from your page, and the snippet sends only your origin as the referrer.</li>
          <li>Prices come from the Preview pool snapshot baked into each site build, the same one /plan uses, so a live quote on /cover can differ slightly if the pool moved since.</li>
        </List>
        <Callout tone="warn" title="Testnet only">
          The pools are on Cardano Preview with test ADA and test USDC, and the contracts are not audited. Nothing the widget
          shows is an offer of insurance.
        </Callout>
      </Section>
    </DocsLayout>
  );
}
