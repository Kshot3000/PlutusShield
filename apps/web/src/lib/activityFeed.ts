/**
 * The Atom activity feed at /feed.xml: every decided claim, every refused
 * Settle and the newest live oracle publishes, built from the same records as
 * /claims and /oracle (and the open-data JSON), so it cannot drift from them.
 */
import { ATOM_PATH, activityTagId, buildAtomFeed, type AtomEntry } from "@plutusshield/sdk";
import oracleHistory from "@/data/preview-oracle-history.json";
import depegDeployment from "@/data/preview-deployment.json";
import { CLAIMS_REGISTER } from "@/lib/claimsRegister";
import { MIDNIGHT_EXPLORER } from "@/lib/midnightPreprod";
import { explorerTx } from "@/lib/preview";
import { SITE_ROOT } from "@/lib/openData";

/** Newest live oracle publishes kept in the feed (the full history is in api/v1/oracle.json). */
export const FEED_ORACLE_LIMIT = 24;

const tada = (lovelace: string | null) => (lovelace == null ? null : `${(Number(lovelace) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 })} tADA`);
const short = (h: string) => `${h.slice(0, 8)}…`;
const iso = (t: number) => new Date(t).toISOString();
const midnightTx = (hash: string) => `${MIDNIGHT_EXPLORER}/transactions/0x${hash.replace(/^0x/i, "")}`;
const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
const PRODUCT = { exploit: "Smart-contract exploit cover", depeg: "USDM depeg cover" } as const;

const claimEntries = (): AtomEntry[] =>
  CLAIMS_REGISTER.rows
    .filter((r) => r.decidedAt != null)
    .map((r) => {
      const verb = r.outcome === "paid" ? "paid" : r.outcome === "approved" ? "approved" : "denied";
      const payout = r.outcome === "paid" ? tada(r.payoutLovelace) : null;
      const votes = r.votes.length ? ` Committee votes from seats ${r.votes.map((v) => v.seat).join(" + ")}.` : "";
      const settle = r.settleSigners.length ? ` Cardano Settle signed by ${r.settleSigners.join(" + ")} (${r.settleQuorum}).` : "";
      return {
        id: activityTagId("claim", `${r.product}-${r.policyId}`),
        title: `Claim ${verb}: ${PRODUCT[r.product]}, policy ${short(r.policyId)}${payout ? `, ${payout} paid` : ""}`,
        updated: iso(r.decidedAt!),
        link: `${SITE_ROOT}/policy/?id=${r.policyId}`,
        related: [
          { href: `${SITE_ROOT}/claims/`, title: "Claims register" },
          ...r.steps.slice(-2).map((s) => ({
            href: s.chain === "Cardano" ? explorerTx(s.txHash) : midnightTx(s.txHash),
            title: `${s.chain} ${s.label}`,
          })),
        ],
        summary: `${PRODUCT[r.product]} claim ${verb}, decided by ${r.decidedBy}, filed by the ${r.filedBy}.${votes}${settle} ${r.note}`.replace(/\s+/g, " ").trim(),
        kind: "claim",
        categories: [r.product, ...new Set(r.steps.map((s) => s.chain.toLowerCase()))],
      };
    });

const refusedEntries = (): AtomEntry[] =>
  CLAIMS_REGISTER.refused.map((r) => ({
    id: activityTagId("refused-settle", `${r.policyId}-${r.at}`),
    title: `Settle refused: ${r.signatures} assessor signature(s), ${r.threshold} required, policy ${short(r.policyId)}`,
    updated: iso(r.at),
    link: `${SITE_ROOT}/claims/`,
    summary: `A Settle carrying ${r.signatures} assessor signature(s), below the ${r.threshold}-signature threshold, was rejected by ${r.evaluators.join(" and ")}. ${r.note}`.trim(),
    kind: "refused-settle",
    categories: ["exploit", "cardano"],
  }));

type Publish = { at: string; bps: number; tx: string; live?: boolean };
const triggerBps = Number(depegDeployment.params.product.trigger.thresholdBps);

const oracleEntries = (): AtomEntry[] =>
  (oracleHistory.publishes as Publish[])
    .filter((p) => p.live)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, FEED_ORACLE_LIMIT)
    .map((p) => ({
      id: activityTagId("oracle", p.tx),
      title: `Oracle: USDM 24h TWAP ${pct(p.bps)} of peg on Cardano Preview`,
      updated: new Date(p.at).toISOString(),
      link: `${SITE_ROOT}/oracle/`,
      related: [{ href: explorerTx(p.tx), title: "Publish transaction" }],
      summary: `The relay published ${p.bps} bps to all three Preview feeds (trigger ${pct(triggerBps)}). ${p.bps <= triggerBps ? "At or below the depeg trigger: cover sales pause and claims can settle." : "Above the trigger: cover sales stay open."}`,
      kind: "oracle",
      categories: ["depeg", "cardano"],
    }));

export const activityEntries = (): AtomEntry[] => [...claimEntries(), ...refusedEntries(), ...oracleEntries()];

export const FEED_URL = `${SITE_ROOT}/${ATOM_PATH}`;

export const activityFeedXml = () =>
  buildAtomFeed({
    id: FEED_URL,
    title: "PlutusShield activity (Cardano Preview + Midnight Preprod)",
    subtitle: "Claim decisions, refused settlements and oracle publishes from PlutusShield's testnet cover pools. Testnet only, not audited.",
    link: `${SITE_ROOT}/`,
    self: FEED_URL,
    author: { name: "Kshot", uri: "https://x.com/kshot9000" },
    rights: "Public testnet records. Code: MIT, Apache-2.0 under contracts/midnight.",
    entries: activityEntries(),
  });
