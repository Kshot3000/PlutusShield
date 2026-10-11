/**
 * PlutusShield assessor-operator kit (offline, no network, no chain tx).
 *
 * An outside operator runs this on their own machine to join the claims
 * committee on BOTH chains:
 *
 *   Cardano Preview   an ed25519 payment key. Its 28-byte verification key
 *                     hash (blake2b-224 of the 32-byte vkey) is what the
 *                     exploit_cover validator lists in its `Committee`
 *                     parameter; an exploit `Settle` pays only with
 *                     `threshold` distinct committee signatures.
 *                     Stored as bech32 `ed25519_sk1…` (the format
 *                     contracts/cardano/deploy loads with
 *                     CML.PrivateKey.from_bech32, same as assessor-<i>.sk)
 *                     plus cardano-cli TextEnvelope .skey/.vkey files.
 *
 *   Midnight Preprod  a 32-byte committee seat secret. The policy-cover v2
 *                     constructor stores only its role commitment
 *                       roleCommitment(sk, assessorTag())
 *                         = SHA-256(pad32("plutusshield:role:") || pad32("assessor") || sk)
 *                     and `voteClaim` proves knowledge of `sk` in zero
 *                     knowledge. Stored as the relay's seat file format
 *                     { schema: "plutusshield/midnight-committee-seat@1", seat, sk, createdAt }.
 *
 * The public enrollment record carries the vkey, key hash, enterprise
 * address and seat commitment, a contact-free operator handle, and an
 * ed25519 signature by the Cardano key over a canonical payload, so the team
 * (or anyone) can check the operator holds the Cardano key and has bound this
 * exact seat commitment to it. Possession of the Midnight seat secret cannot
 * be shown by a signature (it is a hash preimage, not a signing key); it is
 * shown by a `voteClaim` on a drill claim after redeploy.
 *
 * `planCommittee` turns three verified records + a threshold into the exact
 * exploit-cover `Committee` parameter (and its CBOR) and the Midnight v2
 * constructor arguments a future redeploy would use. Dry run only.
 *
 * Not audited. Preview/Preprod test value only.
 */
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign as edSign, verify as edVerify, type KeyObject } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { blake2b } from "../../../packages/sdk/src/blake2b.ts";
import { bech32Decode, bech32Encode } from "../../../packages/sdk/src/cip30.ts";
import { committeeData, committeeProblem, toCborHex } from "../../../packages/sdk/src/cardano.ts";
import { pad32, roleCommitment } from "../../../packages/sdk/src/midnight.ts";

export const ENROLLMENT_SCHEMA = "plutusshield/assessor-enrollment@1" as const;
export const SEAT_SCHEMA = "plutusshield/midnight-committee-seat@1" as const;
export const PLAN_SCHEMA = "plutusshield/committee-plan@1" as const;
export const SIGN_DOMAIN = "plutusshield:assessor-enrollment:v1" as const;
export const ASSESSOR_TAG_TEXT = "assessor";
export const SEAT_SCHEME =
  'roleCommitment(sk, assessorTag()) = SHA-256(pad32("plutusshield:role:") || pad32("assessor") || sk)' as const;
export const STATEMENT =
  "I control the Cardano Preview assessor key and the Midnight Preprod committee seat secret behind this record. " +
  "I will vote on a claim or sign a Settle only after checking its sealed evidence myself, and I will recuse from claims where I have a conflict of interest.";
/** Midnight policy-cover v2 fixes a committee of exactly three seats. */
export const COMMITTEE_SIZE = 3;
/** Clock skew tolerated for createdAt. */
export const MAX_FUTURE_MS = 10 * 60_000;

export const FILES = {
  cardanoSk: "cardano-assessor.sk",
  cardanoSkey: "cardano-assessor.skey",
  cardanoVkey: "cardano-assessor.vkey",
  midnightSeat: "midnight-seat.json",
  enrollment: "enrollment.json",
  gitignore: ".gitignore",
} as const;

const HEX = (n: number) => new RegExp(`^[0-9a-f]{${n * 2}}$`);
const HEX28 = HEX(28);
const HEX32 = HEX(32);
const HEX64 = HEX(64);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
/** X / GitHub style handle: letters, digits, _ . - ; optional leading @. No emails, URLs or phone numbers. */
const HANDLE = /^@?[A-Za-z0-9_][A-Za-z0-9_.-]{0,38}$/;
const AFFILIATION = /^[A-Za-z0-9][A-Za-z0-9 _.\-/]{0,47}$/;

const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const fromHex = (h: string) => new Uint8Array(Buffer.from(h, "hex"));
const sha256Hex = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

export class KitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KitError";
  }
}

// ---------------------------------------------------------------------------
// Cardano ed25519 key
// ---------------------------------------------------------------------------

const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");

const privKeyObject = (seed: Uint8Array): KeyObject =>
  createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, Buffer.from(seed)]), format: "der", type: "pkcs8" });
const pubKeyObject = (vkey: Uint8Array): KeyObject =>
  createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(vkey)]), format: "der", type: "spki" });

export interface CardanoKey {
  seed: Uint8Array;
  vkey: string;
  keyHash: string;
  address: string;
  skBech32: string;
}

/** blake2b-224 of the 32-byte verification key: Cardano's `VerificationKeyHash`. */
export const vkeyHash = (vkey: Uint8Array | string) => toHex(blake2b(typeof vkey === "string" ? fromHex(vkey) : vkey, 28));

/** CIP-19 enterprise address (header 0x60 = key payment credential, testnet). */
export function previewEnterpriseAddress(keyHash: string): string {
  if (!HEX28.test(keyHash)) throw new KitError("key hash must be 28 bytes of lowercase hex");
  return bech32Encode("addr_test", new Uint8Array([0x60, ...fromHex(keyHash)]));
}

export function cardanoKeyFromSeed(seed: Uint8Array): CardanoKey {
  if (seed.length !== 32) throw new KitError("Cardano signing key seed must be 32 bytes");
  const vkeyBytes = new Uint8Array(createPublicKey(privKeyObject(seed)).export({ format: "der", type: "spki" }).subarray(SPKI_ED25519.length));
  const keyHash = vkeyHash(vkeyBytes);
  return { seed, vkey: toHex(vkeyBytes), keyHash, address: previewEnterpriseAddress(keyHash), skBech32: bech32Encode("ed25519_sk", seed) };
}

export const generateCardanoKey = () => cardanoKeyFromSeed(new Uint8Array(randomBytes(32)));

/** cardano-cli TextEnvelope for a payment key (cborHex = CBOR bytes(32)). */
export const textEnvelope = (kind: "skey" | "vkey", bytes: Uint8Array) => ({
  type: kind === "skey" ? "PaymentSigningKeyShelley_ed25519" : "PaymentVerificationKeyShelley_ed25519",
  description: kind === "skey" ? "PlutusShield assessor signing key (Cardano Preview)" : "PlutusShield assessor verification key (Cardano Preview)",
  cborHex: `5820${toHex(bytes)}`,
});

/** Read an assessor signing key: bech32 `ed25519_sk1…` or a cardano-cli TextEnvelope .skey. */
export function parseCardanoSigningKey(text: string): CardanoKey {
  const t = text.trim();
  if (t.startsWith("{")) {
    const env = JSON.parse(t) as { type?: string; cborHex?: string };
    if (env.type !== "PaymentSigningKeyShelley_ed25519" || !/^5820[0-9a-f]{64}$/.test(env.cborHex ?? ""))
      throw new KitError("not a PaymentSigningKeyShelley_ed25519 TextEnvelope");
    return cardanoKeyFromSeed(fromHex(env.cborHex!.slice(4)));
  }
  const { hrp, data } = bech32Decode(t);
  if (hrp !== "ed25519_sk" || data.length !== 32) throw new KitError("expected a bech32 ed25519_sk1… key with 32 bytes");
  return cardanoKeyFromSeed(data);
}

// ---------------------------------------------------------------------------
// Midnight committee seat
// ---------------------------------------------------------------------------

export interface SeatFile {
  schema: typeof SEAT_SCHEMA;
  seat: number;
  sk: string;
  createdAt: string;
}

export const assessorTag = () => pad32(ASSESSOR_TAG_TEXT);

/** The public identity of a seat: what the v2 constructor stores in `assessors`. */
export const seatCommitment = async (sk: string | Uint8Array) => toHex(await roleCommitment(sk, assessorTag()));

export function checkSeat(seat: unknown): number {
  if (!Number.isInteger(seat) || (seat as number) < 0 || (seat as number) >= COMMITTEE_SIZE)
    throw new KitError(`seat must be 0, 1 or 2 (got ${String(seat)})`);
  return seat as number;
}

/** Parse a seat file exactly as contracts/midnight/preprod/policy-cover-preprod.mjs loadCommittee() accepts it. */
export function parseSeatFile(text: string): SeatFile {
  const m = JSON.parse(text) as SeatFile;
  if (m.schema !== SEAT_SCHEMA) throw new KitError(`seat file schema must be ${SEAT_SCHEMA}`);
  checkSeat(m.seat);
  if (!HEX32.test(m.sk)) throw new KitError("seat file sk must be 32 bytes of lowercase hex");
  return m;
}

// ---------------------------------------------------------------------------
// Enrollment record
// ---------------------------------------------------------------------------

export interface Enrollment {
  schema: typeof ENROLLMENT_SCHEMA;
  operator: { handle: string; affiliations: string[] };
  createdAt: string;
  cardano: { network: "preview"; vkey: string; keyHash: string; address: string };
  midnight: { network: "preprod"; seatCommitment: string; scheme: typeof SEAT_SCHEME };
  statement: string;
  signature: { alg: "ed25519"; domain: typeof SIGN_DOMAIN; payloadSha256: string; sig: string };
}

/** Deterministic JSON: object keys sorted, no whitespace. Only strings, integers, booleans, null, arrays, objects. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new KitError("canonical JSON allows integers only");
    return String(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  throw new KitError(`canonical JSON cannot encode ${typeof v}`);
}

/** Bytes the Cardano key signs: domain line + canonical JSON of the record without `signature`. */
export function signingPayload(rec: Omit<Enrollment, "signature"> | Enrollment): Uint8Array {
  const { signature: _sig, ...body } = rec as Enrollment;
  return new TextEncoder().encode(`${SIGN_DOMAIN}\n${canonicalJson(body)}`);
}

export function normaliseHandle(handle: string): string {
  const h = handle.trim();
  if (!HANDLE.test(h)) throw new KitError("handle must be a public X/GitHub-style handle (letters, digits, _ . -, up to 39 chars); no emails, URLs or phone numbers");
  return h.startsWith("@") ? h : `@${h}`;
}

export function normaliseAffiliations(list: string[]): string[] {
  const out = [...new Set(list.map((a) => a.trim()).filter(Boolean))];
  for (const a of out) if (!AFFILIATION.test(a) || /@|:\/\//.test(a)) throw new KitError(`affiliation "${a}" must be a short protocol/org name (no contact details)`);
  if (out.length > 16) throw new KitError("at most 16 affiliations");
  return out.sort();
}

export async function buildEnrollment(opts: {
  cardano: CardanoKey;
  seatSk: string;
  handle: string;
  affiliations?: string[];
  createdAt?: string;
}): Promise<Enrollment> {
  const body: Omit<Enrollment, "signature"> = {
    schema: ENROLLMENT_SCHEMA,
    operator: { handle: normaliseHandle(opts.handle), affiliations: normaliseAffiliations(opts.affiliations ?? []) },
    createdAt: opts.createdAt ?? new Date().toISOString(),
    cardano: { network: "preview", vkey: opts.cardano.vkey, keyHash: opts.cardano.keyHash, address: opts.cardano.address },
    midnight: { network: "preprod", seatCommitment: await seatCommitment(opts.seatSk), scheme: SEAT_SCHEME },
    statement: STATEMENT,
  };
  const payload = signingPayload(body);
  const sig = toHex(new Uint8Array(edSign(null, payload, privKeyObject(opts.cardano.seed))));
  return { ...body, signature: { alg: "ed25519", domain: SIGN_DOMAIN, payloadSha256: sha256Hex(payload), sig } };
}

const sameKeys = (o: unknown, keys: string[]) =>
  !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).sort().join(",") === [...keys].sort().join(",");

export interface VerifyResult {
  ok: boolean;
  problems: string[];
}

/** Check shape, every encoding, the key hash / address derivations and the signature. Never throws on bad input. */
export function verifyEnrollment(rec: unknown, opts: { now?: number } = {}): VerifyResult {
  const problems: string[] = [];
  const r = rec as Enrollment;
  if (!sameKeys(r, ["schema", "operator", "createdAt", "cardano", "midnight", "statement", "signature"]))
    return { ok: false, problems: ["record must have exactly: schema, operator, createdAt, cardano, midnight, statement, signature"] };
  if (r.schema !== ENROLLMENT_SCHEMA) problems.push(`schema must be ${ENROLLMENT_SCHEMA}`);

  if (!sameKeys(r.operator, ["handle", "affiliations"])) problems.push("operator must have exactly: handle, affiliations");
  else {
    try {
      if (normaliseHandle(r.operator.handle) !== r.operator.handle) problems.push("operator.handle is not normalised (expected a leading @)");
    } catch (e) {
      problems.push(`operator.handle: ${(e as Error).message}`);
    }
    try {
      if (!Array.isArray(r.operator.affiliations) || canonicalJson(normaliseAffiliations(r.operator.affiliations)) !== canonicalJson(r.operator.affiliations))
        problems.push("operator.affiliations must be a sorted, de-duplicated list");
    } catch (e) {
      problems.push(`operator.affiliations: ${(e as Error).message}`);
    }
  }

  if (typeof r.createdAt !== "string" || !ISO.test(r.createdAt) || Number.isNaN(Date.parse(r.createdAt))) problems.push("createdAt must be an ISO-8601 UTC timestamp");
  else if (Date.parse(r.createdAt) > (opts.now ?? Date.now()) + MAX_FUTURE_MS) problems.push("createdAt is in the future");

  let vkeyOk = false;
  if (!sameKeys(r.cardano, ["network", "vkey", "keyHash", "address"])) problems.push("cardano must have exactly: network, vkey, keyHash, address");
  else {
    if (r.cardano.network !== "preview") problems.push('cardano.network must be "preview"');
    if (!HEX32.test(r.cardano.vkey)) problems.push("cardano.vkey must be 32 bytes of lowercase hex");
    else {
      vkeyOk = true;
      if (r.cardano.keyHash !== vkeyHash(r.cardano.vkey)) problems.push("cardano.keyHash is not blake2b-224(cardano.vkey)");
    }
    if (!HEX28.test(r.cardano.keyHash)) problems.push("cardano.keyHash must be 28 bytes of lowercase hex");
    else if (r.cardano.address !== previewEnterpriseAddress(r.cardano.keyHash)) problems.push("cardano.address is not the Preview enterprise address of cardano.keyHash");
  }

  if (!sameKeys(r.midnight, ["network", "seatCommitment", "scheme"])) problems.push("midnight must have exactly: network, seatCommitment, scheme");
  else {
    if (r.midnight.network !== "preprod") problems.push('midnight.network must be "preprod"');
    if (r.midnight.scheme !== SEAT_SCHEME) problems.push("midnight.scheme is not the policy-cover v2 assessor role commitment");
    if (!HEX32.test(r.midnight.seatCommitment)) problems.push("midnight.seatCommitment must be 32 bytes of lowercase hex");
    else if (/^0+$/.test(r.midnight.seatCommitment)) problems.push("midnight.seatCommitment is empty (the v2 constructor rejects it)");
  }

  if (r.statement !== STATEMENT) problems.push("statement does not match the kit's operator statement");

  if (!sameKeys(r.signature, ["alg", "domain", "payloadSha256", "sig"])) problems.push("signature must have exactly: alg, domain, payloadSha256, sig");
  else {
    if (r.signature.alg !== "ed25519") problems.push('signature.alg must be "ed25519"');
    if (r.signature.domain !== SIGN_DOMAIN) problems.push(`signature.domain must be ${SIGN_DOMAIN}`);
    let payload: Uint8Array | null = null;
    try {
      payload = signingPayload(r);
    } catch (e) {
      problems.push(`payload: ${(e as Error).message}`);
    }
    if (payload && r.signature.payloadSha256 !== sha256Hex(payload)) problems.push("signature.payloadSha256 does not match the record");
    if (!HEX64.test(r.signature.sig)) problems.push("signature.sig must be 64 bytes of lowercase hex");
    else if (payload && vkeyOk) {
      let good = false;
      try {
        good = edVerify(null, payload, pubKeyObject(fromHex(r.cardano.vkey)), Buffer.from(r.signature.sig, "hex"));
      } catch {
        good = false;
      }
      if (!good) problems.push("signature does not verify under cardano.vkey");
    }
  }
  return { ok: problems.length === 0, problems };
}

export const enrollmentDigest = (rec: Enrollment) => sha256Hex(canonicalJson(rec));

// ---------------------------------------------------------------------------
// Local files
// ---------------------------------------------------------------------------

function writeSecret(file: string, text: string) {
  writeFileSync(file, text, { mode: 0o600, flag: "wx" });
  chmodSync(file, 0o600);
}
function writePublic(file: string, text: string, overwrite = false) {
  writeFileSync(file, text, { mode: 0o644, flag: overwrite ? "w" : "wx" });
}
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

export interface KeygenResult {
  dir: string;
  files: Record<keyof typeof FILES, string>;
  enrollment: Enrollment;
}

/**
 * Generate a fresh assessor identity in `dir` (created 0700). Secrets are
 * written 0600 and never overwritten: an existing key file aborts the run.
 */
export async function keygen(opts: { dir: string; handle: string; affiliations?: string[]; seat?: number; now?: Date }): Promise<KeygenResult> {
  const dir = opts.dir;
  const handle = normaliseHandle(opts.handle);
  const affiliations = normaliseAffiliations(opts.affiliations ?? []);
  const seat = checkSeat(opts.seat ?? 0);
  const files = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, join(dir, f)])) as KeygenResult["files"];
  for (const k of ["cardanoSk", "cardanoSkey", "midnightSeat", "enrollment"] as const)
    if (existsSync(files[k])) throw new KitError(`${files[k]} already exists; refusing to overwrite an assessor identity (pick a new --out directory)`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  if (!existsSync(files.gitignore)) writePublic(files.gitignore, "# PlutusShield assessor secrets: never commit this directory\n*\n!enrollment.json\n!cardano-assessor.vkey\n");

  const createdAt = (opts.now ?? new Date()).toISOString();
  const cardano = generateCardanoKey();
  const seatFile: SeatFile = { schema: SEAT_SCHEMA, seat, sk: toHex(new Uint8Array(randomBytes(32))), createdAt };
  writeSecret(files.cardanoSk, `${cardano.skBech32}\n`);
  writeSecret(files.cardanoSkey, json(textEnvelope("skey", cardano.seed)));
  writeSecret(files.midnightSeat, json(seatFile));
  writePublic(files.cardanoVkey, json(textEnvelope("vkey", fromHex(cardano.vkey))), true);
  const enrollment = await buildEnrollment({ cardano, seatSk: seatFile.sk, handle, affiliations, createdAt });
  writePublic(files.enrollment, json(enrollment));
  return { dir, files, enrollment };
}

/** Re-label the local seat file once the team assigns a seat (the commitment does not depend on it). */
export function setSeat(dir: string, seat: number): { file: string; relayFileName: string } {
  const file = join(dir, FILES.midnightSeat);
  const m = parseSeatFile(readFileSync(file, "utf8"));
  m.seat = checkSeat(seat);
  writeFileSync(file, json(m), { mode: 0o600 });
  chmodSync(file, 0o600);
  return { file, relayFileName: `member-${seat}.json` };
}

/** Operator self-check: local secrets open the public record, and are 0600. */
export async function checkLocalSecrets(rec: Enrollment, dir: string): Promise<VerifyResult> {
  const problems: string[] = [];
  const mode = (f: string) => statSync(f).mode & 0o777;
  const skFile = join(dir, FILES.cardanoSk);
  const seatFile = join(dir, FILES.midnightSeat);
  for (const f of [skFile, seatFile]) {
    if (!existsSync(f)) {
      problems.push(`missing ${f}`);
      continue;
    }
    if (process.platform !== "win32" && mode(f) & 0o077) problems.push(`${f} is readable by others (mode ${mode(f).toString(8)}); chmod 600 it`);
  }
  if (existsSync(skFile)) {
    const k = parseCardanoSigningKey(readFileSync(skFile, "utf8"));
    if (k.keyHash !== rec.cardano.keyHash) problems.push(`${FILES.cardanoSk} does not match cardano.keyHash in the record`);
  }
  const skeyFile = join(dir, FILES.cardanoSkey);
  if (existsSync(skeyFile) && parseCardanoSigningKey(readFileSync(skeyFile, "utf8")).keyHash !== rec.cardano.keyHash)
    problems.push(`${FILES.cardanoSkey} does not match cardano.keyHash in the record`);
  if (existsSync(seatFile)) {
    const s = parseSeatFile(readFileSync(seatFile, "utf8"));
    if ((await seatCommitment(s.sk)) !== rec.midnight.seatCommitment) problems.push(`${FILES.midnightSeat} does not open midnight.seatCommitment in the record`);
  }
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Committee plan (dry run)
// ---------------------------------------------------------------------------

export interface CurrentDeployment {
  cardano?: { assessors: string[]; threshold: number; scriptHash?: string; address?: string; paramsCbor?: string; params?: unknown; record?: string };
  midnight?: { committee: string[]; threshold: number; contractAddress?: string; record?: string };
}

export interface CommitteePlan {
  schema: typeof PLAN_SCHEMA;
  dryRun: true;
  threshold: number;
  size: number;
  seats: { seat: number; cardanoIndex: number; handle: string; affiliations: string[]; keyHash: string; address: string; seatCommitment: string; enrollmentSha256: string; createdAt: string }[];
  cardano: {
    network: "preview";
    validator: string;
    committee: { assessors: string[]; threshold: number };
    committeeCbor: string;
    coverParams: unknown;
    coverParamsCbor: string | null;
    notes: string[];
  };
  midnight: {
    network: "preprod";
    contract: string;
    constructorArgs: { committee: string[]; m: number };
    env: Record<string, string>;
    seatFiles: { seat: number; handle: string; file: string }[];
    notes: string[];
  };
  changes: { cardano: { index: number; from: string | null; to: string }[]; midnight: { seat: number; from: string | null; to: string }[]; threshold: { cardano: number | null; midnight: number | null; to: number } };
  warnings: string[];
  runbook: string[];
  /** SHA-256 of the canonical seats + Cardano committee CBOR + Midnight constructor args (independent of repo state). */
  planSha256: string;
}

/** Turn three verified enrollment records into the redeploy parameters for both chains. Throws on any invalid input. */
export function planCommittee(records: unknown[], opts: { threshold?: number; current?: CurrentDeployment; now?: number } = {}): CommitteePlan {
  const threshold = opts.threshold ?? 2;
  if (records.length !== COMMITTEE_SIZE) throw new KitError(`a committee plan needs exactly ${COMMITTEE_SIZE} enrollment records (Midnight v2 has three seats), got ${records.length}`);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > COMMITTEE_SIZE) throw new KitError(`threshold must be 1..${COMMITTEE_SIZE} (got ${threshold})`);
  records.forEach((r, i) => {
    const v = verifyEnrollment(r, { now: opts.now });
    if (!v.ok) throw new KitError(`record ${i + 1} does not verify: ${v.problems.join("; ")}`);
  });
  const recs = records as Enrollment[];
  const dup = (xs: string[]) => xs.find((x, i) => xs.indexOf(x) !== i);
  const dk = dup(recs.map((r) => r.cardano.keyHash));
  if (dk) throw new KitError(`Cardano key hash ${dk} appears in two records; each seat needs its own key`);
  const ds = dup(recs.map((r) => r.midnight.seatCommitment));
  if (ds) throw new KitError(`Midnight seat commitment ${ds} appears in two records; each seat needs its own secret`);

  const committee = { assessors: recs.map((r) => r.cardano.keyHash), threshold: BigInt(threshold) };
  const problem = committeeProblem(committee);
  if (problem) throw new KitError(`invalid Cardano committee: ${problem}`);

  const warnings: string[] = [];
  const dh = dup(recs.map((r) => r.operator.handle.toLowerCase()));
  if (dh) warnings.push(`handle ${dh} holds more than one seat: the committee is not independent`);
  const aff = new Map<string, string[]>();
  for (const r of recs) for (const a of r.operator.affiliations) aff.set(a.toLowerCase(), [...(aff.get(a.toLowerCase()) ?? []), r.operator.handle]);
  for (const [a, hs] of aff) if (hs.length > 1) warnings.push(`${hs.join(" and ")} share the affiliation "${a}": both must recuse on claims touching it, which can stall a ${threshold}-of-3 vote`);
  const cur = opts.current;
  for (const r of recs) {
    if (cur?.cardano?.assessors.includes(r.cardano.keyHash)) warnings.push(`${r.operator.handle}'s Cardano key is already on the current (team-run) committee`);
    if (cur?.midnight?.committee.includes(r.midnight.seatCommitment)) warnings.push(`${r.operator.handle}'s Midnight seat is already on the current (team-run) committee`);
  }
  if (threshold === 1) warnings.push("threshold 1 lets any single seat decide a claim; v2 runs 2-of-3");
  if (threshold === COMMITTEE_SIZE) warnings.push("threshold 3 means one offline seat stalls every claim; v2 runs 2-of-3");

  const coverParams = cur?.cardano?.params
    ? { ...(cur.cardano.params as Record<string, unknown>), seed: "<fresh deployer UTxO chosen at InitPool>" }
    : null;
  const seats = recs.map((r, i) => ({
    seat: i,
    cardanoIndex: i + 1,
    handle: r.operator.handle,
    affiliations: r.operator.affiliations,
    keyHash: r.cardano.keyHash,
    address: r.cardano.address,
    seatCommitment: r.midnight.seatCommitment,
    enrollmentSha256: enrollmentDigest(r),
    createdAt: r.createdAt,
  }));
  const core = {
    schema: PLAN_SCHEMA,
    dryRun: true as const,
    threshold,
    size: COMMITTEE_SIZE,
    seats,
    cardano: {
      network: "preview" as const,
      validator: "contracts/cardano/validators/exploit_cover.ak (exploit_cover.exploit_cover, params: CoverParams, committee: Committee)",
      committee: { assessors: committee.assessors, threshold },
      committeeCbor: toCborHex(committeeData(committee)),
      coverParams,
      coverParamsCbor: cur?.cardano?.paramsCbor ?? null,
      notes: [
        "Committee { assessors: List<VerificationKeyHash>, threshold: Int } is the validator's second parameter; committeeCbor is exactly what applyParamsToScript receives.",
        "A redeploy is a new pool: InitPool spends a fresh seed UTxO, so the script hash and address change. coverParamsCbor is the CURRENT v2 value for reference; its seed field is replaced at InitPool and every other field carries over.",
        `Settle pays only with ${threshold} distinct signatures among these ${COMMITTEE_SIZE} key hashes; InitPool refuses a malformed committee (committee_ok).`,
      ],
    },
    midnight: {
      network: "preprod" as const,
      contract: "contracts/midnight/src/policy-cover-v2.compact",
      constructorArgs: { committee: seats.map((s) => s.seatCommitment), m: threshold },
      env: { PLUTUSSHIELD_COVER_VERSION: "2", PLUTUSSHIELD_COMMITTEE_M: String(threshold) },
      seatFiles: seats.map((s) => ({ seat: s.seat, handle: s.handle, file: `member-${s.seat}.json (kept by ${s.handle}, never sent to the team)` })),
      notes: [
        "constructor(committee: Vector<3, Bytes<32>>, m: Uint<8>) asserts 1 <= m <= 3, no empty member and three distinct members; this plan already checked all three.",
        "Deploying needs only the three public commitments. Each operator keeps their own seat secret and casts voteClaim from their own machine (relay --vote <policyId> --member <seat>).",
        "A redeploy is a new contract address; v1 and the current v2 registry stay readable as history.",
      ],
    },
    changes: {
      cardano: committee.assessors.map((to, i) => ({ index: i + 1, from: cur?.cardano?.assessors[i] ?? null, to })),
      midnight: seats.map((s) => ({ seat: s.seat, from: cur?.midnight?.committee[s.seat] ?? null, to: s.seatCommitment })),
      threshold: { cardano: cur?.cardano?.threshold ?? null, midnight: cur?.midnight?.threshold ?? null, to: threshold },
    },
    warnings,
    runbook: [
      "1. Each operator: `committee keygen --out <dir> --handle @you` on their own machine, then shares ONLY enrollment.json (public).",
      "2. Team: `committee verify <record>` for each record, confirms the handle out of band, then `committee plan a.json b.json c.json --threshold 2 --out plan.json`.",
      "3. All three operators re-run `committee plan` on the same records and compare planSha256 before anything is deployed.",
      "4. Each operator: `committee seat --dir <dir> --seat <n>` so their local seat file matches the relay's member-<n>.json.",
      "5. Redeploy (not automated by this kit): exploit-cover InitPool with cardano.committee on Preview, and policy-cover-v2 deployContract with midnight.constructorArgs on Preprod; record both in contracts/*/deployments.",
      "6. Drill: one test claim, each seat votes from its own machine on Midnight, two seats co-sign the Cardano Settle. Only then retire the team-run committee.",
    ],
  };
  // Digest over what a redeploy actually fixes, so operators on any repo commit agree on it.
  const fixed = { schema: PLAN_SCHEMA, threshold, seats, committeeCbor: core.cardano.committeeCbor, midnightConstructor: core.midnight.constructorArgs };
  return { ...core, planSha256: sha256Hex(canonicalJson(fixed)) };
}

/** Read the live v2 records from the repo so the plan can show what changes. */
export function currentFromRepo(repoRoot: string): CurrentDeployment {
  const out: CurrentDeployment = {};
  const cf = join(repoRoot, "contracts/cardano/deploy/deployments/preview-exploit-v2.json");
  if (existsSync(cf)) {
    const r = JSON.parse(readFileSync(cf, "utf8"));
    out.cardano = {
      assessors: r.committee.assessors.map((a: { keyHash: string }) => a.keyHash),
      threshold: Number(r.committee.threshold),
      scriptHash: r.script?.hash,
      address: r.script?.address,
      paramsCbor: r.script?.paramsCbor,
      params: r.params,
      record: "contracts/cardano/deploy/deployments/preview-exploit-v2.json",
    };
  }
  const mf = join(repoRoot, "contracts/midnight/deployments/preprod-v2.json");
  if (existsSync(mf)) {
    const r = JSON.parse(readFileSync(mf, "utf8"));
    out.midnight = { committee: r.committee, threshold: Number(r.threshold), contractAddress: r.contractAddress, record: "contracts/midnight/deployments/preprod-v2.json" };
  }
  return out;
}
