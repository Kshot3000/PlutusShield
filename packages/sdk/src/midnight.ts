/**
 * Midnight private holder registration for a Cardano policy.
 *
 * Every PlutusShield policy NFT minted on Cardano is mirrored in the Midnight
 * `policy-cover.compact` registry under the same 32-byte policy id. The record
 * holds only commitments, produced on the buyer's device when they buy:
 *
 *   holderCommitment       = SHA-256(pad32("plutusshield:role:") || pad32("holder") || holderSecret)
 *   coverageCommitment     = SHA-256(coverageSalt || u64le(coverage))
 *   registrationCommitment = SHA-256(pad32("plutusshield:register:v1") || policyId || holderCommitment || coverageCommitment)
 *
 * These are exactly the contract's `roleCommitment(sk, holderTag())`,
 * `coverageCommitment(amount, salt)` (= `persistentCommit<Uint<64>>`) and
 * `registrationCommitment(policyId, holder, coverage)` pure circuits under
 * compact-runtime 0.16.0 / compactc 0.31.1: `persistentHash` over
 * `Vector<n, Bytes<32>>` is SHA-256 of the concatenated bytes, and
 * `persistentCommit` of a `Uint<64>` is SHA-256(opening || 8-byte little-endian
 * value). contracts/midnight/test cross-checks every formula against the
 * compiled contract and runs registerPolicy + proveCover with keys made here.
 *
 * The registration commitment goes into the Cardano policy datum
 * (`midnight_commitment`). The issuer's `registerPolicy` on Midnight refuses a
 * holder/coverage pair that doesn't open it, so the buyer, not the issuer,
 * decides which key owns the policy on Midnight.
 *
 * The holder secret never leaves the buyer's device unless they export it. It
 * is what `proveCover`, `fileClaim` and `rotateHolder` check (the
 * `localSecretKey` witness), so the "policy key" file is the private proof of
 * ownership: lose it and the Midnight side can't be proven; leak it and anyone
 * can prove or claim as you there.
 *
 * WebCrypto only; runs in browsers and Node 20+. No network I/O.
 */

export const POLICY_KEY_SCHEMA = "plutusshield/policy-key@1" as const;
export const POLICY_KEY_ENVELOPE_SCHEMA = "plutusshield/policy-key-envelope@1" as const;
export const ROLE_PREFIX_TEXT = "plutusshield:role:";
export const HOLDER_TAG_TEXT = "holder";
export const REGISTRATION_TAG_TEXT = "plutusshield:register:v1";
/** PBKDF2-SHA-256 iterations for passphrase-encrypted key backups (OWASP 2023 guidance). */
export const POLICY_KEY_KDF_ITERATIONS = 600_000;

const U64_MAX = (1n << 64n) - 1n;
const HEX32 = /^[0-9a-f]{64}$/;

type Bytes = Uint8Array<ArrayBuffer>;
const own = (b: Uint8Array): Bytes => new Uint8Array(b);

export class PolicyKeyError extends Error {
  readonly code: "format" | "mismatch" | "decrypt";
  constructor(code: "format" | "mismatch" | "decrypt", message: string) {
    super(message);
    this.name = "PolicyKeyError";
    this.code = code;
  }
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("WebCrypto (globalThis.crypto.subtle) is unavailable; use a modern browser over HTTPS or Node 20+");
  return c.subtle;
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function bytes32(v: Uint8Array | string, what: string): Bytes {
  if (typeof v !== "string") {
    if (v.length !== 32) throw new PolicyKeyError("format", `${what} must be 32 bytes`);
    return own(v);
  }
  const h = v.trim().toLowerCase().replace(/^0x/, "");
  if (!HEX32.test(h)) throw new PolicyKeyError("format", `${what} must be 32 bytes of hex`);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Text right-padded with zeros to 32 bytes: Compact's `pad(32, "...")`. */
export function pad32(text: string): Uint8Array {
  const b = new TextEncoder().encode(text);
  if (b.length > 32) throw new PolicyKeyError("format", "pad32: text longer than 32 bytes");
  const out = new Uint8Array(32);
  out.set(b);
  return out;
}

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(len);
  let o = 0;
  for (const p of parts) (buf.set(p, o), (o += p.length));
  return new Uint8Array(await subtle().digest("SHA-256", buf));
}

/** 8-byte little-endian encoding of a Uint<64>, as compact-runtime serializes it for hashing. */
export function u64le(v: bigint): Uint8Array {
  if (v < 0n || v > U64_MAX) throw new PolicyKeyError("format", "value does not fit Uint<64>");
  const out = new Uint8Array(8);
  let x = v;
  for (let i = 0; i < 8; i++) (out[i] = Number(x & 0xffn), (x >>= 8n));
  return out;
}

export const holderTag = () => pad32(HOLDER_TAG_TEXT);
export const registrationTag = () => pad32(REGISTRATION_TAG_TEXT);

/** Contract `roleCommitment(sk, tag)`. */
export async function roleCommitment(sk: Uint8Array | string, tag: Uint8Array): Promise<Uint8Array> {
  return sha256(pad32(ROLE_PREFIX_TEXT), bytes32(tag, "tag"), bytes32(sk, "secret key"));
}

/** Contract `roleCommitment(holderSecret, holderTag())`: what `assertHolder` checks. */
export const holderCommitment = (holderSecret: Uint8Array | string) => roleCommitment(holderSecret, holderTag());

/** Contract `coverageCommitment(amount, salt)` = `persistentCommit<Uint<64>>(amount, salt)`. */
export async function coverageCommitment(amount: bigint, salt: Uint8Array | string): Promise<Uint8Array> {
  return sha256(bytes32(salt, "coverage salt"), u64le(amount));
}

/** Contract `registrationCommitment(policyId, holder, coverage)`: the Cardano datum's `midnight_commitment`. */
export async function registrationCommitment(
  policyId: Uint8Array | string,
  holder: Uint8Array | string,
  coverage: Uint8Array | string,
): Promise<Uint8Array> {
  return sha256(registrationTag(), bytes32(policyId, "policy id"), bytes32(holder, "holder commitment"), bytes32(coverage, "coverage commitment"));
}

// ---------------------------------------------------------------------------
// Policy keys
// ---------------------------------------------------------------------------

/** The secrets a buyer generates before signing a Buy. */
export interface HolderSecrets {
  /** 32 random bytes, hex. The Midnight `localSecretKey` witness for this policy. */
  holderSecret: string;
  /** 32 random bytes, hex. Opening of the coverage commitment. */
  coverageSalt: string;
}

/**
 * Everything needed to act on Midnight as the holder of one policy, plus the
 * public commitments so the file can be checked against both chains.
 */
export interface PolicyKey extends HolderSecrets {
  schema: typeof POLICY_KEY_SCHEMA;
  /** Cardano network the policy was bought on, e.g. "preview". */
  network: string;
  /** 32-byte policy id (hex): the Cardano datum's policy_id and the Midnight registry key. */
  policyId: string;
  /** Coverage in base units (decimal string), the committed Uint<64>. */
  coverage: string;
  /** Payout currency ticker, informational. */
  asset?: string;
  /** Cover expiry, POSIX ms (decimal string), informational: registerPolicy's expiry argument. */
  expiry?: string;
  holderCommitment: string;
  coverageCommitment: string;
  /** = Cardano datum midnight_commitment. */
  registrationCommitment: string;
  /** Buy transaction hash, once known. */
  txHash?: string;
  /** Policy-datum UTxO ("txHash#index"), once known. */
  outRef?: string;
  createdAt: string;
}

export function newHolderSecrets(): HolderSecrets {
  const r = () => {
    const b = new Uint8Array(32);
    globalThis.crypto.getRandomValues(b);
    return toHex(b);
  };
  return { holderSecret: r(), coverageSalt: r() };
}

/** Derive all three commitments for a policy from the holder's secrets. Deterministic. */
export async function deriveRegistration(args: { policyId: string; coverage: bigint } & HolderSecrets) {
  const holder = await holderCommitment(args.holderSecret);
  const coverage = await coverageCommitment(args.coverage, args.coverageSalt);
  const registration = await registrationCommitment(args.policyId, holder, coverage);
  return { holderCommitment: toHex(holder), coverageCommitment: toHex(coverage), registrationCommitment: toHex(registration) };
}

export async function makePolicyKey(args: {
  network: string;
  policyId: string;
  coverage: bigint;
  secrets?: HolderSecrets;
  asset?: string;
  expiry?: bigint;
  txHash?: string;
  outRef?: string;
  now?: Date;
}): Promise<PolicyKey> {
  const secrets = args.secrets ?? newHolderSecrets();
  const policyId = toHex(bytes32(args.policyId, "policy id"));
  const s = { holderSecret: toHex(bytes32(secrets.holderSecret, "holder secret")), coverageSalt: toHex(bytes32(secrets.coverageSalt, "coverage salt")) };
  const c = await deriveRegistration({ policyId, coverage: args.coverage, ...s });
  const key: PolicyKey = {
    schema: POLICY_KEY_SCHEMA,
    network: args.network,
    policyId,
    coverage: args.coverage.toString(),
    ...s,
    ...c,
    createdAt: (args.now ?? new Date()).toISOString(),
  };
  if (args.asset) key.asset = args.asset;
  if (args.expiry !== undefined) key.expiry = args.expiry.toString();
  if (args.txHash) key.txHash = args.txHash.toLowerCase();
  if (args.outRef) key.outRef = args.outRef.toLowerCase();
  return key;
}

export interface PolicyKeyCheck {
  ok: boolean;
  /** Secrets re-derive the commitments the file states. */
  consistent: boolean;
  /** Registration commitment equals the Cardano datum's (when given). */
  matchesDatum: boolean | null;
  reason?: string;
}

/** Recompute a key's commitments from its secrets, and compare with the on-chain datum commitment if given. */
export async function checkPolicyKey(key: PolicyKey, datumCommitment?: string): Promise<PolicyKeyCheck> {
  try {
    const c = await deriveRegistration({ policyId: key.policyId, coverage: BigInt(key.coverage), holderSecret: key.holderSecret, coverageSalt: key.coverageSalt });
    const consistent =
      c.holderCommitment === key.holderCommitment.toLowerCase() &&
      c.coverageCommitment === key.coverageCommitment.toLowerCase() &&
      c.registrationCommitment === key.registrationCommitment.toLowerCase();
    const want = datumCommitment?.trim().toLowerCase();
    const matchesDatum = want ? c.registrationCommitment === want : null;
    const ok = consistent && matchesDatum !== false;
    return {
      ok,
      consistent,
      matchesDatum,
      reason: !consistent ? "The key's secrets don't produce the commitments it states." : matchesDatum === false ? "This key belongs to a different policy datum." : undefined,
    };
  } catch (e) {
    return { ok: false, consistent: false, matchesDatum: null, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Parse and validate a policy key from JSON text or an object. Throws PolicyKeyError. */
export function parsePolicyKey(input: string | unknown): PolicyKey {
  let v: unknown = input;
  if (typeof input === "string") {
    try {
      v = JSON.parse(input);
    } catch {
      throw new PolicyKeyError("format", "Not a JSON file");
    }
  }
  const o = v as Record<string, unknown>;
  if (!o || typeof o !== "object" || o.schema !== POLICY_KEY_SCHEMA) throw new PolicyKeyError("format", `Not a PlutusShield policy key (${POLICY_KEY_SCHEMA})`);
  for (const k of ["policyId", "holderSecret", "coverageSalt", "holderCommitment", "coverageCommitment", "registrationCommitment"]) {
    if (typeof o[k] !== "string" || !HEX32.test(String(o[k]).toLowerCase())) throw new PolicyKeyError("format", `${k} must be 32 bytes of hex`);
  }
  if (typeof o.coverage !== "string" || !/^\d+$/.test(o.coverage) || BigInt(o.coverage) > U64_MAX) throw new PolicyKeyError("format", "coverage must be a Uint<64> decimal string");
  if (typeof o.network !== "string") throw new PolicyKeyError("format", "network missing");
  return o as unknown as PolicyKey;
}

/**
 * The Midnight `policy-cover` private state for this holder: the
 * `localSecretKey` witness and the coverage opening `proveCover` needs.
 * Shape matches contracts/midnight/test (and any midnight-js witness provider).
 */
export function holderPrivateState(keys: PolicyKey | PolicyKey[]) {
  const list = Array.isArray(keys) ? keys : [keys];
  if (!list.length) throw new PolicyKeyError("format", "no policy keys");
  const sk = list[0].holderSecret;
  if (list.some((k) => k.holderSecret !== sk)) throw new PolicyKeyError("format", "one private state holds one holder secret; split keys by secret");
  return {
    sk: bytes32(sk, "holder secret"),
    openings: Object.fromEntries(list.map((k) => [k.policyId, { amount: BigInt(k.coverage), salt: bytes32(k.coverageSalt, "coverage salt") }])),
  };
}

/** registerPolicy's five arguments for the issuer relay, from a key and the Cardano datum commitment. */
export function registerPolicyArgs(key: PolicyKey) {
  if (key.expiry === undefined) throw new PolicyKeyError("format", "key has no expiry");
  return {
    policyId: bytes32(key.policyId, "policy id"),
    holderCommitment: bytes32(key.holderCommitment, "holder commitment"),
    coverage: bytes32(key.coverageCommitment, "coverage commitment"),
    expiry: BigInt(key.expiry),
    cardanoCommitment: bytes32(key.registrationCommitment, "registration commitment"),
  };
}

// ---------------------------------------------------------------------------
// Backup files: plain or passphrase-encrypted
// ---------------------------------------------------------------------------

export interface PolicyKeyEnvelope {
  schema: typeof POLICY_KEY_ENVELOPE_SCHEMA;
  kdf: { name: "PBKDF2-SHA-256"; iterations: number; salt: string };
  alg: "AES-256-GCM";
  /** Public, so a wallet can tell which policy a backup is for without the passphrase. Bound as AAD. */
  policyId: string;
  registrationCommitment: string;
  iv: string;
  ciphertext: string;
}

const b64 = (b: Uint8Array) => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};
const unb64 = (s: string): Bytes => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

async function passKey(passphrase: string, salt: Bytes, iterations: number) {
  const base = await subtle().importKey("raw", own(new TextEncoder().encode(passphrase.normalize("NFC"))), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

const aad = (e: Pick<PolicyKeyEnvelope, "schema" | "policyId" | "registrationCommitment">) =>
  own(new TextEncoder().encode(`${e.schema}|${e.policyId}|${e.registrationCommitment}`));

/** Encrypt a key under a passphrase (PBKDF2-SHA-256 -> AES-256-GCM). */
export async function encryptPolicyKey(key: PolicyKey, passphrase: string, iterations = POLICY_KEY_KDF_ITERATIONS): Promise<PolicyKeyEnvelope> {
  if (passphrase.length < 8) throw new PolicyKeyError("format", "Use a passphrase of at least 8 characters");
  const salt = own(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  const iv = own(globalThis.crypto.getRandomValues(new Uint8Array(12)));
  const head = { schema: POLICY_KEY_ENVELOPE_SCHEMA, policyId: key.policyId, registrationCommitment: key.registrationCommitment } as const;
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv, additionalData: aad(head) },
    await passKey(passphrase, salt, iterations),
    own(new TextEncoder().encode(JSON.stringify(key))),
  );
  return { ...head, kdf: { name: "PBKDF2-SHA-256", iterations, salt: toHex(salt) }, alg: "AES-256-GCM", iv: toHex(iv), ciphertext: b64(new Uint8Array(ct)) };
}

const fromHexAny = (h: string): Bytes => {
  if (!/^([0-9a-f]{2})+$/i.test(h)) throw new PolicyKeyError("format", "invalid hex");
  return own(new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16))));
};

export async function decryptPolicyKey(env: PolicyKeyEnvelope, passphrase: string): Promise<PolicyKey> {
  let pt: ArrayBuffer;
  try {
    pt = await subtle().decrypt(
      { name: "AES-GCM", iv: fromHexAny(env.iv), additionalData: aad(env) },
      await passKey(passphrase, fromHexAny(env.kdf.salt), env.kdf.iterations),
      unb64(env.ciphertext),
    );
  } catch {
    throw new PolicyKeyError("decrypt", "Wrong passphrase, or the file was changed");
  }
  const key = parsePolicyKey(new TextDecoder().decode(pt));
  if (key.policyId !== env.policyId || key.registrationCommitment !== env.registrationCommitment) throw new PolicyKeyError("mismatch", "Envelope header doesn't match the key inside");
  return key;
}

/** Read a backup file: a plain key, or an encrypted envelope (needs the passphrase). */
export async function readPolicyKeyFile(text: string, passphrase?: string): Promise<PolicyKey> {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new PolicyKeyError("format", "Not a JSON file");
  }
  const o = v as { schema?: string };
  if (o?.schema === POLICY_KEY_ENVELOPE_SCHEMA) {
    if (!passphrase) throw new PolicyKeyError("decrypt", "This backup is encrypted; enter its passphrase");
    return decryptPolicyKey(v as PolicyKeyEnvelope, passphrase);
  }
  return parsePolicyKey(v);
}

export const isEncryptedPolicyKey = (text: string) => {
  try {
    return (JSON.parse(text) as { schema?: string })?.schema === POLICY_KEY_ENVELOPE_SCHEMA;
  } catch {
    return false;
  }
};

export const policyKeyFileText = (v: PolicyKey | PolicyKeyEnvelope) => `${JSON.stringify(v, null, 2)}\n`;
export const policyKeyFileName = (policyId: string, encrypted = false) =>
  `plutusshield-policy-key-${policyId.slice(0, 12)}${encrypted ? ".encrypted" : ""}.json`;
