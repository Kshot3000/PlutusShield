/**
 * CIP-30 wallet helpers that need no wallet library.
 *
 * A CIP-30 wallet (Lace, Eternl, Typhon, ...) returns balances and addresses
 * as CBOR / raw hex. These pure functions turn that into things the UI can
 * show and check: lovelace + native-asset quantities, bech32 addresses, and
 * the network the wallet is on. Kept dependency-free so the static site
 * bundle stays small and the logic is unit-tested in Node.
 */

// ---------------------------------------------------------------------------
// Minimal CBOR decoder (RFC 8949 subset used by Cardano `Value` and addresses)
// ---------------------------------------------------------------------------

export type Cbor = bigint | Uint8Array | Cbor[] | Map<Cbor, Cbor> | { tag: bigint; value: Cbor } | boolean | null;

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0 || /[^0-9a-f]/.test(clean)) throw new Error("invalid hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

const BREAK = Symbol("break");

export function decodeCbor(input: string | Uint8Array): Cbor {
  const bytes = typeof input === "string" ? hexToBytes(input) : input;
  let pos = 0;

  const need = (n: number) => {
    if (pos + n > bytes.length) throw new Error("truncated CBOR");
  };
  const readArg = (info: number): bigint | null => {
    if (info < 24) return BigInt(info);
    if (info === 31) return null; // indefinite length
    const len = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : -1;
    if (len < 0) throw new Error(`unsupported CBOR additional info ${info}`);
    need(len);
    let v = 0n;
    for (let i = 0; i < len; i++) v = (v << 8n) | BigInt(bytes[pos++]);
    return v;
  };
  const toLen = (v: bigint) => {
    if (v > BigInt(bytes.length)) throw new Error("CBOR length exceeds input");
    return Number(v);
  };

  const item = (): Cbor | typeof BREAK => {
    need(1);
    const head = bytes[pos++];
    const major = head >> 5;
    const info = head & 0x1f;
    if (head === 0xff) return BREAK;
    const arg = readArg(info);
    switch (major) {
      case 0:
        if (arg === null) throw new Error("indefinite uint");
        return arg;
      case 1:
        if (arg === null) throw new Error("indefinite nint");
        return -1n - arg;
      case 2: {
        if (arg === null) {
          const chunks: Uint8Array[] = [];
          for (;;) {
            const c = item();
            if (c === BREAK) break;
            if (!(c instanceof Uint8Array)) throw new Error("bad bytes chunk");
            chunks.push(c);
          }
          const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
          let o = 0;
          for (const c of chunks) (out.set(c, o), (o += c.length));
          return out;
        }
        const n = toLen(arg);
        need(n);
        const out = bytes.slice(pos, pos + n);
        pos += n;
        return out;
      }
      case 3: {
        // Text is not part of Value; decode as bytes so callers can ignore it.
        if (arg === null) throw new Error("indefinite text unsupported");
        const n = toLen(arg);
        need(n);
        const out = bytes.slice(pos, pos + n);
        pos += n;
        return out;
      }
      case 4: {
        const arr: Cbor[] = [];
        if (arg === null) {
          for (;;) {
            const c = item();
            if (c === BREAK) break;
            arr.push(c);
          }
        } else {
          for (let i = 0, n = toLen(arg); i < n; i++) arr.push(must(item()));
        }
        return arr;
      }
      case 5: {
        const map = new Map<Cbor, Cbor>();
        if (arg === null) {
          for (;;) {
            const k = item();
            if (k === BREAK) break;
            map.set(k, must(item()));
          }
        } else {
          for (let i = 0, n = toLen(arg); i < n; i++) map.set(must(item()), must(item()));
        }
        return map;
      }
      case 6: {
        if (arg === null) throw new Error("bad tag");
        const value = must(item());
        // Tag 258 (set) wraps arrays in newer eras; tags 2/3 are bignums.
        if (arg === 2n && value instanceof Uint8Array) return BigInt(`0x${bytesToHex(value) || "0"}`);
        if (arg === 3n && value instanceof Uint8Array) return -1n - BigInt(`0x${bytesToHex(value) || "0"}`);
        return { tag: arg, value };
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22 || info === 23) return null;
        throw new Error("CBOR floats are not used in Cardano values");
    }
    throw new Error("unreachable");
  };
  const must = (c: Cbor | typeof BREAK): Cbor => {
    if (c === BREAK) throw new Error("unexpected CBOR break");
    return c;
  };

  const out = must(item());
  if (pos !== bytes.length) throw new Error("trailing bytes after CBOR item");
  return out;
}

// ---------------------------------------------------------------------------
// Cardano Value (what CIP-30 `getBalance()` returns)
// ---------------------------------------------------------------------------

export interface WalletBalance {
  lovelace: bigint;
  /** keyed by "<policyIdHex>.<assetNameHex>" */
  assets: Map<string, bigint>;
}

/** Decode CIP-30 `getBalance()` CBOR: `coin` or `[coin, multiasset]`. */
export function parseValue(cborHex: string): WalletBalance {
  const v = decodeCbor(cborHex);
  const assets = new Map<string, bigint>();
  if (typeof v === "bigint") return { lovelace: v, assets };
  if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== "bigint" || !(v[1] instanceof Map))
    throw new Error("not a Cardano Value");
  for (const [policy, names] of v[1]) {
    if (!(policy instanceof Uint8Array) || policy.length !== 28 || !(names instanceof Map))
      throw new Error("bad multiasset entry");
    const pid = bytesToHex(policy);
    for (const [name, qty] of names) {
      if (!(name instanceof Uint8Array) || typeof qty !== "bigint") throw new Error("bad asset entry");
      const key = `${pid}.${bytesToHex(name)}`;
      assets.set(key, (assets.get(key) ?? 0n) + qty);
    }
  }
  return { lovelace: v[0], assets };
}

/** Quantity of one asset ("lovelace" or "<policy>.<name>") in a balance. */
export function balanceOf(b: WalletBalance, id: string): bigint {
  return id === "lovelace" ? b.lovelace : (b.assets.get(id.toLowerCase()) ?? 0n);
}

// ---------------------------------------------------------------------------
// Addresses: raw bytes (hex) -> bech32 per CIP-19
// ---------------------------------------------------------------------------

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

function toWords(bytes: Uint8Array): number[] {
  const words: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((acc >> bits) & 31);
    }
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31);
  return words;
}

/** Bech32 (BIP-173, not bech32m) without the 90-char limit, as Cardano uses. */
export function bech32Encode(hrp: string, data: Uint8Array): string {
  const words = toWords(data);
  const mod = polymod([...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i++) checksum.push((mod >> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...checksum].map((w) => CHARSET[w]).join("")}`;
}

export type AddressKind = "base" | "pointer" | "enterprise" | "reward" | "byron";

export interface DecodedAddress {
  bech32: string;
  kind: AddressKind;
  /** 0 = any testnet (Preview / Preprod), 1 = mainnet */
  networkId: number;
  /** payment credential hash (hex), when the address has one */
  paymentHash?: string;
  paymentIsScript?: boolean;
}

/**
 * CIP-30 returns addresses as hex bytes (or CBOR-wrapped bytes on some
 * wallets). Decode the header per CIP-19 and render bech32.
 */
export function decodeAddress(hexOrCbor: string): DecodedAddress {
  let raw = hexToBytes(hexOrCbor);
  // Some wallets wrap the address as a CBOR byte string (major type 2).
  if (raw.length > 2 && raw[0] >> 5 === 2) {
    try {
      const inner = decodeCbor(raw);
      if (inner instanceof Uint8Array && inner.length >= 29) raw = inner;
    } catch {
      /* not CBOR, treat as raw */
    }
  }
  const header = raw[0];
  const type = header >> 4;
  const networkId = header & 0x0f;
  if (type === 8) return { bech32: "(Byron address)", kind: "byron", networkId: -1 };
  if (type > 15 || (type > 7 && type < 14)) throw new Error(`unsupported address type ${type}`);
  const kind: AddressKind = type <= 3 ? "base" : type <= 5 ? "pointer" : type <= 7 ? "enterprise" : "reward";
  const prefix = kind === "reward" ? "stake" : "addr";
  const hrp = networkId === 1 ? prefix : `${prefix}_test`;
  const out: DecodedAddress = { bech32: bech32Encode(hrp, raw), kind, networkId };
  if (kind !== "reward" && raw.length >= 29) {
    out.paymentHash = bytesToHex(raw.slice(1, 29));
    out.paymentIsScript = (type & 1) === 1;
  }
  return out;
}

/** "addr_test1qz…k9xy" for compact display. */
export function shortAddress(bech32: string, head = 10, tail = 6): string {
  return bech32.length <= head + tail + 1 ? bech32 : `${bech32.slice(0, head)}…${bech32.slice(-tail)}`;
}

/**
 * CIP-30 `getNetworkId()` only distinguishes mainnet (1) from testnets (0).
 * PlutusShield's preview build needs a testnet wallet; mainnet is refused.
 */
export function networkLabel(networkId: number): "Mainnet" | "Testnet" | "Unknown" {
  return networkId === 1 ? "Mainnet" : networkId === 0 ? "Testnet" : "Unknown";
}

/** Format a base-unit quantity with `decimals` places, trimming trailing zeros. */
export function formatUnits(qty: bigint, decimals: number, maxFraction = 2): string {
  const neg = qty < 0n;
  const abs = neg ? -qty : qty;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${w}${frac ? `.${frac}` : ""}`;
}
