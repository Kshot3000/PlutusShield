/**
 * Public underwriting book: every live Preview pool's product, scorecard,
 * capital and risk multiplier, baked at compile time from the same public
 * records the rest of the site mirrors (no keys):
 *
 *   USDM depeg          preview-deployment.json + preview-pool-snapshot.json
 *   Exploit cover v2    preview-exploit-v2.json + preview-exploit-v2-pool-snapshot.json
 *   Exploit cover v1    preview-exploit.json (legacy / frozen; capital still withdrawable)
 *
 * Scorecard answers and the scored tier come from the SDK's LIVE_SCORECARDS
 * (scoreRiskTier), so the book page and the SDK tests share one source.
 */
import { readPoolState, type ChainUtxo, type LiveTranche } from "@plutusshield/sdk/chain";
import {
  LIVE_POOL_RISK_MULT_BPS,
  LIVE_POOL_TIER,
  LIVE_SCORECARDS,
  liveBookBreakdown,
  scoreLiveBook,
  type LiveScorecard,
  type ScorecardProduct,
} from "@plutusshield/sdk";
import depegDeployment from "@/data/preview-deployment.json";
import depegSnapshot from "@/data/preview-pool-snapshot.json";
import exploitV2Snapshot from "@/data/preview-exploit-v2-pool-snapshot.json";
import { EXPLOIT_PREVIEW, EXPLOIT_PREVIEW_V1, type ExploitPool } from "@/lib/exploitPreview";
import { PREVIEW, PREVIEW_ASSETS } from "@/lib/preview";

export interface BookTranche {
  index: number;
  symbol: "ADA" | "USDC";
  ticker: string;
  decimals: number;
  capital: string;
  activeCover: string;
  freeCapacity: string;
  utilizationBps: number;
  totalShares: string;
}

export interface BookEntry {
  id: "usdm-depeg" | "exploit-v2" | "exploit-v1";
  /** False for frozen legacy pools kept for history. */
  live: boolean;
  product: ScorecardProduct;
  title: string;
  subtitle: string;
  network: string;
  riskTier: typeof LIVE_POOL_TIER;
  riskMultBps: number;
  baseRateBps: number;
  scorecard: LiveScorecard;
  breakdown: ReturnType<typeof liveBookBreakdown>;
  /** Points / max / share from scoreRiskTier (asserted ok + tier B). */
  scored: { points: number; maxPoints: number; share: number; uncappedTier: string };
  whyTier: string;
  address: string;
  scriptHash: string;
  initTx: string | null;
  /** Notable deploy txs (InitPool + a few follow-ups). */
  keyTxs: { label: string; hash: string; at?: string }[];
  tranches: BookTranche[];
  policyCount: number;
  snapshotTakenAt: string | null;
  maxUtilizationBps: number;
  /** Extra note (committee, legacy, etc.). */
  note: string;
  recordHref: string | null;
}

const assets = PREVIEW_ASSETS.map((a) => a.asset);

function trancheView(t: LiveTranche): BookTranche {
  const a = PREVIEW_ASSETS[t.index];
  return {
    index: t.index,
    symbol: a.symbol,
    ticker: a.ticker,
    decimals: a.decimals,
    capital: t.capital.toString(),
    activeCover: t.activeCover.toString(),
    freeCapacity: t.freeCapacity.toString(),
    utilizationBps: Number(t.utilizationBps),
    totalShares: t.totalShares.toString(),
  };
}

function fromSnapshot(
  utxos: ChainUtxo[],
  scriptHash: string,
  maxUtilizationBps: bigint,
): { tranches: BookTranche[]; policyCount: number } {
  const state = readPoolState(utxos, scriptHash, assets, maxUtilizationBps);
  return { tranches: state.tranches.map(trancheView), policyCount: state.policies.length };
}

function scoredOf(product: ScorecardProduct) {
  const r = scoreLiveBook(product);
  if (!r.ok) throw new Error(`live ${product} scorecard must score ok (got declined/missing)`);
  if (r.tier !== LIVE_POOL_TIER || r.riskMultBps !== LIVE_POOL_RISK_MULT_BPS) {
    throw new Error(`live ${product} scorecard must be tier B / ${LIVE_POOL_RISK_MULT_BPS} bps`);
  }
  return { points: r.points, maxPoints: r.maxPoints, share: r.share, uncappedTier: r.uncappedTier };
}

function exploitKeyTxs(pool: ExploitPool) {
  const prefer = ["InitPool", "Deposit", "Buy", "Settle"];
  const picked: { label: string; hash: string; at?: string }[] = [];
  for (const p of prefer) {
    const hit = pool.txs.find((t) => t.label.startsWith(p));
    if (hit && !picked.some((x) => x.hash === hit.hash)) picked.push({ label: hit.label, hash: hit.hash, at: hit.at });
  }
  return picked.slice(0, 5);
}

const depegMaxUtil = BigInt(depegDeployment.maxUtilizationBps ?? PREVIEW.maxUtilizationBps);
const depegSnap = fromSnapshot(depegSnapshot.utxos as ChainUtxo[], PREVIEW.scriptHash, depegMaxUtil);
const depegCard = LIVE_SCORECARDS.depeg;

const depegEntry: BookEntry = {
  id: "usdm-depeg",
  live: true,
  product: "depeg",
  title: "USDM depeg pool",
  subtitle: "Parametric stablecoin depeg cover · multi-oracle TWAP below 0.95 for 24h",
  network: "Cardano Preview",
  riskTier: LIVE_POOL_TIER,
  riskMultBps: LIVE_POOL_RISK_MULT_BPS,
  baseRateBps: Number(depegDeployment.params.product.baseRateBps),
  scorecard: depegCard,
  breakdown: liveBookBreakdown("depeg"),
  scored: scoredOf("depeg"),
  whyTier: depegCard.whyTier,
  address: PREVIEW.poolAddress,
  scriptHash: PREVIEW.scriptHash,
  initTx: PREVIEW.initTx,
  keyTxs: [{ label: "InitPool", hash: PREVIEW.initTx }],
  tranches: depegSnap.tranches,
  policyCount: depegSnap.policyCount,
  snapshotTakenAt: depegSnapshot.takenAt,
  maxUtilizationBps: Number(depegMaxUtil),
  note: "Pays only through the on-chain oracle quorum. No assessor vote. Sale circuit-breaker closes Buys if the feeds go stale or the peg breaks.",
  recordHref: "https://github.com/Kshot3000/PlutusShield/blob/main/contracts/cardano/deploy/deployments/preview.json",
};

const exploitV2Snap = fromSnapshot(
  exploitV2Snapshot.utxos as ChainUtxo[],
  EXPLOIT_PREVIEW.scriptHash,
  9_000n,
);
const exploitCard = LIVE_SCORECARDS.exploit;

const exploitV2Entry: BookEntry = {
  id: "exploit-v2",
  live: true,
  product: "exploit",
  title: "Exploit-cover v2 · 2-of-3 committee",
  subtitle: "Smart-contract exploit cover · Midnight evidence vault + Cardano Settle by 2 of 3 assessors",
  network: "Cardano Preview + Midnight Preprod",
  riskTier: LIVE_POOL_TIER,
  riskMultBps: LIVE_POOL_RISK_MULT_BPS,
  baseRateBps: EXPLOIT_PREVIEW.baseRateBps,
  scorecard: exploitCard,
  breakdown: liveBookBreakdown("exploit"),
  scored: scoredOf("exploit"),
  whyTier: exploitCard.whyTier,
  address: EXPLOIT_PREVIEW.address,
  scriptHash: EXPLOIT_PREVIEW.scriptHash,
  initTx: EXPLOIT_PREVIEW.initTx,
  keyTxs: exploitKeyTxs(EXPLOIT_PREVIEW),
  tranches: exploitV2Snap.tranches,
  policyCount: exploitV2Snap.policyCount,
  snapshotTakenAt: exploitV2Snapshot.takenAt,
  maxUtilizationBps: 9_000,
  note: `Settle needs ${EXPLOIT_PREVIEW.quorumLabel} assessor-committee signatures after the Midnight Preprod claim is resolved APPROVED. No single key can release capital.`,
  recordHref: EXPLOIT_PREVIEW.record,
};

/** Frozen v1 exploit pool: same scorecard / tier; capital still withdrawable, no new sales assumed. */
const exploitV1Entry: BookEntry = {
  id: "exploit-v1",
  live: false,
  product: "exploit",
  title: "Exploit-cover v1 · single assessor (legacy)",
  subtitle: "First exploit pool on Preview · Settle needed the single assessor key · kept as history",
  network: "Cardano Preview",
  riskTier: LIVE_POOL_TIER,
  riskMultBps: LIVE_POOL_RISK_MULT_BPS,
  baseRateBps: EXPLOIT_PREVIEW_V1.baseRateBps,
  scorecard: exploitCard,
  breakdown: liveBookBreakdown("exploit"),
  scored: scoredOf("exploit"),
  whyTier: exploitCard.whyTier,
  address: EXPLOIT_PREVIEW_V1.address,
  scriptHash: EXPLOIT_PREVIEW_V1.scriptHash,
  initTx: EXPLOIT_PREVIEW_V1.initTx,
  keyTxs: exploitKeyTxs(EXPLOIT_PREVIEW_V1),
  tranches: [], // no fresh snapshot mirrored for v1; capital is still on the frozen script
  policyCount: EXPLOIT_PREVIEW_V1.policies.length,
  snapshotTakenAt: null,
  maxUtilizationBps: 9_000,
  note: "Superseded by v2. LP capital remains withdrawable via the frozen script; new cover is sold from the v2 committee pool.",
  recordHref: EXPLOIT_PREVIEW_V1.record,
};

export const UNDERWRITING_BOOK = {
  entries: [depegEntry, exploitV2Entry, exploitV1Entry] as BookEntry[],
  live: [depegEntry, exploitV2Entry] as BookEntry[],
  stats: {
    livePools: 2,
    legacyPools: 1,
    tier: LIVE_POOL_TIER,
    riskMultBps: LIVE_POOL_RISK_MULT_BPS,
  },
};

/** Format base units with the tranche decimals (same shape as LivePool). */
export const formatBookAmount = (raw: string, decimals: number, digits = 2) => {
  const n = Number(raw) / 10 ** decimals;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
};

export const pctBps = (bps: number, d = 2) => `${(bps / 100).toFixed(d)}%`;
