/**
 * Exploit claims on Midnight Preprod: the pure half of the claim relay
 * (`preprod/policy-cover-preprod.mjs --claim … --resolve …`).
 *
 *   holder:   sealEvidence(bundle) -> fileClaim(policyId, evidenceCommitment)
 *   assessor: open the bundle off-ledger, check it against the commitment the
 *             ledger holds for that policy, then resolveClaim(policyId, approved)
 *
 * No Midnight runtime here (the .mjs does the wallet and proofs), so the
 * argument parsing and the assessor's off-ledger check are unit-tested in
 * contracts/midnight/test/claims.test.mjs. Never reads or returns secrets
 * except the evidence key file the caller hands to `assessClaim`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  evidenceFileText,
  sealEvidence,
  verifyEvidence,
  type EvidenceCheck,
  type EvidenceInput,
  type SealedEvidence,
} from "../../../packages/sdk/src/evidence.ts";
import { buildClaimKit, claimKitFileText, openClaimKit, type ClaimKit } from "../../../packages/sdk/src/claimkit.ts";
import { parsePolicyKey } from "../../../packages/sdk/src/midnight.ts";

const HEX32 = /^[0-9a-f]{64}$/;

/** Ledger PolicyStatus enum order in policy-cover.compact. */
export const POLICY_STATUS = ["NONE", "ACTIVE", "CLAIM_PENDING", "PAID", "EXPIRED"] as const;
export type PolicyStatusName = (typeof POLICY_STATUS)[number];

export type ClaimOp =
  | { kind: "claim"; policyId: string; evidence: string; kit?: string }
  | { kind: "resolve"; policyId: string; approved: boolean; envelope?: string; keyFile?: string }
  | { kind: "vote"; policyId: string; member: number; approved: boolean; envelope?: string; keyFile?: string };

/**
 * Parse claim operations from argv, in order:
 *   --claim <policyId> --evidence <evidence-input.json>
 *   --claim <policyId> --kit <plutusshield-claim-….json>   (holder claim kit from /claim/evidence)
 *   --resolve <policyId> (--approve | --reject) [--envelope <file> --evidence-key <file>]   (v1, one assessor)
 *   --vote <policyId> --member <0|1|2> (--approve | --reject) [--envelope … --evidence-key …]   (v2 committee)
 * Several may be chained (file then resolve in one wallet sync). Throws on
 * anything ambiguous: a missing --evidence, both or neither of --approve /
 * --reject, a malformed policy id.
 */
export function parseClaimOps(argv: string[]): ClaimOp[] {
  const ops: ClaimOp[] = [];
  const id = (v: string | undefined, flag: string) => {
    const h = String(v ?? "").toLowerCase();
    if (!HEX32.test(h)) throw new Error(`${flag} needs a 32-byte policy id (64 hex), got ${v ?? "nothing"}`);
    return h;
  };
  const last = () => ops[ops.length - 1];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--claim") ops.push({ kind: "claim", policyId: id(argv[++i], "--claim"), evidence: "" });
    else if (a === "--resolve") ops.push({ kind: "resolve", policyId: id(argv[++i], "--resolve"), approved: undefined as unknown as boolean });
    else if (a === "--vote") ops.push({ kind: "vote", policyId: id(argv[++i], "--vote"), member: -1, approved: undefined as unknown as boolean });
    else if (a === "--member") {
      const op = last();
      if (op?.kind !== "vote") throw new Error("--member must follow --vote <policyId>");
      if (op.member !== -1) throw new Error("one --member per --vote");
      const v = val();
      if (!/^[0-2]$/.test(v)) throw new Error(`--member is a committee seat 0, 1 or 2, got ${v}`);
      op.member = Number(v);
    }
    else if (a === "--evidence") {
      const op = last();
      if (op?.kind !== "claim") throw new Error("--evidence must follow --claim <policyId>");
      if (op.evidence) throw new Error("one --evidence per --claim");
      op.evidence = val();
    } else if (a === "--kit") {
      const op = last();
      if (op?.kind !== "claim") throw new Error("--kit must follow --claim <policyId>");
      if (op.kit) throw new Error("one --kit per --claim");
      op.kit = val();
    } else if (a === "--approve" || a === "--reject") {
      const op = last();
      if (op?.kind !== "resolve" && op?.kind !== "vote") throw new Error(`${a} must follow --resolve or --vote <policyId>`);
      if (op.approved !== undefined) throw new Error("give exactly one of --approve / --reject");
      op.approved = a === "--approve";
    } else if (a === "--envelope" || a === "--evidence-key") {
      const op = last();
      if (op?.kind !== "resolve" && op?.kind !== "vote") throw new Error(`${a} must follow --resolve or --vote <policyId>`);
      if (a === "--envelope") op.envelope = val();
      else op.keyFile = val();
    }
  }
  for (const op of ops) {
    if (op.kind === "claim" && !op.evidence && !op.kit) throw new Error(`--claim ${op.policyId.slice(0, 16)}… needs --evidence <file> or --kit <claim kit>`);
    if (op.kind === "claim" && op.evidence && op.kit) throw new Error(`--claim ${op.policyId.slice(0, 16)}…: give --evidence or --kit, not both`);
    if (op.kind === "resolve" && op.approved === undefined) throw new Error(`--resolve ${op.policyId.slice(0, 16)}… needs --approve or --reject`);
    if (op.kind === "vote" && op.member === -1) throw new Error(`--vote ${op.policyId.slice(0, 16)}… needs --member <0|1|2>`);
    if (op.kind === "vote" && op.approved === undefined) throw new Error(`--vote ${op.policyId.slice(0, 16)}… needs --approve or --reject`);
    if (op.kind !== "claim" && !!op.envelope !== !!op.keyFile) throw new Error("--envelope and --evidence-key go together");
  }
  return ops;
}

/**
 * Read an evidence input (the /claim/evidence form as JSON) for a policy and
 * seal it: canonical bundle -> SHA-256 digest -> fresh random salt ->
 * evidenceCommitment, plus the AES-256-GCM envelope and key file.
 */
export async function sealEvidenceFile(file: string, policyId: string, now = new Date()): Promise<SealedEvidence> {
  const input = JSON.parse(readFileSync(file, "utf8")) as EvidenceInput & { _note?: string };
  const { _note, ...rest } = input;
  void _note;
  const pid = String(rest.policyId ?? policyId).toLowerCase();
  if (pid !== policyId) throw new Error(`evidence file names policy ${pid.slice(0, 16)}…, not ${policyId.slice(0, 16)}…`);
  return sealEvidence({ ...rest, policyId }, { now });
}

/**
 * Open a holder claim kit (packages/sdk/src/claimkit.ts) for `--claim <id> --kit <file>`:
 * decrypts the policy key with the kit passphrase, re-derives its commitments,
 * and re-verifies that the sealed evidence opens to the commitment the kit will
 * file. The kit must be for `policyId`. Returns the key and a SealedEvidence-
 * shaped filing (no re-seal: the commitment the holder sealed in the browser is
 * the one that goes on-ledger).
 */
export async function openClaimKitFile(file: string, policyId: string, passphrase: string) {
  if (!passphrase) throw new Error("--kit needs the kit passphrase in PLUTUSSHIELD_CLAIM_KIT_PASSPHRASE");
  const opened = await openClaimKit(readFileSync(file, "utf8"), passphrase);
  if (opened.kit.policyId !== policyId) throw new Error(`claim kit is for policy ${opened.kit.policyId.slice(0, 16)}…, not ${policyId.slice(0, 16)}…`);
  return opened;
}

/**
 * Build a holder claim kit from files, for holders who keep their policy key on
 * disk instead of in a browser (`pnpm midnight:claim-kit`): the same SDK calls
 * /claim/evidence makes (sealEvidence -> buildClaimKit), so the kit is
 * byte-compatible with a browser download. The evidence input names the policy
 * (or inherits it from the key); a key and input for different policies are
 * refused. Re-opens the kit with the passphrase before returning it, so a kit
 * that can't be filed is never written.
 */
export async function buildClaimKitFromFiles(a: {
  keyFile: string;
  evidenceFile: string;
  passphrase: string;
  address?: string;
  contract?: ClaimKit["target"]["contract"];
  now?: Date;
  iterations?: number;
}): Promise<{ kit: ClaimKit; text: string }> {
  if (!a.passphrase) throw new Error("a claim kit needs a passphrase (PLUTUSSHIELD_CLAIM_KIT_PASSPHRASE)");
  const key = parsePolicyKey(readFileSync(a.keyFile, "utf8"));
  const sealed = await sealEvidenceFile(a.evidenceFile, key.policyId, a.now);
  const kit = await buildClaimKit({
    key,
    sealed,
    passphrase: a.passphrase,
    target: { contract: a.contract ?? "policy-cover-v2", ...(a.address ? { address: a.address } : {}) },
    now: a.now,
    iterations: a.iterations,
  });
  const text = claimKitFileText(kit);
  await openClaimKit(text, a.passphrase);
  return { kit, text };
}

/** Where the relay keeps a filing's envelope and key file (outside the repo). */
export const evidencePaths = (secretsDir: string, commitment: string) => ({
  dir: join(secretsDir, "evidence"),
  envelope: join(secretsDir, "evidence", `${commitment}.envelope.json`),
  keyFile: join(secretsDir, "evidence", `${commitment}.key.json`),
});

/** Save a sealed filing (key file mode 0600). Returns the paths. */
export function saveSealed(secretsDir: string, sealed: SealedEvidence) {
  const p = evidencePaths(secretsDir, sealed.commitment);
  mkdirSync(p.dir, { recursive: true, mode: 0o700 });
  writeFileSync(p.envelope, evidenceFileText(sealed.envelope));
  writeFileSync(p.keyFile, evidenceFileText(sealed.keyFile), { mode: 0o600 });
  return p;
}

export interface LedgerClaimView {
  status: PolicyStatusName;
  /** 64-hex evidence commitment from the ledger record ("00…" when none). */
  evidence: string;
}

export interface Assessment {
  ok: boolean;
  reason: string;
  checks: EvidenceCheck[];
  commitment: string;
  /** Public summary of the opened bundle for the record (no description, no attachments). */
  summary?: { protocol: string; chain: string; kind: string; loss: string; txHashes: number; createdAt: string };
}

/**
 * The assessor's off-ledger check before resolveClaim: the policy must have a
 * pending claim, and the bundle must decrypt, be canonical, open to the
 * commitment, and that commitment must be the one on the ledger. `ok` is the
 * gate; only an ok assessment may be resolved (approve or reject).
 */
export async function assessClaim(args: {
  policyId: string;
  ledger: LedgerClaimView | null;
  envelopeText: string;
  keyFileText: string;
}): Promise<Assessment> {
  const fail = (reason: string, checks: EvidenceCheck[] = [], commitment = ""): Assessment => ({ ok: false, reason, checks, commitment });
  if (!args.ledger) return fail("policy is not registered on Midnight");
  if (args.ledger.status !== "CLAIM_PENDING") return fail(`policy is ${args.ledger.status}, not CLAIM_PENDING`);
  if (!HEX32.test(args.ledger.evidence) || /^0+$/.test(args.ledger.evidence)) return fail("ledger record has no evidence commitment");
  const v = await verifyEvidence(args.envelopeText, args.keyFileText, args.ledger.evidence);
  if (!v.ok || !v.bundle) {
    const bad = v.checks.find((c) => c.ok === false);
    return fail(bad ? `${bad.label}: ${bad.detail}` : "evidence did not verify", v.checks, v.commitment ?? "");
  }
  if (v.bundle.policyId !== args.policyId) return fail("bundle is for a different policy", v.checks, v.commitment ?? "");
  const b = v.bundle;
  return {
    ok: true,
    reason: "bundle opens to the on-ledger evidence commitment",
    checks: v.checks,
    commitment: v.commitment!,
    summary: {
      protocol: b.protocol.name,
      chain: b.protocol.chain,
      kind: b.incident.kind,
      loss: `${b.loss.amount} ${b.loss.asset}`,
      txHashes: b.txHashes.length,
      createdAt: b.createdAt,
    },
  };
}

/** Load the envelope + key file for a resolve op: explicit paths, else the relay's store by ledger commitment. */
export function loadFiling(secretsDir: string, op: Extract<ClaimOp, { kind: "resolve" | "vote" }>, ledgerCommitment: string) {
  const p = op.envelope && op.keyFile ? { envelope: op.envelope, keyFile: op.keyFile } : evidencePaths(secretsDir, ledgerCommitment);
  if (!existsSync(p.envelope) || !existsSync(p.keyFile)) {
    throw new Error(`no evidence bundle + key file for commitment ${ledgerCommitment.slice(0, 16)}… (looked for ${p.envelope}); pass --envelope and --evidence-key`);
  }
  return { envelopeText: readFileSync(p.envelope, "utf8"), keyFileText: readFileSync(p.keyFile, "utf8") };
}

/**
 * Off-chain mirror of policy-cover-v2's voteClaim tally for one claim round, so
 * the relay can plan a chain of votes before the wallet sync and check the
 * ledger after each one. Same rules as the circuit: one vote per seat per
 * round; `threshold` approvals -> PAID, `threshold` rejections -> ACTIVE
 * (evidence cleared); otherwise the claim stays CLAIM_PENDING.
 */
export interface RoundTally {
  approvals: number;
  rejections: number;
  voted: number[];
}

export function applyVote(
  tally: RoundTally,
  member: number,
  approve: boolean,
  threshold: number,
): { tally: RoundTally; status: "PAID" | "ACTIVE" | "CLAIM_PENDING" } {
  if (!Number.isInteger(member) || member < 0 || member > 2) throw new Error(`committee seat ${member} is not 0, 1 or 2`);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 3) throw new Error(`threshold ${threshold} is not 1..3`);
  if (tally.voted.includes(member)) throw new Error(`seat ${member} already voted on this claim round`);
  const next: RoundTally = {
    approvals: tally.approvals + (approve ? 1 : 0),
    rejections: tally.rejections + (approve ? 0 : 1),
    voted: [...tally.voted, member],
  };
  const status = next.approvals >= threshold ? "PAID" : next.rejections >= threshold ? "ACTIVE" : "CLAIM_PENDING";
  return { tally: next, status };
}

/**
 * The committee's check before a Cardano exploit Settle: does a public Midnight
 * Preprod record show this policy's claim decided APPROVED (PAID)? Accepts
 *   v1 (deployments/preprod.json): resolveClaim(approved) by the one assessor,
 *       finalized, ledger PAID after it;
 *   v2 (deployments/preprod-v2.json): finalized voteClaim approvals from at
 *       least `threshold` distinct committee seats on the filed evidence, each
 *       after a passing off-ledger assessment, the deciding vote approving and
 *       the ledger PAID after it.
 * Returns the resolution the Settle names in its label-7732 metadata (for v2,
 * `resolveTx` is the deciding voteClaim tx). Throws when neither record shows
 * an approved claim, or when both do (one policy is decided on one registry).
 */
export interface PayoutApproval {
  registry: "policy-cover" | "policy-cover-v2";
  midnight: { network: "preprod"; contract: string; claim: string; evidence: string; resolveTx: string };
  fileClaim: { txHash: string | null; block: number | null };
  /** Who filed: "holder-claim-kit" when the holder filed from their own kit, else the operator relay. */
  filedBy: "holder-claim-kit" | "operator-relay";
  decision:
    | { kind: "resolveClaim"; txHash: string; block: number | null }
    | { kind: "committee"; txHash: string; block: number | null; threshold: number; approvals: { seat: number; txHash: string; block: number | null }[]; rejections: number };
}

type Rec = Record<string, any>;
const finalizedOk = (t: Rec | undefined) => !!t?.txHash && t.blockHeight != null && t.status === "SucceedEntirely";

export function approvedPayout(records: { v1?: Rec | null; v2?: Rec | null }, policyId: string): PayoutApproval {
  const id = policyId.toLowerCase();
  const found: PayoutApproval[] = [];
  const v1 = records.v1?.claims?.find((c: Rec) => c.policyId === id && c.resolveClaim?.approved === true);
  if (v1) {
    if (v1.ledgerAfterResolve?.status !== "PAID" || !finalizedOk(v1.resolveClaim)) throw new Error("v1 Midnight ledger does not show the claim PAID after a finalized resolveClaim");
    found.push({
      registry: "policy-cover",
      midnight: { network: "preprod", contract: records.v1!.contractAddress, claim: id, evidence: v1.evidenceCommitment, resolveTx: v1.resolveClaim.txHash },
      fileClaim: { txHash: v1.fileClaim?.txHash ?? null, block: v1.fileClaim?.blockHeight ?? null },
      filedBy: v1.source === "holder-claim-kit" ? "holder-claim-kit" : "operator-relay",
      decision: { kind: "resolveClaim", txHash: v1.resolveClaim.txHash, block: v1.resolveClaim.blockHeight ?? null },
    });
  }
  const v2 = records.v2?.claims?.find((c: Rec) => c.policyId === id && c.decided?.status === "PAID");
  if (v2) {
    const votes: Rec[] = v2.votes ?? [];
    const threshold = Number(v2.decided.threshold);
    if (!finalizedOk(v2.fileClaim) || v2.ledgerAfterFile?.evidence !== v2.evidenceCommitment) throw new Error("v2 claim has no finalized fileClaim of its evidence commitment");
    if (votes.some((v) => !finalizedOk(v))) throw new Error("v2 claim has a vote that did not finalize");
    const approving = votes.filter((v) => v.approved === true);
    if (approving.some((v) => v.assessment?.ok !== true)) throw new Error("v2 approval cast without a passing off-ledger assessment");
    const seats = new Set(approving.map((v) => Number(v.seat)));
    if (!(threshold >= 1) || seats.size < threshold) throw new Error(`v2 claim has ${seats.size} approving seats, threshold ${threshold}`);
    const last = votes[votes.length - 1];
    if (!last?.approved || last.ledgerAfterVote?.status !== "PAID") throw new Error("v2 deciding vote did not leave the ledger PAID");
    found.push({
      registry: "policy-cover-v2",
      midnight: { network: "preprod", contract: records.v2!.contractAddress, claim: id, evidence: v2.evidenceCommitment, resolveTx: last.txHash },
      fileClaim: { txHash: v2.fileClaim.txHash, block: v2.fileClaim.blockHeight ?? null },
      filedBy: v2.source === "holder-claim-kit" ? "holder-claim-kit" : "operator-relay",
      decision: {
        kind: "committee",
        txHash: last.txHash,
        block: last.blockHeight ?? null,
        threshold,
        approvals: approving.map((v) => ({ seat: Number(v.seat), txHash: v.txHash, block: v.blockHeight ?? null })),
        rejections: votes.length - approving.length,
      },
    });
  }
  if (!found.length) throw new Error(`no approved Midnight claim for ${id}; the assessors do not sign`);
  if (found.length > 1) throw new Error(`policy ${id.slice(0, 16)}… shows approved claims on both registries; refusing to pick one`);
  return found[0];
}
