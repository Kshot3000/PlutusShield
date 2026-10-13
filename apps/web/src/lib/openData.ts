/**
 * Builds the public open-data feeds served at /api/v1/*.json (see
 * packages/sdk/src/openData.ts for the envelope and the endpoint list). The
 * payloads are the exact objects /products, /claims, /book and /oracle render
 * from, plus explorer URLs, so the JSON can never drift from the pages. The
 * plan feed is a static example of planCover + shareable /plan deep links.
 */
import {
  OPEN_DATA_ENDPOINTS,
  OPEN_DATA_VERSION,
  openDataEnvelope,
  openDataJson,
  openDataUrl,
  planCover,
  planShareQuery,
  type OpenDataset,
  type PlanShareState,
} from "@plutusshield/sdk";
import { PLANNER_POOLS, PLANNER_SNAPSHOT_AT } from "@/lib/coverPlanner";
import oracleHistory from "@/data/preview-oracle-history.json";
import depegDeployment from "@/data/preview-deployment.json";
import { CLAIMS_REGISTER } from "@/lib/claimsRegister";
import { MIDNIGHT_EXPLORER } from "@/lib/midnightPreprod";
import { explorerAddress, explorerTx } from "@/lib/preview";
import { CATALOG_STATS, PRODUCTS_CATALOG } from "@/lib/productsCatalog";
import { UNDERWRITING_BOOK } from "@/lib/underwritingBook";

export const SITE_ROOT =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.NEXT_PUBLIC_BASE_PATH ? `https://kshot3000.github.io${process.env.NEXT_PUBLIC_BASE_PATH}` : "https://kshot3000.github.io/PlutusShield");

/** One build time for every file, so a consumer can tell the datasets belong together. */
export const GENERATED_AT = new Date().toISOString();

/** Absolute site URL, with the trailing slash the static export serves pages at ("/cover#x" -> "/cover/#x"). */
const abs = (href: string) => {
  if (/^https?:/.test(href)) return href;
  const [path, hash] = href.split("#");
  const p = path.startsWith("/") ? path : `/${path}`;
  const slashed = p.endsWith("/") || /\.[a-z0-9]+$/i.test(p) ? p : `${p}/`;
  return `${SITE_ROOT}${slashed}${hash === undefined ? "" : `#${hash}`}`;
};
const midnightTx = (hash: string) => `${MIDNIGHT_EXPLORER}/transactions/0x${hash.replace(/^0x/i, "")}`;

const products = () => ({
  stats: CATALOG_STATS,
  products: PRODUCTS_CATALOG.map(({ product: p, statusLabel, baseRatePct, tierRange, deployed }) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    statusLabel,
    chain: p.chain,
    tagline: p.tagline,
    covers: p.covers,
    trigger: p.trigger,
    source: p.source,
    privacy: p.privacy,
    settlementModel: p.settlementModel,
    settlement: p.settlement,
    claimModel: p.claimModel,
    saleGuard: p.saleGuard,
    premiumCurrencies: p.premiumCurrencies,
    plannedCurrencies: p.plannedCurrencies,
    termDays: { min: p.minDays, max: p.maxDays },
    baseAnnualRate: p.baseAnnualRate,
    baseRatePctTierB: baseRatePct,
    tierRange,
    blocker: p.blocker,
    buyUrl: p.buy ? abs(p.buy.href) : null,
    quoteUrl: abs(p.quote.href),
    pageUrl: `${SITE_ROOT}/products/#${p.id}`,
    deployed: deployed && {
      ...deployed,
      addressUrl: explorerAddress(deployed.address),
      bookUrl: `${SITE_ROOT}/book/#${deployed.bookId}`,
    },
  })),
});

const claims = () => ({
  stats: CLAIMS_REGISTER.stats,
  oracle: {
    ...CLAIMS_REGISTER.oracle,
    lowestTxUrl: CLAIMS_REGISTER.oracle.lowestTx ? explorerTx(CLAIMS_REGISTER.oracle.lowestTx) : null,
  },
  claims: CLAIMS_REGISTER.rows.map((r) => ({
    ...r,
    decidedAt: r.decidedAt === null ? null : new Date(r.decidedAt).toISOString(),
    steps: r.steps.map((s) => ({
      ...s,
      at: s.at ? new Date(s.at).toISOString() : null,
      txUrl: s.chain === "Cardano" ? explorerTx(s.txHash) : midnightTx(s.txHash),
    })),
  })),
  refusedSettles: CLAIMS_REGISTER.refused.map((r) => ({ ...r, at: new Date(r.at).toISOString() })),
});

const book = () => ({
  stats: UNDERWRITING_BOOK.stats,
  pools: UNDERWRITING_BOOK.entries.map((e) => ({
    ...e,
    addressUrl: explorerAddress(e.address),
    pageUrl: `${SITE_ROOT}/book/#${e.id}`,
  })),
});

type Publish = { at: string; bps: number; tx: string; live?: boolean };

const oracle = () => {
  const pubs = [...(oracleHistory.publishes as Publish[])].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const live = pubs.filter((p) => p.live);
  return {
    asset: "USDM",
    window: "24-hour TWAP",
    feeds: oracleHistory.feeds,
    quorum: "2 of 3 feeds to settle; every feed healthy to sell",
    triggerBps: Number(depegDeployment.params.product.trigger.thresholdBps),
    latest: live[0] ? { ...live[0], txUrl: explorerTx(live[0].tx) } : null,
    lowest: CLAIMS_REGISTER.oracle.lowestBps,
    everTriggered: CLAIMS_REGISTER.oracle.everTriggered,
    publishes: pubs.map((p) => ({ at: p.at, bps: p.bps, live: p.live === true, tx: p.tx, txUrl: explorerTx(p.tx) })),
    note: "Readings are published by one PlutusShield relay signing for all three Preview feeds; independent feed operators are still to come. The site rebuilds this file on each deploy, so the newest on-chain reading may be later than `latest`.",
  };
};


const SAMPLE_SHARE: PlanShareState = {
  currency: "ADA",
  days: 90,
  exposures: [
    { label: "USDM in a DEX pool", product: "depeg", amount: 250, protectPct: 100 },
    { label: "DEX LP position", product: "exploit", amount: 300, protectPct: 80 },
    { label: "Lending deposit", product: "exploit", amount: 200, protectPct: 50 },
  ],
};

const plan = () => {
  const pools = PLANNER_POOLS[SAMPLE_SHARE.currency];
  const shareQuery = planShareQuery(SAMPLE_SHARE);
  const result = planCover({
    exposures: SAMPLE_SHARE.exposures.map((e, i) => ({
      id: `ex${i}`,
      label: e.label,
      product: e.product,
      amount: e.amount,
      protectShare: e.protectPct / 100,
    })),
    days: SAMPLE_SHARE.days,
    riskTier: "B",
    pools: { depeg: pools.depeg, exploit: pools.exploit, sla: null },
  });
  return {
    howTo: {
      sdk: 'import { planCover, encodePlanShare, decodePlanShare, planShareQuery } from "@plutusshield/sdk"',
      shareParams: "c (ADA|USDC), d (term days), x (label|product|amount|protectPct) one per exposure",
      planPage: `${SITE_ROOT}/plan/`,
      exampleDeepLink: `${SITE_ROOT}/plan/?${shareQuery}`,
    },
    example: {
      shareQuery,
      input: SAMPLE_SHARE,
      riskTier: "B",
      pools: { depeg: pools.depeg, exploit: pools.exploit },
      poolSnapshotAt: PLANNER_SNAPSHOT_AT,
      plan: result,
    },
    note: "The example plan is priced at site build time against the same Preview tranche snapshot /plan uses. Re-run planCover yourself for a fresh quote; this file is a static illustration, not an offer. Testnet only, not audited.",
  };
};

const index = () => ({
  version: OPEN_DATA_VERSION,
  docs: `${SITE_ROOT}/docs/api/`,
  license: "Data comes from public testnet records. Code: MIT at the repository root, Apache-2.0 under contracts/midnight (see README, License).",
  datasets: OPEN_DATA_ENDPOINTS.map((e) => ({ ...e, url: openDataUrl(SITE_ROOT, e.dataset), page: e.page ? `${SITE_ROOT}/${e.page}/` : null })),
});

const BUILDERS: Record<OpenDataset, () => unknown> = { index, products, claims, book, oracle, plan };

export const openDataPayload = (dataset: OpenDataset) =>
  openDataEnvelope(dataset, BUILDERS[dataset](), { generatedAt: GENERATED_AT, siteRoot: SITE_ROOT });

/** Static JSON response for a route handler under app/api/v1. */
export const openDataResponse = (dataset: OpenDataset) =>
  new Response(openDataJson(openDataPayload(dataset)) + "\n", {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
