/**
 * One policy's whole journey across both chains, stitched from records the
 * repo already ships (no invented values):
 *
 *   Cardano Preview  Buy (policy datum)    pool UTxOs (live / build snapshot), exploit-pool records
 *                    ticket (metadata 7731) relay plan snapshot, or the Buy tx metadata read live
 *   Midnight Preprod registerPolicy        v1 / v2 contract actions (live indexer / snapshot) + relay records
 *                    proveCover            relay records (preprod.json, preprod-v2.json)
 *                    fileClaim / votes     contract actions + v2 committee record
 *   Cardano Preview  Settle / release      exploit-pool records, or the policy reference token burn read live
 *
 * Pure functions: the /policy page feeds them live or snapshot inputs.
 */
import type { LivePolicy } from "@plutusshield/sdk/chain";
import type { MidnightAction } from "@/lib/midnightIndexer";
import { PREVIEW_ASSETS } from "@/lib/preview";
import { EXPLOIT_PREVIEW, EXPLOIT_PREVIEW_V1, allExploitPolicies } from "@/lib/exploitPreview";
import { MIDNIGHT_V2 } from "@/lib/midnightPreprodV2";
import { RELAY_SNAPSHOT, type RelayPolicy } from "@/lib/useMidnightActivity";
import v1Record from "@/data/midnight-preprod-v1.json";
import v2Record from "@/data/midnight-preprod-v2.json";

type RecTx = { txHash?: string | null; blockHeight?: number | null } | undefined;
type V1Raw = {
  contractAddress: string;
  registrations?: { policyId: string; source?: string; cardano?: { buyTx?: string; coverage?: string; expiry?: string }; registerPolicy?: RecTx; proveCover?: RecTx }[];
};
const V1 = v1Record as unknown as V1Raw;
const V2_REG = (MIDNIGHT_V2 as unknown as { registrations: { policyId: string; registerPolicy: { txHash: string; block: number | null } | null; proveCover: { txHash: string; block: number | null } | null }[] }).registrations;
type V2RawReg = { policyId: string; source?: string; cardano?: { buyTx?: string; coverage?: string; expiry?: string } };
const V2_RAW = (v2Record as unknown as { registrations?: V2RawReg[] }).registrations ?? [];

export const V1_CONTRACT = V1.contractAddress;
export const V2_CONTRACT = MIDNIGHT_V2.contractAddress ?? "";

export type Product = "depeg" | "exploit-v1" | "exploit-v2";

export interface KnownPolicy {
  policyId: string;
  buyTx: string | null;
  product: Product;
  /** Base units of the premium asset (lovelace or tUSDCx micro-units). */
  coverage: string | null;
  premium: string | null;
  ticker: string | null;
  start: number | null;
  expiry: number | null;
  /** ms; when the Buy landed, when known. */
  boughtAt: number | null;
  /** Policy datum still open at the cover script (in the read we have). */
  openOnCardano: boolean;
}

const norm = (h: string) => h.trim().toLowerCase().replace(/^0x/, "");

/**
 * Every policy the site knows about, newest first, deduplicated by policy id.
 * `livePolicies` are read at the depeg cover script; `liveExploit` at the
 * exploit-cover v2 script (so a policy bought in the browser shows up before
 * any deployment record mentions it).
 */
export function knownPolicies(livePolicies: LivePolicy[] | null, liveExploit: LivePolicy[] | null = null): KnownPolicy[] {
  const out = new Map<string, KnownPolicy>();
  const put = (p: KnownPolicy) => {
    const prev = out.get(p.policyId);
    if (!prev) out.set(p.policyId, p);
    else
      out.set(p.policyId, {
        ...prev,
        buyTx: prev.buyTx ?? p.buyTx,
        coverage: prev.coverage ?? p.coverage,
        premium: prev.premium ?? p.premium,
        ticker: prev.ticker ?? p.ticker,
        start: prev.start ?? p.start,
        expiry: prev.expiry ?? p.expiry,
        boughtAt: prev.boughtAt ?? p.boughtAt,
        openOnCardano: prev.openOnCardano || p.openOnCardano,
      });
  };
  for (const lp of livePolicies ?? []) {
    const a = PREVIEW_ASSETS[lp.tranche];
    put({
      policyId: lp.policy.policyId.toLowerCase(),
      buyTx: lp.ref.split("#")[0],
      product: "depeg",
      coverage: lp.policy.coverage.toString(),
      premium: lp.policy.premium.toString(),
      ticker: a?.ticker ?? null,
      start: Number(lp.policy.start),
      expiry: Number(lp.policy.expiry),
      boughtAt: lp.blockTime ? lp.blockTime * 1000 : null,
      openOnCardano: true,
    });
  }
  for (const lp of liveExploit ?? []) {
    const a = PREVIEW_ASSETS[lp.tranche];
    put({
      policyId: lp.policy.policyId.toLowerCase(),
      buyTx: lp.ref.split("#")[0],
      product: "exploit-v2",
      coverage: lp.policy.coverage.toString(),
      premium: lp.policy.premium.toString(),
      ticker: a?.ticker ?? null,
      start: Number(lp.policy.start),
      expiry: Number(lp.policy.expiry),
      boughtAt: lp.blockTime ? lp.blockTime * 1000 : null,
      openOnCardano: true,
    });
  }
  for (const e of allExploitPolicies()) {
    put({
      policyId: e.policyId.toLowerCase(),
      buyTx: e.buyTx,
      product: e.pool.version === "v2" ? "exploit-v2" : "exploit-v1",
      coverage: e.coverage,
      premium: e.premium,
      ticker: e.asset === "lovelace" ? "tADA" : e.asset,
      start: Number(e.start),
      expiry: Number(e.expiry),
      boughtAt: Number(e.start) || null,
      openOnCardano: !e.settleTx,
    });
  }
  for (const r of RELAY_SNAPSHOT.policies) {
    put({
      policyId: r.policyId,
      buyTx: r.buyTx,
      product: "depeg",
      coverage: null,
      premium: null,
      ticker: PREVIEW_ASSETS[(r as RelayPolicy & { tranche?: number }).tranche ?? -1]?.ticker ?? null,
      start: null,
      expiry: null,
      boughtAt: r.blockTime ? r.blockTime * 1000 : null,
      openOnCardano: false,
    });
  }
  for (const r of [...(V1.registrations ?? []), ...V2_RAW]) {
    put({
      policyId: r.policyId.toLowerCase(),
      buyTx: r.cardano?.buyTx ?? null,
      product: "depeg",
      coverage: r.cardano?.coverage ?? null,
      premium: null,
      ticker: null,
      start: null,
      expiry: r.cardano?.expiry ? Number(r.cardano.expiry) : null,
      boughtAt: null,
      openOnCardano: false,
    });
  }
  return [...out.values()].sort((a, b) => (b.boughtAt ?? 0) - (a.boughtAt ?? 0));
}

/** Find a policy by policy id or Cardano Buy tx hash (0x prefix and case ignored). */
export function findPolicy(list: KnownPolicy[], id: string): KnownPolicy | undefined {
  const q = norm(id);
  if (!/^[0-9a-f]{64}$/.test(q)) return undefined;
  return list.find((p) => p.policyId === q) ?? list.find((p) => p.buyTx === q);
}

export type Chain = "cardano" | "midnight";
export type Tone = "done" | "paid" | "rejected" | "pending" | "info";

export interface TimelineEvent {
  key: string;
  chain: Chain;
  /** Registry tag for Midnight rows. */
  registry?: "v1" | "v2";
  title: string;
  detail?: string;
  /** Cardano tx hash, or Midnight 64-hex tx hash. */
  tx?: string;
  block?: number | null;
  at: number | null;
  tone: Tone;
  /** "record" = repo deployment record, "live" = read just now, "snapshot" = build-time snapshot. */
  source: "record" | "live" | "snapshot";
}

export interface CardanoLive {
  /** Ticket parsed from the Buy tx metadata (label 7731), null if the tx carries none. undefined = not read. */
  ticket?: { holderCommitment: string; coverageCommitment: string; policyId: string } | null;
  buyAt?: number | null;
  /** Reference-token history: the burn tx closes the policy (Settle payout or expiry release). */
  closeTx?: { txHash: string; at: number | null } | null;
}

export interface TimelineInput {
  policy: KnownPolicy;
  v1Actions: MidnightAction[];
  v2Actions: MidnightAction[];
  midnightSource: "live" | "snapshot";
  cardanoSource: "live" | "snapshot";
  cardanoLive: CardanoLive | null;
  claimGraceMs: number;
}

function midnightEvents(registry: "v1" | "v2", actions: MidnightAction[], policyId: string, source: "live" | "snapshot"): TimelineEvent[] {
  const ev: TimelineEvent[] = [];
  const byHash = new Map(actions.map((a) => [a.txHash, a]));
  const rec = registry === "v1" ? (V1.registrations ?? []).find((r) => r.policyId.toLowerCase() === policyId) : undefined;
  const rec2 = registry === "v2" ? V2_REG.find((r) => r.policyId.toLowerCase() === policyId) : undefined;
  for (const a of actions) {
    for (const c of a.changes ?? []) {
      if (c.policyId.toLowerCase() !== policyId) continue;
      const base = { chain: "midnight" as const, registry, tx: a.txHash, block: a.height, at: a.timestamp, source };
      if (a.entryPoint === "registerPolicy")
        ev.push({ ...base, key: `${registry}-reg-${a.txHash}`, title: "Registered in the private registry", detail: "registerPolicy(): policy id keyed to the holder and coverage commitments; amounts and wallet stay private.", tone: "done" });
      else if (a.entryPoint === "fileClaim")
        ev.push({ ...base, key: `${registry}-file-${a.txHash}`, title: "Claim filed", detail: `fileClaim(): only a commitment to the evidence goes on-ledger${c.evidence ? ` (${c.evidence.slice(0, 10)}…)` : ""}.`, tone: "pending" });
      else if (a.entryPoint === "resolveClaim")
        ev.push({ ...base, key: `${registry}-res-${a.txHash}`, title: c.to === "PAID" ? "Claim approved by the assessor" : "Claim rejected by the assessor", detail: `resolveClaim(): ${c.from} → ${c.to}.`, tone: c.to === "PAID" ? "paid" : "rejected" });
      else if (a.entryPoint === "voteClaim")
        ev.push({ ...base, key: `${registry}-dec-${a.txHash}`, title: c.to === "PAID" ? "Committee quorum reached: claim approved" : `Committee decision: ${c.to}`, detail: `voteClaim() crossed the ${MIDNIGHT_V2.quorumLabel} threshold: ${c.from} → ${c.to}.`, tone: c.to === "PAID" ? "paid" : "rejected" });
      else if (a.entryPoint === "expirePolicy")
        ev.push({ ...base, key: `${registry}-exp-${a.txHash}`, title: "Expired on Midnight", detail: `expirePolicy(): ${c.from} → ${c.to}.`, tone: "info" });
    }
  }
  // proveCover carries no policy id in public state: take it from the relay record.
  const prove = rec?.proveCover?.txHash ? { txHash: rec.proveCover.txHash, block: rec.proveCover.blockHeight ?? null } : rec2?.proveCover ?? null;
  if (prove?.txHash) {
    const a = byHash.get(prove.txHash);
    ev.push({ key: `${registry}-prove-${prove.txHash}`, chain: "midnight", registry, title: "Cover proven in zero knowledge", detail: "proveCover(): the holder proved this policy covers at least the claimed amount without revealing it.", tx: prove.txHash, block: prove.block ?? a?.height ?? null, at: a?.timestamp ?? null, tone: "done", source: a ? source : "record" });
  }
  // A registration in the record that the action stream doesn't show (e.g. snapshot lag).
  const reg = rec?.registerPolicy?.txHash ? { txHash: rec.registerPolicy.txHash, block: rec.registerPolicy.blockHeight ?? null } : rec2?.registerPolicy ?? null;
  if (reg?.txHash && !ev.some((e) => e.tx === reg.txHash)) {
    const a = byHash.get(reg.txHash);
    ev.push({ key: `${registry}-reg-${reg.txHash}`, chain: "midnight", registry, title: "Registered in the private registry", detail: "registerPolicy() (from the relay record).", tx: reg.txHash, block: reg.block, at: a?.timestamp ?? null, tone: "done", source: "record" });
  }
  if (registry === "v2") {
    for (const claim of MIDNIGHT_V2.claims.filter((c) => c.policyId.toLowerCase() === policyId)) {
      for (const v of claim.votes) {
        const a = byHash.get(v.txHash);
        ev.push({
          key: `v2-vote-${v.txHash}`,
          chain: "midnight",
          registry: "v2",
          // Midnight seats are numbered 0–2 in the record and everywhere else
          // on the site (relay `--member <0|1|2>`); the Cardano assessor
          // indices (1–3, "assessor-1"…) are a different numbering — do not
          // +1 the seat here or the timeline names the wrong voter per tx.
          title: `Committee seat ${v.seat} voted ${v.approved ? "approve" : "reject"}`,
          detail: `voteClaim(): tally after this vote ${v.approvals} approve / ${v.rejections} reject, status ${v.statusAfter}.`,
          tx: v.txHash,
          block: v.block ?? a?.height ?? null,
          at: a?.timestamp ?? null,
          tone: v.approved ? "done" : "rejected",
          source: a ? source : "record",
        });
      }
    }
  }
  // The final vote also appears as a status change; keep one row per tx (prefer the vote row with seat detail, then add the outcome).
  return ev;
}

export function buildTimeline(i: TimelineInput): TimelineEvent[] {
  const p = i.policy;
  const ev: TimelineEvent[] = [];
  const asset = p.ticker ?? "";
  const fmt = (x: string | null) => (x ? `${(Number(x) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${asset}`.trim() : null);
  const exploit = allExploitPolicies().find((e) => e.policyId.toLowerCase() === p.policyId);

  if (p.buyTx) {
    const parts = [
      p.product === "depeg" ? "USDM depeg cover" : `Exploit cover (${(exploit?.pool ?? (p.product === "exploit-v2" ? EXPLOIT_PREVIEW : EXPLOIT_PREVIEW_V1)).version} pool, ${(exploit?.pool ?? (p.product === "exploit-v2" ? EXPLOIT_PREVIEW : EXPLOIT_PREVIEW_V1)).quorumLabel} assessor committee)`,
      fmt(p.coverage) && `coverage ${fmt(p.coverage)}`,
      fmt(p.premium) && `premium ${fmt(p.premium)}`,
      p.start && p.expiry ? `cover ${new Date(p.start).toISOString().slice(0, 10)} → ${new Date(p.expiry).toISOString().slice(0, 10)}` : p.expiry ? `expires ${new Date(p.expiry).toISOString().slice(0, 10)}` : null,
    ].filter(Boolean);
    ev.push({
      key: "buy",
      chain: "cardano",
      title: "Cover bought on Cardano",
      detail: `Buy: policy datum and claim token minted. ${parts.join(" · ")}.`,
      tx: p.buyTx,
      at: i.cardanoLive?.buyAt ?? p.boughtAt,
      tone: "done",
      source: i.cardanoLive?.buyAt ? "live" : p.openOnCardano ? i.cardanoSource : "record",
    });
  }

  // Registration ticket (metadata 7731).
  const relay = RELAY_SNAPSHOT.policies.find((r) => r.policyId === p.policyId);
  const liveTicket = i.cardanoLive?.ticket;
  if (liveTicket || relay?.source === "ticket") {
    ev.push({
      key: "ticket",
      chain: "cardano",
      title: "Registration ticket published",
      detail: `Tx metadata label 7731 in the Buy: policy id plus holder and coverage commitments (never the key), so the relay can mirror the policy on Midnight from chain data alone.${liveTicket ? ` Holder commitment ${liveTicket.holderCommitment.slice(0, 10)}….` : ""}`,
      tx: p.buyTx ?? undefined,
      at: i.cardanoLive?.buyAt ?? p.boughtAt,
      tone: "done",
      source: liveTicket ? "live" : "snapshot",
    });
  } else if (relay?.state === "pre-binding") {
    ev.push({ key: "ticket", chain: "cardano", title: "No Midnight binding", detail: "Bought before Midnight keys shipped (Oct 6, 2026): the datum carries a placeholder commitment, so this policy can't be mirrored on Midnight.", at: null, tone: "info", source: "snapshot" });
  } else if (relay?.source === "key" || [...(V1.registrations ?? []), ...V2_RAW].some((r) => r.policyId.toLowerCase() === p.policyId && r.source === "key")) {
    ev.push({ key: "ticket", chain: "cardano", title: "Mirrored from the holder key", detail: "No 7731 ticket was needed: the relay registered this policy from the holder's own Midnight key, which opens the datum's commitment.", at: null, tone: "info", source: "record" });
  }

  ev.push(...midnightEvents("v1", i.v1Actions, p.policyId, i.midnightSource));
  ev.push(...midnightEvents("v2", i.v2Actions, p.policyId, i.midnightSource));

  // Cardano close.
  if (exploit?.settleTx) {
    const signers = exploit.signedBy?.map((s) => s.name).join(" + ");
    ev.push({
      key: "settle",
      chain: "cardano",
      title: "Payout settled on Cardano",
      detail: `Settle paid ${fmt(exploit.payout ?? null) ?? "the coverage"} from the exploit pool${signers ? `, signed by ${signers}` : ""}, after the Midnight claim was approved.`,
      tx: exploit.settleTx,
      at: exploit.settledAt ? Date.parse(exploit.settledAt) : null,
      tone: "paid",
      source: "record",
    });
  } else if (i.cardanoLive?.closeTx) {
    ev.push({
      key: "close",
      chain: "cardano",
      title: "Policy closed on Cardano",
      detail: "The policy reference token was burned: either a Settle payout or the expiry release that returns the deposit to the buyer.",
      tx: i.cardanoLive.closeTx.txHash,
      at: i.cardanoLive.closeTx.at,
      tone: "done",
      source: "live",
    });
  }
  // Same tx and time: the deciding vote's seat row comes before the outcome it produced.
  const rank = (e: TimelineEvent) => (e.key.includes("-dec-") ? 1 : 0);
  return ev.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || (a.block ?? 0) - (b.block ?? 0) || rank(a) - rank(b));
}

export type Stage = { label: string; state: "done" | "current" | "todo" | "skipped" };

/** The four-stage summary strip: Buy → Mirror → Claim → Close. */
export function stagesOf(ev: TimelineEvent[], policy: KnownPolicy, now: number | null, claimGraceMs: number): { stages: Stage[]; status: string } {
  const has = (f: (e: TimelineEvent) => boolean) => ev.some(f);
  const bought = has((e) => e.key === "buy");
  const mirrored = has((e) => e.chain === "midnight" && e.title.startsWith("Registered"));
  const filed = has((e) => e.title === "Claim filed");
  const paid = has((e) => e.tone === "paid");
  const rejected = has((e) => e.chain === "midnight" && e.tone === "rejected" && !e.title.startsWith("Committee seat"));
  const closed = has((e) => e.key === "settle" || e.key === "close");
  let status = "Unknown";
  if (closed) status = has((e) => e.key === "settle") ? "Paid out on Cardano" : "Closed on Cardano";
  else if (policy.openOnCardano && policy.start && policy.expiry && now !== null) {
    status = now < policy.start ? "Waiting period" : now < policy.expiry ? "Active" : now < policy.expiry + claimGraceMs ? "Claim window" : "Expired, awaiting release";
  } else if (paid) status = "Claim approved on Midnight";
  else if (filed) status = "Claim pending";
  else if (bought) status = "Bought";
  const stages: Stage[] = [
    { label: "Bought on Cardano", state: bought ? "done" : "todo" },
    { label: "Mirrored on Midnight", state: mirrored ? "done" : bought ? "current" : "todo" },
    { label: filed ? (paid ? "Claim approved" : rejected ? "Claim rejected" : "Claim pending") : "No claim filed", state: filed ? (paid || rejected ? "done" : "current") : "skipped" },
    { label: closed ? (has((e) => e.key === "settle") ? "Paid on Cardano" : "Closed on Cardano") : "Open on Cardano", state: closed ? "done" : policy.openOnCardano ? "current" : "todo" },
  ];
  return { stages, status };
}
