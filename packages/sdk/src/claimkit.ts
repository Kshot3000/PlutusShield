/**
 * Holder claim kit: everything a policy holder needs to file an exploit claim
 * on the Midnight registry themselves, from their own machine, in one
 * passphrase-protected file.
 *
 *   browser:  sealEvidence(...) + this browser's policy key -> buildClaimKit()
 *             -> plutusshield-claim-<policy>.json (download)
 *   holder:   policy-cover-preprod.mjs --claim <policyId> --kit <file>
 *             -> openClaimKit() -> fileClaim(policyId, evidenceCommitment)
 *
 * The holder secret is the Midnight `localSecretKey` witness for fileClaim, so
 * the kit always wraps the policy key in the passphrase envelope from
 * midnight.ts (PBKDF2-SHA-256 -> AES-256-GCM); it is never written in the clear.
 * The evidence envelope is already AES-256-GCM; its key file rides alongside so
 * the filer can hand both to the assessors afterwards. Nothing here talks to a
 * network.
 */
import {
  verifyEvidence,
  parseEnvelope,
  parseKeyFile,
  type EvidenceBundle,
  type EvidenceEnvelope,
  type EvidenceKeyFile,
  type SealedEvidence,
} from "./evidence.ts";
import {
  checkPolicyKey,
  decryptPolicyKey,
  encryptPolicyKey,
  POLICY_KEY_ENVELOPE_SCHEMA,
  type PolicyKey,
  type PolicyKeyEnvelope,
} from "./midnight.ts";

export const CLAIM_KIT_SCHEMA = "plutusshield.claim-kit.v1" as const;

const HEX32 = /^[0-9a-f]{64}$/;

export interface ClaimKit {
  schema: typeof CLAIM_KIT_SCHEMA;
  /** Where the claim is filed. */
  target: { chain: "midnight"; network: string; contract: "policy-cover" | "policy-cover-v2"; address?: string };
  policyId: string;
  /** The exact fileClaim call the kit makes (both 32-byte args, hex). */
  call: { circuit: "fileClaim"; policyId: string; evidenceCommitment: string };
  /** The holder's policy key, always passphrase-encrypted. */
  policyKey: PolicyKeyEnvelope;
  /** Sealed evidence: the encrypted bundle and the key file that opens it. */
  evidence: { envelope: EvidenceEnvelope; keyFile: EvidenceKeyFile };
  createdAt: string;
}

export type ClaimKitErrorCode = "format" | "mismatch" | "decrypt" | "key" | "evidence";

export class ClaimKitError extends Error {
  code: ClaimKitErrorCode;
  constructor(code: ClaimKitErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ClaimKitError";
  }
}

export interface BuildClaimKitArgs {
  key: PolicyKey;
  sealed: Pick<SealedEvidence, "bundle" | "commitment" | "envelope" | "keyFile">;
  passphrase: string;
  target?: Partial<ClaimKit["target"]>;
  now?: Date;
  /** PBKDF2 iterations for the key envelope (tests lower it). */
  iterations?: number;
}

/** Build a claim kit. Refuses a key and bundle for different policies, or a key whose secrets don't re-derive its commitments. */
export async function buildClaimKit(a: BuildClaimKitArgs): Promise<ClaimKit> {
  const policyId = a.key.policyId.toLowerCase();
  if (a.sealed.bundle.policyId.toLowerCase() !== policyId) {
    throw new ClaimKitError("mismatch", "The evidence bundle is for a different policy than this key");
  }
  if (a.sealed.keyFile.commitment !== a.sealed.commitment || a.sealed.envelope.commitment !== a.sealed.commitment) {
    throw new ClaimKitError("evidence", "The sealed files don't name the same evidence commitment");
  }
  const chk = await checkPolicyKey(a.key);
  if (!chk.consistent) throw new ClaimKitError("key", chk.reason ?? "Policy key is not self-consistent");
  const policyKey = await encryptPolicyKey(a.key, a.passphrase, a.iterations);
  return {
    schema: CLAIM_KIT_SCHEMA,
    target: { chain: "midnight", network: "preprod", contract: "policy-cover-v2", ...a.target },
    policyId,
    call: { circuit: "fileClaim", policyId, evidenceCommitment: a.sealed.commitment },
    policyKey,
    evidence: { envelope: a.sealed.envelope, keyFile: a.sealed.keyFile },
    createdAt: (a.now ?? new Date()).toISOString(),
  };
}

export const claimKitFileName = (policyId: string) => `plutusshield-claim-${policyId.toLowerCase().slice(0, 16)}.json`;
export const claimKitFileText = (kit: ClaimKit) => `${JSON.stringify(kit, null, 2)}\n`;

/** Structural parse (no passphrase needed): schema, ids, and the public parts agree with each other. */
export function parseClaimKit(input: string | unknown): ClaimKit {
  let v: unknown = input;
  if (typeof input === "string") {
    try {
      v = JSON.parse(input);
    } catch {
      throw new ClaimKitError("format", "Not a JSON file");
    }
  }
  const k = v as Partial<ClaimKit> | null;
  if (!k || typeof k !== "object" || k.schema !== CLAIM_KIT_SCHEMA) throw new ClaimKitError("format", `Not a ${CLAIM_KIT_SCHEMA} file`);
  const pid = String(k.policyId ?? "").toLowerCase();
  if (!HEX32.test(pid)) throw new ClaimKitError("format", "policyId must be 32 bytes of hex");
  const call = k.call;
  if (!call || call.circuit !== "fileClaim" || String(call.policyId).toLowerCase() !== pid || !HEX32.test(String(call.evidenceCommitment))) {
    throw new ClaimKitError("format", "call must be fileClaim(policyId, evidenceCommitment) for this policy");
  }
  const pk = k.policyKey;
  if (!pk || pk.schema !== POLICY_KEY_ENVELOPE_SCHEMA) throw new ClaimKitError("format", "policyKey must be a passphrase-encrypted policy key");
  if (String(pk.policyId).toLowerCase() !== pid) throw new ClaimKitError("mismatch", "policyKey is for a different policy");
  let envelope: EvidenceEnvelope;
  let keyFile: EvidenceKeyFile;
  try {
    envelope = parseEnvelope(k.evidence?.envelope);
    keyFile = parseKeyFile(k.evidence?.keyFile);
  } catch (e) {
    throw new ClaimKitError("format", `evidence: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (envelope.commitment !== call.evidenceCommitment || keyFile.commitment !== call.evidenceCommitment) {
    throw new ClaimKitError("mismatch", "evidence files don't match the call's evidence commitment");
  }
  const t = k.target;
  if (!t || t.chain !== "midnight" || typeof t.network !== "string" || (t.contract !== "policy-cover" && t.contract !== "policy-cover-v2")) {
    throw new ClaimKitError("format", "target must name the Midnight policy-cover contract");
  }
  return { ...(k as ClaimKit), policyId: pid };
}

export interface OpenedClaimKit {
  kit: ClaimKit;
  key: PolicyKey;
  /** The sealed filing, re-verified: the bundle opens to the call's commitment. */
  sealed: { bundle: EvidenceBundle; commitment: string; envelope: EvidenceEnvelope; keyFile: EvidenceKeyFile };
}

/**
 * Open a kit for filing: decrypt the policy key, re-derive its commitments,
 * decrypt the evidence and check it is canonical, opens to the commitment in
 * the call, and names the same policy. Optionally check the key against the
 * Cardano datum's midnight_commitment. Throws ClaimKitError on any mismatch.
 */
export async function openClaimKit(input: string | unknown, passphrase: string, opts: { datumCommitment?: string } = {}): Promise<OpenedClaimKit> {
  const kit = parseClaimKit(input);
  let key: PolicyKey;
  try {
    key = await decryptPolicyKey(kit.policyKey, passphrase);
  } catch (e) {
    throw new ClaimKitError("decrypt", e instanceof Error ? e.message : String(e));
  }
  if (key.policyId !== kit.policyId) throw new ClaimKitError("mismatch", "policy key is for a different policy");
  const chk = await checkPolicyKey(key, opts.datumCommitment);
  if (!chk.ok) throw new ClaimKitError("key", chk.reason ?? "policy key check failed");
  const v = await verifyEvidence(kit.evidence.envelope, kit.evidence.keyFile, kit.call.evidenceCommitment);
  if (!v.ok || !v.bundle) {
    const bad = v.checks.find((c) => c.ok === false);
    throw new ClaimKitError("evidence", bad ? `${bad.label}: ${bad.detail}` : "evidence did not verify");
  }
  if (v.bundle.policyId !== kit.policyId) throw new ClaimKitError("mismatch", "evidence bundle is for a different policy");
  return { kit, key, sealed: { bundle: v.bundle, commitment: kit.call.evidenceCommitment, envelope: kit.evidence.envelope, keyFile: kit.evidence.keyFile } };
}
