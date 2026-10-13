import type { Metadata } from "next";
import { DocsLayout } from "@/components/docs/DocsLayout";
import { Callout, DocLink, P, Section } from "@/components/docs/Prose";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Plain answers about PlutusShield cover on Cardano and Midnight: what you can insure, paying in ADA or USDC, when cover starts, how depeg and exploit claims pay, privacy, underwriting, and what is not built yet.",
};

/**
 * One source for the visible answers and the FAQPage JSON-LD, so search
 * engines get exactly the text a reader sees. Every answer is written from
 * the docs pages it links to; keep them in step when those change.
 */
interface Faq {
  id: string;
  q: string;
  a: string;
  more?: { href: string; label: string };
}

const GROUPS: { id: string; title: string; items: Faq[] }[] = [
  {
    id: "basics",
    title: "The basics",
    items: [
      {
        id: "what-is",
        q: "What is PlutusShield?",
        a: "Open-source, smart-contract-based cover for Cardano and Midnight. You can buy stablecoin depeg cover, which pays automatically on an oracle trigger, and smart-contract exploit cover, which pays after an assessed claim. Policies live on Cardano, and each policy's holder and coverage are committed privately on Midnight.",
        more: { href: "/docs/how-cover-works", label: "How cover works" },
      },
      {
        id: "mainnet",
        q: "Is it live on mainnet?",
        a: "No. PlutusShield runs on the Cardano Preview testnet and Midnight Preprod only, with test ADA and a mock tUSDCx, so nothing on it has real value. It is not audited, and no mainnet deployment happens before an external audit of both the Cardano and Midnight contracts.",
        more: { href: "/docs/risks#status", label: "Project status" },
      },
      {
        id: "insurance",
        q: "Is this an insurance policy?",
        a: "No. PlutusShield is experimental open-source software. It isn't an insurance company, an insurance contract or financial advice, and its legal treatment varies by jurisdiction.",
        more: { href: "/docs/risks#legal", label: "Not legal insurance" },
      },
    ],
  },
  {
    id: "buying",
    title: "Buying cover",
    items: [
      {
        id: "products",
        q: "What can I cover?",
        a: "Two products can be bought today. Stablecoin depeg cover pays when a multi-oracle time-weighted price stays below 0.95 for 24 hours. Smart-contract exploit cover pays after a claim, backed by sealed evidence on Midnight, is approved by an assessor committee. Protocol SLA cover can be priced in the quote calculator but can't be bought yet, because the uptime oracle it needs doesn't exist.",
        more: { href: "/cover", label: "Get a quote" },
      },
      {
        id: "currency",
        q: "What do I pay the premium in?",
        a: "ADA or USDC, paid on Cardano. Each currency has its own pool tranche, so an ADA policy is backed only by ADA capital and a USDC policy only by USDC capital, and a payout comes in the policy's own currency. On Preview the USDC tranche uses a mock tUSDCx. Premiums can't be paid in NIGHT today.",
        more: { href: "/docs/underwriting-pool#tranches", label: "Tranches" },
      },
      {
        id: "price",
        q: "How is the premium priced?",
        a: "The premium is the coverage times an annual rate times the days covered over 365, with a minimum of 5 ADA or 5 USDC. The annual rate starts from the product's base rate (2% for depeg, 4.5% for exploit), is scaled by the covered asset's risk tier, and rises as the pool's tranche gets more utilized. The Cardano validator repeats the same formula in integer math and rejects any purchase that pays less than the floor.",
        more: { href: "/docs/pricing", label: "Pricing" },
      },
      {
        id: "wallet",
        q: "Which wallet do I need?",
        a: "Any CIP-30 Cardano wallet set to Preview can buy, claim and release on the cover page. For the Midnight steps, such as filing exploit evidence, connect Lace's Midnight edition switched to Preprod.",
        more: { href: "/cover", label: "Open the cover page" },
      },
      {
        id: "start",
        q: "When does my cover start?",
        a: "After a waiting period, not the moment you buy: 24 hours by default and 60 minutes on Preview. An event that begins before your cover starts isn't covered, and sales pause whenever any oracle feed is stale or reports a depeg.",
        more: { href: "/docs/how-cover-works#buy-rules", label: "Purchase rules" },
      },
    ],
  },
  {
    id: "claims",
    title: "Claims and payouts",
    items: [
      {
        id: "depeg-claim",
        q: "How does a depeg claim pay?",
        a: "When a quorum of allowlisted oracle feeds attests the trigger inside your cover period, you burn your policy tokens in a Settle transaction and the pool pays exactly your coverage in the policy's currency. There is no assessor in this path, and the claim must land before expiry plus the claim grace period.",
        more: { href: "/docs/settlement", label: "Settlement & claims" },
      },
      {
        id: "exploit-claim",
        q: "How does an exploit claim pay?",
        a: "You seal your evidence in your browser with AES-256-GCM and file only its commitment on Midnight. A 2-of-3 assessor committee votes on the claim on Midnight, then 2 of the 3 Cardano pool assessors co-sign a Settle that names the Midnight decision, and the validator pays exactly the coverage. A single assessor signature is rejected. Today all assessor seats are run by the team; outside assessors can enroll with the offline kit on the assessors page.",
        more: { href: "/docs/settlement#assessed", label: "Assessed claims" },
      },
      {
        id: "loss",
        q: "Does cover pay my actual loss?",
        a: "No. Depeg cover is parametric: it pays on the trigger, not on what you lost. A dip to 0.96, or a depeg that lasts less than 24 hours, pays nothing even if you lost money.",
        more: { href: "/docs/risks#buyer-risk", label: "Buyer risk" },
      },
      {
        id: "lost-wallet",
        q: "What if I lose my wallet or policy key?",
        a: "The Cardano policy user token is a bearer asset: whoever holds it can claim, so losing the wallet loses the claim right. Losing your private Midnight policy key means you can't prove cover or file a claim on Midnight, though the Cardano token is unaffected.",
        more: { href: "/docs/privacy#policy-key", label: "The policy key" },
      },
      {
        id: "expiry",
        q: "What happens if my policy expires unclaimed?",
        a: "Once expiry plus the claim grace period has passed, anyone can retire the policy. The roughly 2.5 ADA reference deposit goes back to the refund address you set when you bought, even if you later transferred the policy token.",
        more: { href: "/docs/how-cover-works#lifecycle", label: "Policy lifecycle" },
      },
    ],
  },
  {
    id: "privacy-trust",
    title: "Privacy and trust",
    items: [
      {
        id: "private",
        q: "What does Midnight keep private?",
        a: "Midnight holds commitments to the policy holder and the coverage, so a holder can prove they hold active cover of at least a chosen amount without revealing the exact amount or their key, and exploit evidence is filed only as a commitment to an encrypted bundle. Coverage amounts are still public on Cardano today.",
        more: { href: "/docs/privacy", label: "Privacy on Midnight" },
      },
      {
        id: "admin",
        q: "Who controls the protocol?",
        a: "There is no admin key and no pause on the Cardano validator: currencies, product terms, the oracle allowlist and quorum are fixed when it is deployed. You do trust the oracle feeds (on Preview one operator signs all three), the issuer that mirrors policies into Midnight, and the assessor committees for exploit claims.",
        more: { href: "/docs/risks#oracle-trust", label: "Oracle trust" },
      },
      {
        id: "audit",
        q: "Has it been audited?",
        a: "Not yet. The pre-audit pack lists what is in scope, maps every Cardano and Midnight invariant to the tests that check it, and names who holds which keys today.",
        more: { href: "/docs/security", label: "Security & audit scope" },
      },
    ],
  },
  {
    id: "underwriting",
    title: "Underwriting",
    items: [
      {
        id: "lp",
        q: "How do underwriters take part?",
        a: "Deposit ADA or USDC into that currency's tranche on the pool page and receive LP shares. Premiums raise the tranche's share value and claims lower it. Every live policy is backed one to one by LP capital, and a 90% utilization lock limits withdrawals while cover is outstanding.",
        more: { href: "/docs/underwriting-pool", label: "Underwriting pool" },
      },
      {
        id: "lp-risk",
        q: "What can an underwriter lose?",
        a: "LP capital pays claims, so a severe or correlated event can wipe out most of a tranche. Pricing parameters are starting assumptions rather than actuarial data, and there is no withdrawal delay beyond the utilization lock.",
        more: { href: "/docs/risks#lp-risk", label: "Underwriter risk" },
      },
    ],
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: GROUPS.flatMap((g) =>
    g.items.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  ),
};

export default function FaqPage() {
  return (
    <DocsLayout
      slug="faq"
      title="Frequently asked questions"
      description="Short, plain answers, each linked to the doc page that has the detail and the contract rule behind it."
      toc={GROUPS.map((g) => ({ id: g.id, label: g.title }))}
      sourcePaths={["packages/sdk/src/products.ts", "contracts/cardano/validators/cover.ak", "contracts/midnight/README.md"]}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      {GROUPS.map((g) => (
        <Section key={g.id} id={g.id} title={g.title}>
          <div className="flex flex-col gap-3">
            {g.items.map((f) => (
              <details
                key={f.id}
                id={f.id}
                className="glass group scroll-mt-28 rounded-2xl px-5 py-4 open:bg-white/[0.02]"
              >
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-[15px] font-medium text-text [&::-webkit-details-marker]:hidden">
                  <span>{f.q}</span>
                  <span
                    aria-hidden="true"
                    className="mt-0.5 text-text-dim transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <div className="mt-3 flex flex-col gap-2">
                  <P>{f.a}</P>
                  {f.more ? (
                    <p className="text-[13px]">
                      <DocLink href={f.more.href}>{f.more.label} →</DocLink>
                    </p>
                  ) : null}
                </div>
              </details>
            ))}
          </div>
        </Section>
      ))}
      <Callout tone="warn" title="Testnet only">
        <p>
          Everything here runs on Cardano Preview and Midnight Preprod with test value. Read{" "}
          <DocLink href="/docs/risks">Risks &amp; disclosures</DocLink> before relying on any of it.
        </p>
      </Callout>
    </DocsLayout>
  );
}
