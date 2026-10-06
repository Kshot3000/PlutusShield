/**
 * Private evidence vault for exploit claims.
 *
 * An exploit claim can't be settled by an oracle, so the claimant writes up
 * what happened and an assessor reviews it. The write-up stays private: it is
 * serialized canonically, encrypted on the claimant's device with AES-256-GCM
 * under a fresh random key, and only a 32-byte commitment to it is meant to go
 * on the Midnight ledger through `fileClaim(policyId, evidenceCommitment)`.
 *
 *   bytes      = UTF-8(canonicalJson(bundle))            (RFC 8785 ordering)
 *   digest     = SHA-256(bytes)
 *   commitment = SHA-256(pad32("plutusshield:evidence:v1") || digest || salt)
 *
 * The commitment formula is exactly `evidenceCommitment(digest, salt)` in
 * contracts/midnight/src/policy-cover.compact: compact-runtime's
 * persistentHash over Vector<3, Bytes<32>> is SHA-256 of the 96 concatenated
 * bytes. The Midnight test suite checks this against the compiled contract.
 *
 * The salt makes the commitment hiding (a guessable bundle can't be confirmed
 * from the ledger). It travels with the AES key in the key file, so whoever
 * holds the key file can both read the bundle and check it against the ledger.
 *
 * Uses only WebCrypto (`globalThis.crypto`), so it runs unchanged in browsers
 * and Node 20+. Nothing here does any network I/O.
 */

export const EVIDENCE_SCHEMA = "plutusshield/evidence@1" as const;
export const EVIDENCE_ENVELOPE_SCHEMA = "plutusshield/evidence-envelope@1" as const;
export const EVIDENCE_KEY_SCHEMA = "plutusshield/evidence-key@1" as const;
/** Domain tag; the contract's `evidenceTag()` is this string right-padded with zeros to 32 bytes. */
export const EVIDENCE_TAG_TEXT = "plutusshield:evidence:v1";

export type EvidenceChain = "cardano" | "midnight";
export type IncidentKind = "logic-bug" | "oracle-manipulation" | "access-control" | "economic-attack" | "other";
export const INCIDENT_KINDS: { id: IncidentKind; label: string }[] = [
  { id: "logic-bug", label: "Validator / contract logic bug" },
  { id: "oracle-manipulation", label: "Oracle manipulation" },
  { id: "access-control", label: "Key or admin compromise" },
  { id: "economic-attack", label: "Economic attack (flash, MEV, governance)" },
  { id: "other", label: "Other" },
];

export const EVIDENCE_LIMITS = {
  protocolName: 120,
  contract: 200,
  contracts: 32,
  descriptionMin: 20,
  descriptionMax: 20_000,
  txHashes: 64,
  attachments: 64,
  attachmentName: 255,
  asset: 130,
} as const;

export interface EvidenceAttachment {
  /** File name as the claimant saw it. Only the name, type, size and hash enter the bundle. */
  name: string;
  mediaType: string;
  size: number;
  /** Lowercase hex SHA-256 of the file bytes. */
  sha256: string;
}

export interface EvidenceInput {
  /** 32-byte policy id (64 hex), the key fileClaim uses on Midnight. */
  policyId: string;
  protocol: { name: string; chain: EvidenceChain; contracts: string[] };
  incident: { kind: IncidentKind; description: string; startedAt: string | Date; detectedAt: string | Date };
  /** 32-byte transaction ids (64 hex) of the exploit transactions. */
  txHashes: string[];
  /** Loss as a positive decimal string in whole units of `asset` (e.g. "1250.5" ADA). */
  loss: { amount: string; asset: string };
  attachments?: EvidenceAttachment[];
  /** Bundle creation time; defaults to now. */
  createdAt?: string | Date;
}

/** The normalized bundle: what is serialized, hashed, committed and encrypted. */
export interface EvidenceBundle {
  schema: typeof EVIDENCE_SCHEMA;
  product: "exploit";
  policyId: string;
  protocol: { name: string; chain: EvidenceChain; contracts: string[] };
  incident: { kind: IncidentKind; description: string; startedAt: string; detectedAt: string };
  txHashes: string[];
  loss: { amount: string; asset: string };
  attachments: EvidenceAttachment[];
  createdAt: string;
}

/** The encrypted bundle file. Safe to store or send anywhere: it reveals only the policy id and commitment. */
export interface EvidenceEnvelope {
  schema: typeof EVIDENCE_ENVELOPE_SCHEMA;
  alg: "AES-256-GCM";
  policyId: string;
  commitment: string;
  /** 12-byte GCM nonce, hex. */
  iv: string;
  /** Base64 ciphertext + 16-byte tag. The header fields above are bound as additional data. */
  ciphertext: string;
}

/** The key file: AES key + commitment salt. Whoever has it can read the bundle. Share only with the assessor. */
export interface EvidenceKeyFile {
  schema: typeof EVIDENCE_KEY_SCHEMA;
  policyId: string;
  commitment: string;
  key: string;
  salt: string;
}

export interface SealedEvidence {
  bundle: EvidenceBundle;
  /** Canonical UTF-8 bytes of the bundle. */
  bytes: Uint8Array;
  digest: string;
  commitment: string;
  envelope: EvidenceEnvelope;
  keyFile: EvidenceKeyFile;
}

export interface EvidenceIssue {
  path: string;
  message: string;
}

export type EvidenceErrorCode = "invalid" | "format" | "key-mismatch" | "decrypt" | "not-canonical" | "commitment";

export class EvidenceError extends Error {
  readonly code: EvidenceErrorCode;
  readonly issues: EvidenceIssue[];
  constructor(code: EvidenceErrorCode, message: string, issues: EvidenceIssue[] = []) {
    super(message);
    this.name = "EvidenceError";
    this.code = code;
    this.issues = issues;
  }
}

// ---------------------------------------------------------------------------
// Bytes, hex, base64, WebCrypto
// ---------------------------------------------------------------------------

type Bytes = Uint8Array<ArrayBuffer>;

const HEX32 = /^[0-9a-f]{64}$/;
const own = (b: Uint8Array): Bytes => new Uint8Array(b);

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("WebCrypto (globalThis.crypto.subtle) is unavailable; use a modern browser over HTTPS or Node 20+");
  return c.subtle;
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function fromHex(hex: string, len?: number): Bytes {
  const h = hex.trim().toLowerCase();
  if (h.length % 2 || /[^0-9a-f]/.test(h) || (len !== undefined && h.length !== len * 2)) {
    throw new EvidenceError("format", len ? `expected ${len} bytes of hex` : "invalid hex");
  }
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Bytes {
  let bin: string;
  try {
    bin = atob(b64.replace(/\s+/g, ""));
  } catch {
    throw new EvidenceError("format", "ciphertext is not valid base64");
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const utf8 = (s: string): Bytes => own(new TextEncoder().encode(s));

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest("SHA-256", own(data)));
}

/** Lowercase hex SHA-256 of a file's bytes, for EvidenceAttachment.sha256. */
export async function hashAttachment(bytes: Uint8Array): Promise<string> {
  return toHex(await sha256(bytes));
}

// ---------------------------------------------------------------------------
// Canonical serialization
// ---------------------------------------------------------------------------

/**
 * Deterministic JSON: object keys sorted by UTF-16 code units, no whitespace,
 * ECMAScript string escaping. For the value subset used here (strings, safe
 * integers, booleans, null, arrays, plain objects) this matches RFC 8785 (JCS).
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value)) throw new EvidenceError("invalid", `non-integer number in bundle: ${value}`);
      return String(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) throw new EvidenceError("invalid", "only plain objects can be serialized");
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      return `{${keys
        .map((k) => {
          if (obj[k] === undefined) throw new EvidenceError("invalid", `undefined value at key "${k}"`);
          return `${JSON.stringify(k)}:${canonicalJson(obj[k])}`;
        })
        .join(",")}}`;
    }
    default:
      throw new EvidenceError("invalid", `cannot serialize ${typeof value}`);
  }
}

export const encodeEvidence = (bundle: EvidenceBundle): Uint8Array => utf8(canonicalJson(bundle));

// ---------------------------------------------------------------------------
// Validation + normalization
// ---------------------------------------------------------------------------

const text = (s: unknown) => (typeof s === "string" ? s.normalize("NFC").trim() : "");

/** "1,250.50" → "1250.5"; "007" → "7". Returns null for anything that isn't a positive decimal. */
export function normalizeAmount(raw: string): string | null {
  const s = String(raw).replace(/[,_\s]/g, "");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const int = m[1].replace(/^0+(?=\d)/, "");
  const frac = (m[2] ?? "").replace(/0+$/, "");
  if (/^0*$/.test(int) && frac === "") return null;
  return frac ? `${int}.${frac}` : int;
}

function isoTime(v: string | Date | undefined): string | null {
  if (v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  const t = d.getTime();
  return Number.isFinite(t) ? d.toISOString() : null;
}

const CLOCK_SKEW_MS = 5 * 60_000;

/** All problems with an input, keyed by field path. Empty means buildEvidenceBundle will succeed. */
export function checkEvidence(input: EvidenceInput, now: Date = new Date()): EvidenceIssue[] {
  return normalize(input, now).issues;
}

/** Validate and normalize into the canonical bundle. Throws EvidenceError("invalid") listing every issue. */
export function buildEvidenceBundle(input: EvidenceInput, now: Date = new Date()): EvidenceBundle {
  const { bundle, issues } = normalize(input, now);
  if (issues.length || !bundle) {
    throw new EvidenceError("invalid", `invalid evidence: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`, issues);
  }
  return bundle;
}

function normalize(input: EvidenceInput, now: Date): { bundle: EvidenceBundle | null; issues: EvidenceIssue[] } {
  const issues: EvidenceIssue[] = [];
  const bad = (path: string, message: string) => issues.push({ path, message });
  const L = EVIDENCE_LIMITS;

  const policyId = text(input?.policyId).toLowerCase();
  if (!HEX32.test(policyId)) bad("policyId", "must be a 32-byte policy id (64 hex characters)");

  const name = text(input?.protocol?.name);
  if (!name) bad("protocol.name", "required");
  else if (name.length > L.protocolName) bad("protocol.name", `at most ${L.protocolName} characters`);

  const chain = input?.protocol?.chain;
  if (chain !== "cardano" && chain !== "midnight") bad("protocol.chain", "must be cardano or midnight");

  const contracts: string[] = [];
  for (const c of input?.protocol?.contracts ?? []) {
    const v = text(c);
    if (!v) continue;
    if (v.length > L.contract) bad("protocol.contracts", `each entry at most ${L.contract} characters`);
    else if (!contracts.includes(v)) contracts.push(v);
  }
  if (!contracts.length) bad("protocol.contracts", "name at least one affected contract (script hash, address, or validator)");
  if (contracts.length > L.contracts) bad("protocol.contracts", `at most ${L.contracts} entries`);

  const kind = input?.incident?.kind;
  if (!INCIDENT_KINDS.some((k) => k.id === kind)) bad("incident.kind", "unknown incident kind");

  const description = text(input?.incident?.description);
  if (description.length < L.descriptionMin) bad("incident.description", `describe the exploit in at least ${L.descriptionMin} characters`);
  else if (description.length > L.descriptionMax) bad("incident.description", `at most ${L.descriptionMax} characters`);

  const nowMs = now.getTime();
  const createdAt = input?.createdAt === undefined ? now.toISOString() : isoTime(input.createdAt);
  if (!createdAt) bad("createdAt", "not a valid time");
  const createdMs = createdAt ? Date.parse(createdAt) : nowMs;
  if (createdAt && createdMs > nowMs + CLOCK_SKEW_MS) bad("createdAt", "is in the future");

  const startedAt = isoTime(input?.incident?.startedAt);
  const detectedAt = isoTime(input?.incident?.detectedAt);
  if (!startedAt) bad("incident.startedAt", "required (when the exploit began)");
  if (!detectedAt) bad("incident.detectedAt", "required (when it was detected)");
  if (startedAt && detectedAt && Date.parse(detectedAt) < Date.parse(startedAt)) {
    bad("incident.detectedAt", "can't be before the exploit started");
  }
  if (startedAt && Date.parse(startedAt) > createdMs + CLOCK_SKEW_MS) bad("incident.startedAt", "is in the future");
  if (detectedAt && Date.parse(detectedAt) > createdMs + CLOCK_SKEW_MS) bad("incident.detectedAt", "is in the future");

  const txHashes: string[] = [];
  for (const h of input?.txHashes ?? []) {
    const v = text(h).toLowerCase();
    if (!v) continue;
    if (!HEX32.test(v)) bad("txHashes", `not a 32-byte transaction id: ${v.slice(0, 20)}${v.length > 20 ? "…" : ""}`);
    else if (!txHashes.includes(v)) txHashes.push(v);
  }
  if (!txHashes.length && !issues.some((i) => i.path === "txHashes")) bad("txHashes", "list at least one exploit transaction");
  if (txHashes.length > L.txHashes) bad("txHashes", `at most ${L.txHashes} transactions`);

  const amount = normalizeAmount(input?.loss?.amount ?? "");
  if (!amount) bad("loss.amount", "must be a positive decimal amount");
  const asset = text(input?.loss?.asset);
  if (!/^[A-Za-z0-9._-]+$/.test(asset) || asset.length > L.asset) bad("loss.asset", "ticker or policyId.assetName, letters/digits/._- only");

  const attachments: EvidenceAttachment[] = [];
  const raw = input?.attachments ?? [];
  if (raw.length > L.attachments) bad("attachments", `at most ${L.attachments} files`);
  raw.forEach((a, i) => {
    const n = text(a?.name);
    const sha = text(a?.sha256).toLowerCase();
    const mediaType = text(a?.mediaType) || "application/octet-stream";
    if (!n || n.length > L.attachmentName) bad(`attachments.${i}.name`, `1–${L.attachmentName} characters`);
    if (!HEX32.test(sha)) bad(`attachments.${i}.sha256`, "must be a SHA-256 hex digest");
    if (!Number.isSafeInteger(a?.size) || a.size < 0) bad(`attachments.${i}.size`, "must be a non-negative integer");
    if (attachments.some((x) => x.sha256 === sha)) bad(`attachments.${i}.sha256`, "duplicate file");
    attachments.push({ name: n, mediaType, size: a?.size, sha256: sha });
  });

  if (issues.length) return { bundle: null, issues };
  return {
    issues,
    bundle: {
      schema: EVIDENCE_SCHEMA,
      product: "exploit",
      policyId,
      protocol: { name, chain: chain as EvidenceChain, contracts },
      incident: { kind: kind as IncidentKind, description, startedAt: startedAt!, detectedAt: detectedAt! },
      txHashes,
      loss: { amount: amount!, asset },
      attachments,
      createdAt: createdAt!,
    },
  };
}

// ---------------------------------------------------------------------------
// Commitment (mirrors policy-cover.compact)
// ---------------------------------------------------------------------------

/** pad(32, "plutusshield:evidence:v1"), as the contract's evidenceTag(). */
export function evidenceTag(): Uint8Array {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(EVIDENCE_TAG_TEXT));
  return out;
}

/** SHA-256 of the canonical bundle bytes. */
export const evidenceDigest = (bytes: Uint8Array) => sha256(bytes);

/**
 * evidenceCommitment(digest, salt) from policy-cover.compact:
 * persistentHash<Vector<3, Bytes<32>>>([evidenceTag(), digest, salt]) = SHA-256(tag || digest || salt).
 */
export async function evidenceCommitment(digest: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  if (digest.length !== 32 || salt.length !== 32) throw new EvidenceError("format", "digest and salt must be 32 bytes");
  const buf = new Uint8Array(96);
  buf.set(evidenceTag(), 0);
  buf.set(digest, 32);
  buf.set(salt, 64);
  return sha256(buf);
}

/** The commitment for a bundle under a salt, as hex. */
export async function commitBundle(bundle: EvidenceBundle, salt: Uint8Array): Promise<{ digest: string; commitment: string }> {
  const digest = await evidenceDigest(encodeEvidence(bundle));
  return { digest: toHex(digest), commitment: toHex(await evidenceCommitment(digest, salt)) };
}

// ---------------------------------------------------------------------------
// Seal / open / verify
// ---------------------------------------------------------------------------

const header = (e: Pick<EvidenceEnvelope, "schema" | "alg" | "policyId" | "commitment">) =>
  utf8(canonicalJson({ alg: e.alg, commitment: e.commitment, policyId: e.policyId, schema: e.schema }));

async function aesKey(raw: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  return subtle().importKey("raw", own(raw), { name: "AES-GCM" }, false, [usage]);
}

export interface SealOptions {
  now?: Date;
  /** Inject randomness for tests / reproducible vectors. Defaults to fresh WebCrypto randomness. */
  key?: Uint8Array;
  salt?: Uint8Array;
  iv?: Uint8Array;
}

/** Build the canonical bundle, commit to it, and encrypt it. Runs entirely on this device. */
export async function sealEvidence(input: EvidenceInput, opts: SealOptions = {}): Promise<SealedEvidence> {
  const bundle = buildEvidenceBundle(input, opts.now);
  const key = opts.key ?? randomBytes(32);
  const salt = opts.salt ?? randomBytes(32);
  const iv = opts.iv ?? randomBytes(12);
  if (key.length !== 32 || salt.length !== 32 || iv.length !== 12) throw new EvidenceError("format", "key and salt must be 32 bytes, iv 12");

  const bytes = encodeEvidence(bundle);
  const digest = await evidenceDigest(bytes);
  const commitment = toHex(await evidenceCommitment(digest, salt));
  const head = { schema: EVIDENCE_ENVELOPE_SCHEMA, alg: "AES-256-GCM" as const, policyId: bundle.policyId, commitment };
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv: own(iv), additionalData: header(head), tagLength: 128 },
    await aesKey(key, "encrypt"),
    own(bytes),
  );
  return {
    bundle,
    bytes,
    digest: toHex(digest),
    commitment,
    envelope: { ...head, iv: toHex(iv), ciphertext: toBase64(new Uint8Array(ct)) },
    keyFile: { schema: EVIDENCE_KEY_SCHEMA, policyId: bundle.policyId, commitment, key: toHex(key), salt: toHex(salt) },
  };
}

function obj(v: unknown, what: string): Record<string, unknown> {
  let o = v;
  if (typeof o === "string") {
    try {
      o = JSON.parse(o);
    } catch {
      throw new EvidenceError("format", `${what} is not valid JSON`);
    }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new EvidenceError("format", `${what} is not a JSON object`);
  return o as Record<string, unknown>;
}

const field = (o: Record<string, unknown>, k: string, what: string): string => {
  const v = o[k];
  if (typeof v !== "string") throw new EvidenceError("format", `${what}: missing "${k}"`);
  return v;
};

/** Parse and shape-check an envelope (object or JSON text). */
export function parseEnvelope(v: unknown): EvidenceEnvelope {
  const o = obj(v, "Evidence bundle");
  if (o.schema === EVIDENCE_KEY_SCHEMA) throw new EvidenceError("format", "this is a key file, not an encrypted bundle");
  if (o.schema !== EVIDENCE_ENVELOPE_SCHEMA) throw new EvidenceError("format", "not a PlutusShield encrypted evidence bundle");
  if (o.alg !== "AES-256-GCM") throw new EvidenceError("format", `unsupported algorithm ${String(o.alg)}`);
  const env: EvidenceEnvelope = {
    schema: EVIDENCE_ENVELOPE_SCHEMA,
    alg: "AES-256-GCM",
    policyId: field(o, "policyId", "bundle").toLowerCase(),
    commitment: field(o, "commitment", "bundle").toLowerCase(),
    iv: field(o, "iv", "bundle").toLowerCase(),
    ciphertext: field(o, "ciphertext", "bundle"),
  };
  if (!HEX32.test(env.policyId) || !HEX32.test(env.commitment)) throw new EvidenceError("format", "bundle header is malformed");
  fromHex(env.iv, 12);
  return env;
}

/** Parse and shape-check a key file (object or JSON text). */
export function parseKeyFile(v: unknown): EvidenceKeyFile {
  const o = obj(v, "Key file");
  if (o.schema === EVIDENCE_ENVELOPE_SCHEMA) throw new EvidenceError("format", "this is the encrypted bundle, not the key file");
  if (o.schema !== EVIDENCE_KEY_SCHEMA) throw new EvidenceError("format", "not a PlutusShield evidence key file");
  const k: EvidenceKeyFile = {
    schema: EVIDENCE_KEY_SCHEMA,
    policyId: field(o, "policyId", "key file").toLowerCase(),
    commitment: field(o, "commitment", "key file").toLowerCase(),
    key: field(o, "key", "key file").toLowerCase(),
    salt: field(o, "salt", "key file").toLowerCase(),
  };
  if (![k.policyId, k.commitment, k.key, k.salt].every((x) => HEX32.test(x))) throw new EvidenceError("format", "key file is malformed");
  return k;
}

export interface OpenedEvidence {
  bundle: EvidenceBundle;
  digest: string;
  commitment: string;
}

/**
 * Decrypt an envelope with its key file and check the opening: the plaintext
 * must be the canonical encoding of a valid bundle, and
 * evidenceCommitment(SHA-256(plaintext), salt) must equal the envelope's
 * commitment. Throws EvidenceError on any failure.
 */
export async function openEvidence(envelope: unknown, keyFile: unknown): Promise<OpenedEvidence> {
  const env = parseEnvelope(envelope);
  const kf = parseKeyFile(keyFile);
  if (kf.commitment !== env.commitment || kf.policyId !== env.policyId) {
    throw new EvidenceError("key-mismatch", "this key file belongs to a different bundle");
  }
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(
      await subtle().decrypt(
        { name: "AES-GCM", iv: fromHex(env.iv, 12), additionalData: header(env), tagLength: 128 },
        await aesKey(fromHex(kf.key, 32), "decrypt"),
        fromBase64(env.ciphertext),
      ),
    );
  } catch (e) {
    if (e instanceof EvidenceError) throw e;
    throw new EvidenceError("decrypt", "decryption failed: wrong key, or the bundle was modified");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain));
  } catch {
    throw new EvidenceError("not-canonical", "decrypted bundle is not valid UTF-8 JSON");
  }
  const p = parsed as EvidenceBundle;
  if (p?.schema !== EVIDENCE_SCHEMA || p?.product !== "exploit") throw new EvidenceError("not-canonical", "decrypted data is not an evidence bundle");
  let bundle: EvidenceBundle;
  try {
    bundle = buildEvidenceBundle(p, new Date(Math.max(Date.now(), Date.parse(p.createdAt) || 0)));
  } catch (e) {
    throw new EvidenceError("not-canonical", e instanceof Error ? e.message : "invalid bundle");
  }
  if (canonicalJson(bundle) !== canonicalJson(parsed) || toHex(encodeEvidence(bundle)) !== toHex(plain)) {
    throw new EvidenceError("not-canonical", "decrypted bundle is not in canonical form");
  }
  if (bundle.policyId !== env.policyId) throw new EvidenceError("not-canonical", "bundle policy id differs from the envelope");
  const { digest, commitment } = await commitBundle(bundle, fromHex(kf.salt, 32));
  if (commitment !== env.commitment) throw new EvidenceError("commitment", "opening does not match the commitment");
  return { bundle, digest, commitment };
}

export type EvidenceCheckId = "files" | "decrypt" | "canonical" | "commitment" | "ledger";

export interface EvidenceCheck {
  id: EvidenceCheckId;
  label: string;
  /** null = not run (an earlier check failed, or no ledger commitment given). */
  ok: boolean | null;
  detail: string;
}

export interface EvidenceVerification {
  /** True only if the bundle opens AND matches the expected on-ledger commitment. */
  ok: boolean;
  checks: EvidenceCheck[];
  bundle?: EvidenceBundle;
  commitment?: string;
  digest?: string;
}

/**
 * Assessor-side verification. Never throws; returns each check so a UI can
 * show exactly which step failed. Pass the commitment read from the policy's
 * Midnight record as `expectedCommitment`.
 */
export async function verifyEvidence(envelope: unknown, keyFile: unknown, expectedCommitment?: string): Promise<EvidenceVerification> {
  const checks: EvidenceCheck[] = [
    { id: "files", label: "Bundle and key file", ok: null, detail: "" },
    { id: "decrypt", label: "Decrypts (AES-256-GCM, header bound)", ok: null, detail: "" },
    { id: "canonical", label: "Canonical, valid bundle", ok: null, detail: "" },
    { id: "commitment", label: "Opening matches commitment", ok: null, detail: "" },
    { id: "ledger", label: "Matches on-ledger commitment", ok: null, detail: "" },
  ];
  const set = (id: EvidenceCheckId, ok: boolean | null, detail: string) => {
    const c = checks.find((x) => x.id === id)!;
    c.ok = ok;
    c.detail = detail;
  };
  const failAt: Record<EvidenceErrorCode, EvidenceCheckId> = {
    invalid: "canonical",
    format: "files",
    "key-mismatch": "files",
    decrypt: "decrypt",
    "not-canonical": "canonical",
    commitment: "commitment",
  };
  const order: EvidenceCheckId[] = ["files", "decrypt", "canonical", "commitment"];
  try {
    const opened = await openEvidence(envelope, keyFile);
    set("files", true, "Well-formed, and the key file names this bundle's commitment.");
    set("decrypt", true, "Ciphertext and header authenticated.");
    set("canonical", true, "Plaintext is the canonical encoding of a valid exploit bundle.");
    set("commitment", true, `evidenceCommitment(SHA-256(bundle), salt) = ${opened.commitment.slice(0, 16)}…`);
    const expected = (expectedCommitment ?? "").trim().toLowerCase().replace(/^0x/, "");
    if (!expected) set("ledger", null, "Paste the evidence commitment from the policy's Midnight record to finish.");
    else if (!HEX32.test(expected)) set("ledger", false, "Expected commitment must be 64 hex characters.");
    else if (expected === opened.commitment) set("ledger", true, "Identical to the commitment filed with fileClaim.");
    else set("ledger", false, "Different commitment: this is not the evidence that was filed.");
    const ledger = checks.find((c) => c.id === "ledger")!;
    return { ok: ledger.ok === true, checks, bundle: opened.bundle, commitment: opened.commitment, digest: opened.digest };
  } catch (e) {
    const err = e instanceof EvidenceError ? e : new EvidenceError("format", e instanceof Error ? e.message : String(e));
    const at = failAt[err.code];
    for (const id of order) {
      if (id === at) break;
      set(id, true, "");
    }
    set(at, false, err.message);
    set("ledger", null, "Not checked.");
    return { ok: false, checks };
  }
}

export interface AttachmentMatch {
  name: string;
  sha256: string;
  /** The bundle attachment with the same hash, if any. */
  matches: EvidenceAttachment | null;
}

/** Check files the claimant handed over against the hashes committed in the bundle. */
export async function matchAttachments(
  bundle: EvidenceBundle,
  files: { name: string; bytes: Uint8Array }[],
): Promise<{ files: AttachmentMatch[]; missing: EvidenceAttachment[] }> {
  const out: AttachmentMatch[] = [];
  for (const f of files) {
    const h = await hashAttachment(f.bytes);
    out.push({ name: f.name, sha256: h, matches: bundle.attachments.find((a) => a.sha256 === h) ?? null });
  }
  const seen = new Set(out.map((f) => f.sha256));
  return { files: out, missing: bundle.attachments.filter((a) => !seen.has(a.sha256)) };
}

/** The two arguments of the Midnight `fileClaim` circuit, as bytes. */
export function fileClaimArgs(sealed: Pick<SealedEvidence, "commitment" | "bundle">): { policyId: Uint8Array; evidenceCommitment: Uint8Array } {
  return { policyId: fromHex(sealed.bundle.policyId, 32), evidenceCommitment: fromHex(sealed.commitment, 32) };
}

/** Pretty JSON for the downloadable files (parsing doesn't depend on formatting). */
export const evidenceFileText = (v: EvidenceEnvelope | EvidenceKeyFile) => `${JSON.stringify(v, null, 2)}\n`;
