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

const HEX32 = /^[0-9a-f]{64}$/;

/** Ledger PolicyStatus enum order in policy-cover.compact. */
export const POLICY_STATUS = ["NONE", "ACTIVE", "CLAIM_PENDING", "PAID", "EXPIRED"] as const;
export type PolicyStatusName = (typeof POLICY_STATUS)[number];

export type ClaimOp =
  | { kind: "claim"; policyId: string; evidence: string }
  | { kind: "resolve"; policyId: string; approved: boolean; envelope?: string; keyFile?: string }
  | { kind: "vote"; policyId: string; member: number; approved: boolean; envelope?: string; keyFile?: string };

/**
 * Parse claim operations from argv, in order:
 *   --claim <policyId> --evidence <evidence-input.json>
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
    if (op.kind === "claim" && !op.evidence) throw new Error(`--claim ${op.policyId.slice(0, 16)}… needs --evidence <file>`);
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
