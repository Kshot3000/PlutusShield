/**
 * The public claims register: every claim PlutusShield has decided, across
 * both chains, built at compile time from the same public records the rest of
 * the site mirrors (no keys, no holder secrets):
 *
 *   Cardano Preview  preview-exploit.json / preview-exploit-v2.json  (Buy, Settle, refused Settle attempts)
 *   Midnight Preprod midnight-preprod-v1.json / -v2.json + activity    (fileClaim, resolveClaim / voteClaim)
 *   Oracle           preview-oracle-history.json                     (why no depeg claim has paid)
 *
 * One row per policy that reached a decision. Rows are testnet drills on test
 * policies; nothing here is a real exploit or a real loss.
 */
import { EXPLOIT_POOLS, type ExploitPool } from "@/lib/exploitPreview";
import { MIDNIGHT_PREPROD } from "@/lib/midnightPreprod";
import { MIDNIGHT_V2 } from "@/lib/midnightPreprodV2";
import v1Activity from "@/data/midnight-preprod-activity.json";
import v2Activity from "@/data/midnight-preprod-v2-activity.json";
import oracleHistory from "@/data/preview-oracle-history.json";
import depegDeployment from "@/data/preview-deployment.json";

export type ClaimProduct = "exploit" | "depeg";
export type ClaimOutcome = "paid" | "approved" | "denied";

export interface RegisterStep {
  chain: "Cardano" | "Midnight";
  label: string;
  txHash: string;
  /** Block height (Midnight) when the record has it. */
  block?: number | null;
  /** ms since epoch, when a public record dates it. */
  at?: number | null;
  note?: string;
}

export interface ClaimRow {
  policyId: string;
  product: ClaimProduct;
  outcome: ClaimOutcome;
  /** "Midnight v1 · single assessor" / "Midnight v2 · 2-of-3 committee". */
  decidedBy: string;
  filedBy: "holder" | "operator";
  coverageLovelace: string | null;
  payoutLovelace: string | null;
  /** The committee seats' votes (v2 registry only), in seat order. */
  votes: { seat: number; approved: boolean }[];
  /** Cardano Settle signers (assessor names) when paid. */
  settleSigners: string[];
  settleQuorum: string | null;
  steps: RegisterStep[];
  /** Latest dated step: used to sort newest first. */
  decidedAt: number | null;
  note: string;
}

export interface RefusedSettle {
  policyId: string;
  at: number;
  signatures: number;
  threshold: number;
  evaluators: string[];
  note: string;
}

type Action = { entryPoint: string; txHash: string; height: number; timestamp: number };
const actions = [...(v1Activity.actions as Action[]), ...(v2Activity.actions as Action[])];
const atOf = (hash: string | null | undefined) => (hash ? (actions.find((a) => a.txHash === hash)?.timestamp ?? null) : null);
const blockOf = (hash: string | null | undefined) => (hash ? (actions.find((a) => a.txHash === hash)?.height ?? null) : null);

/** When a Cardano tx landed, from the pool record's "<iso time> <action>" labels. */
const cardanoAt = (pool: ExploitPool, hash: string) => {
  const t = pool.txs.find((x) => x.hash === hash)?.at;
  return t ? Date.parse(t) : null;
};

function exploitRows(): ClaimRow[] {
  const rows: ClaimRow[] = [];
  for (const pool of EXPLOIT_POOLS as ExploitPool[]) {
    for (const p of pool.policies) {
      const m = p.midnight;
      if (!m) continue;
      const vote = m.committeeVote;
      const resolve = m.resolveClaim;
      const approved = vote ? true : !!resolve?.approved;
      const steps: RegisterStep[] = [
        { chain: "Cardano", label: "Buy", txHash: p.buyTx, at: cardanoAt(pool, p.buyTx) },
      ];
      const fileHash = m.fileClaim?.txHash ?? null;
      if (fileHash) steps.push({ chain: "Midnight", label: "fileClaim", txHash: fileHash, block: m.fileClaim?.block ?? blockOf(fileHash), at: atOf(fileHash) });
      if (vote) {
        for (const a of vote.approvals)
          steps.push({ chain: "Midnight", label: `voteClaim · seat ${a.seat} approves`, txHash: a.txHash, block: a.block ?? blockOf(a.txHash), at: atOf(a.txHash) });
      } else if (resolve) {
        steps.push({ chain: "Midnight", label: `resolveClaim · ${resolve.approved ? "approved" : "rejected"}`, txHash: resolve.txHash, block: resolve.block, at: atOf(resolve.txHash) });
      }
      if (p.settleTx)
        steps.push({
          chain: "Cardano",
          label: "Settle",
          txHash: p.settleTx,
          at: p.settledAt ? Date.parse(p.settledAt) : cardanoAt(pool, p.settleTx),
          note: pool.version === "v1" ? "single assessor" : `${pool.quorumLabel} committee`,
        });
      const registry = m.registry === "policy-cover-v2" || vote ? "v2" : "v1";
      rows.push({
        policyId: p.policyId,
        product: "exploit",
        outcome: p.settleTx ? "paid" : approved ? "approved" : "denied",
        decidedBy: registry === "v2" ? `Midnight v2 · ${MIDNIGHT_V2.quorumLabel} committee` : "Midnight v1 · single assessor",
        filedBy: m.filedBy === "holder-claim-kit" ? "holder" : "operator",
        coverageLovelace: p.coverage,
        payoutLovelace: p.payout ?? null,
        votes: vote ? vote.approvals.map((a) => ({ seat: a.seat, approved: true })) : [],
        settleSigners: p.signedBy?.map((s) => s.name) ?? (p.settleTx && pool.version === "v1" ? ["assessor"] : []),
        settleQuorum: p.settleTx ? (pool.version === "v1" ? "single assessor" : pool.quorumLabel) : null,
        steps,
        decidedAt: steps.reduce<number | null>((t, s) => (s.at != null && (t == null || s.at > t) ? s.at : t), null),
        note:
          m.filedBy === "holder-claim-kit"
            ? "Filed by the holder from their own claim kit; the operator never held the policy key."
            : pool.version === "v1"
              ? "First exploit pool: Settle needed the single assessor's signature."
              : "Decided on the v1 Midnight registry, then paid by the 2-of-3 Cardano committee.",
      });
    }
  }
  return rows;
}

/** Registry drills on depeg test policies: decided on Midnight, never paid on Cardano (depeg pays only through the oracle). */
function depegDrillRows(): ClaimRow[] {
  const v1: ClaimRow[] = MIDNIGHT_PREPROD.claimsDrill.map((d) => {
    const steps: RegisterStep[] = [
      { chain: "Cardano", label: "Buy", txHash: d.cardanoBuyTx },
      { chain: "Midnight", label: "fileClaim", txHash: d.fileClaim.txHash, block: d.fileClaim.block, at: atOf(d.fileClaim.txHash) },
      {
        chain: "Midnight",
        label: `resolveClaim · ${d.resolveClaim.approved ? "approved" : "rejected"}`,
        txHash: d.resolveClaim.txHash,
        block: d.resolveClaim.block,
        at: atOf(d.resolveClaim.txHash),
      },
    ];
    return {
      policyId: d.policyId,
      product: "depeg",
      outcome: d.resolveClaim.approved ? "approved" : "denied",
      decidedBy: "Midnight v1 · single assessor",
      filedBy: "operator",
      coverageLovelace: null,
      payoutLovelace: null,
      votes: [],
      settleSigners: [],
      settleQuorum: null,
      steps,
      decidedAt: atOf(d.resolveClaim.txHash),
      note: d.resolveClaim.approved
        ? "Registry drill: the assessor approved, and the policy moved to PAID on Midnight."
        : "Registry drill: the assessor rejected the evidence, and the policy went back to ACTIVE.",
    };
  });
  const exploitIds = new Set(EXPLOIT_POOLS.flatMap((p) => p.policies.map((x) => x.policyId)));
  const v2: ClaimRow[] = MIDNIGHT_V2.claims
    .filter((c) => !exploitIds.has(c.policyId) && c.decided)
    .map((c) => {
      const steps: RegisterStep[] = [];
      if (c.buyTx) steps.push({ chain: "Cardano", label: "Buy", txHash: c.buyTx });
      if (c.fileClaim) steps.push({ chain: "Midnight", label: "fileClaim", txHash: c.fileClaim.txHash, block: c.fileClaim.block, at: atOf(c.fileClaim.txHash) });
      for (const v of c.votes)
        steps.push({ chain: "Midnight", label: `voteClaim · seat ${v.seat} ${v.approved ? "approves" : "rejects"}`, txHash: v.txHash, block: v.block, at: atOf(v.txHash) });
      const rejections = c.votes.filter((v) => !v.approved).length;
      return {
        policyId: c.policyId,
        product: "depeg",
        outcome: c.decided === "PAID" ? "approved" : "denied",
        decidedBy: `Midnight v2 · ${MIDNIGHT_V2.quorumLabel} committee`,
        filedBy: "operator",
        coverageLovelace: null,
        payoutLovelace: null,
        votes: c.votes.map((v) => ({ seat: v.seat, approved: v.approved })),
        settleSigners: [],
        settleQuorum: null,
        steps,
        decidedAt: steps.reduce<number | null>((t, s) => (s.at != null && (t == null || s.at > t) ? s.at : t), null),
        note: rejections
          ? `Split vote drill: ${c.votes.length - rejections} approvals and ${rejections} rejection, so ${MIDNIGHT_V2.quorumLabel} still decides it.`
          : "Committee drill on the v2 registry.",
      };
    });
  return [...v1, ...v2];
}

const allRows = [...exploitRows(), ...depegDrillRows()].sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0));

const refused: RefusedSettle[] = EXPLOIT_POOLS.flatMap((pool) =>
  pool.rejections.map((r) => ({
    policyId: r.policyId,
    at: Date.parse(r.at),
    signatures: r.committeeSignatures,
    threshold: r.threshold,
    evaluators: r.results.filter((x) => x.rejected).map((x) => x.evaluator),
    note: r.note,
  })),
);

const publishes = (oracleHistory as { publishes: { at: string; bps: number; tx: string; live?: boolean }[] }).publishes;
const livePublishes = publishes.filter((p) => p.live);
const lowest = livePublishes.reduce((m, p) => (p.bps < m.bps ? p : m), livePublishes[0]);
/** The depeg trigger: a quorum 24-hour TWAP below 0.95 (validators/oracle.ak). */
const TRIGGER_BPS = Number(depegDeployment.params.product.trigger.thresholdBps);

const sum = (xs: (string | null)[]) => xs.reduce((t, x) => t + (x ? BigInt(x) : 0n), 0n);

export const CLAIMS_REGISTER = {
  rows: allRows,
  refused,
  stats: {
    decided: allRows.length,
    approved: allRows.filter((r) => r.outcome !== "denied").length,
    denied: allRows.filter((r) => r.outcome === "denied").length,
    paidOnCardano: allRows.filter((r) => r.outcome === "paid").length,
    paidLovelace: sum(allRows.filter((r) => r.outcome === "paid").map((r) => r.payoutLovelace)).toString(),
    holderFiled: allRows.filter((r) => r.filedBy === "holder").length,
    refusedSettles: refused.length,
  },
  oracle: {
    livePublishes: livePublishes.length,
    lowestBps: lowest?.bps ?? null,
    lowestAt: lowest?.at ?? null,
    lowestTx: (lowest as { tx?: string } | undefined)?.tx ?? null,
    triggerBps: TRIGGER_BPS,
    /** True once any live publish has crossed the trigger; until then no depeg claim can settle. */
    everTriggered: livePublishes.some((p) => p.bps < TRIGGER_BPS),
  },
};
