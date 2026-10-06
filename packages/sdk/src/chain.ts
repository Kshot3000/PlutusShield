/**
 * Read live PlutusShield state off Cardano.
 *
 * - `decodePlutusData` turns inline-datum CBOR back into Plutus Data (the inverse
 *   of `encodePlutusData`), and `decodeCoverDatum` into the typed Pool / Policy
 *   datums the validator writes.
 * - `readPoolState` folds a list of UTxOs at the script address (the shape Koios
 *   `address_utxos` returns) into per-tranche capital, LP shares, active cover,
 *   utilization and share price, plus every live policy reference.
 *
 * Nothing here trusts the indexer's own datum JSON: the datum is re-decoded from
 * its CBOR bytes, and the pool UTxO is the one holding the pool NFT.
 */
import { decodeCbor, type Cbor } from "./cip30.ts";
import {
  BPS,
  POOL_NFT,
  REF_LABEL,
  bytesToHex,
  type Address,
  type AssetClass,
  type CoverDatum,
  type Credential,
  type OracleDatum,
  type PlutusData,
  type PolicyDatum,
  type PoolDatum,
} from "./cardano.ts";

// ------------------------------------------------------------- CBOR → data

function toData(c: Cbor): PlutusData {
  if (typeof c === "bigint") return { int: c };
  if (c instanceof Uint8Array) return { bytes: bytesToHex(c) };
  if (Array.isArray(c)) return { list: c.map(toData) };
  if (c instanceof Map) return { map: [...c.entries()].map(([k, v]) => ({ k: toData(k), v: toData(v) })) };
  if (c && typeof c === "object" && "tag" in c) {
    const t = c.tag;
    const fields = (v: Cbor): PlutusData[] => {
      if (!Array.isArray(v)) throw new Error("constructor fields must be a list");
      return v.map(toData);
    };
    if (t >= 121n && t <= 127n) return { constructor: Number(t - 121n), fields: fields(c.value) };
    if (t >= 1280n && t <= 1400n) return { constructor: Number(t - 1280n) + 7, fields: fields(c.value) };
    if (t === 102n) {
      const v = c.value;
      if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== "bigint") throw new Error("bad tag-102 constructor");
      return { constructor: Number(v[0]), fields: fields(v[1]) };
    }
    throw new Error(`unexpected CBOR tag ${t} in Plutus data`);
  }
  throw new Error("value is not Plutus data");
}

/** Decode Plutus Data from CBOR hex (inline datums, redeemers). */
export const decodePlutusData = (cborHex: string): PlutusData => toData(decodeCbor(cborHex));

// ------------------------------------------------------------- data → types

const fail = (what: string): never => {
  throw new Error(`malformed datum: ${what}`);
};
const asConstr = (d: PlutusData, index: number | null, arity: number, what: string): PlutusData[] => {
  if (!("fields" in d)) return fail(`${what} is not a constructor`);
  if (index !== null && d.constructor !== index) return fail(`${what} has constructor ${d.constructor}`);
  if (d.fields.length !== arity) return fail(`${what} has ${d.fields.length} fields, expected ${arity}`);
  return d.fields;
};
const asInt = (d: PlutusData, what: string): bigint => ("int" in d ? d.int : fail(`${what} is not an int`));
const asBytes = (d: PlutusData, what: string): string => ("bytes" in d ? d.bytes : fail(`${what} is not bytes`));
const asList = (d: PlutusData, what: string): PlutusData[] => ("list" in d ? d.list : fail(`${what} is not a list`));

const assetClass = (d: PlutusData): AssetClass => {
  const [p, n] = asConstr(d, 0, 2, "AssetClass");
  return { policyId: asBytes(p, "policy id"), assetName: asBytes(n, "asset name") };
};
const credential = (d: PlutusData): Credential => {
  if (!("fields" in d) || d.constructor > 1) return fail("Credential");
  const [h] = asConstr(d, null, 1, "Credential");
  return { type: d.constructor === 0 ? "Key" : "Script", hash: asBytes(h, "credential hash") };
};
const address = (d: PlutusData): Address => {
  const [pay, stakeOpt] = asConstr(d, 0, 2, "Address");
  const out: Address = { payment: credential(pay) };
  if ("fields" in stakeOpt && stakeOpt.constructor === 0) {
    const [ref] = asConstr(stakeOpt, 0, 1, "Some(StakeCredential)");
    if ("fields" in ref && ref.constructor === 0) out.stake = credential(asConstr(ref, 0, 1, "Inline")[0]);
  }
  return out;
};

export function poolDatumFrom(d: PlutusData): PoolDatum {
  const [tranches] = asConstr(d, 0, 1, "PoolDatum");
  return {
    tranches: asList(tranches, "tranches").map((t) => {
      const [s, c] = asConstr(t, 0, 2, "Tranche");
      return { totalShares: asInt(s, "total_shares"), activeCover: asInt(c, "active_cover") };
    }),
  };
}

export function policyDatumFrom(d: PlutusData): PolicyDatum {
  const f = asConstr(d, 0, 10, "PolicyDatum");
  const [ca, th, w] = asConstr(f[7], 0, 3, "Trigger");
  return {
    policyId: asBytes(f[0], "policy_id"),
    productId: asBytes(f[1], "product_id"),
    asset: assetClass(f[2]),
    coverage: asInt(f[3], "coverage"),
    premium: asInt(f[4], "premium"),
    start: asInt(f[5], "start"),
    expiry: asInt(f[6], "expiry"),
    trigger: { coveredAsset: asBytes(ca, "covered_asset"), thresholdBps: asInt(th, "threshold"), windowMs: asInt(w, "window") },
    midnightCommitment: asBytes(f[8], "midnight_commitment"),
    refundTo: address(f[9]),
  };
}

/** Decode a PlutusShield script datum (`Pool(PoolDatum)` | `Policy(PolicyDatum)`) from CBOR hex. */
export function decodeCoverDatum(cborHex: string): CoverDatum {
  const d = decodePlutusData(cborHex);
  if (!("fields" in d)) return fail("CoverDatum");
  if (d.constructor === 0) return { kind: "Pool", pool: poolDatumFrom(asConstr(d, 0, 1, "Pool")[0]) };
  if (d.constructor === 1) return { kind: "Policy", policy: policyDatumFrom(asConstr(d, 1, 1, "Policy")[0]) };
  return fail(`CoverDatum constructor ${d.constructor}`);
}

/**
 * Decode an oracle feed UTxO's inline datum (`OracleDatum`). Returns
 * undefined for anything that is not exactly that shape, so stray UTxOs at a
 * feed address are skipped rather than trusted.
 */
export function decodeOracleDatum(cborHex: string | null | undefined): OracleDatum | undefined {
  if (!cborHex) return undefined;
  try {
    const f = asConstr(decodePlutusData(cborHex), 0, 4, "OracleDatum");
    return {
      coveredAsset: asBytes(f[0], "covered_asset"),
      priceBps: asInt(f[1], "price"),
      windowStart: asInt(f[2], "window_start"),
      windowEnd: asInt(f[3], "window_end"),
    };
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------- pool state

/** Minimal UTxO shape; Koios `address_utxos` (with `_extended: true`) returns a superset of this. */
export interface ChainUtxo {
  tx_hash: string;
  tx_index: number;
  /** Lovelace, as a decimal string. */
  value: string;
  asset_list?: { policy_id: string; asset_name: string | null; quantity: string }[] | null;
  inline_datum?: { bytes: string } | null;
  block_time?: number | null;
}

export interface LiveTranche {
  index: number;
  asset: AssetClass;
  /** Tranche capital held by the pool UTxO (lovelace includes the pool's own min-ada). */
  capital: bigint;
  totalShares: bigint;
  activeCover: bigint;
  /** activeCover / capital in basis points. */
  utilizationBps: bigint;
  /** Base units of capital per 1_000_000 LP shares (1_000_000 = 1:1). */
  sharePriceMicro: bigint;
  /** Capital that can still back new cover at `maxUtilizationBps`. */
  freeCapacity: bigint;
}

export interface LivePolicy {
  ref: string;
  policy: PolicyDatum;
  tranche: number;
  blockTime: number | null;
}

export interface LivePoolState {
  poolRef: string;
  tranches: LiveTranche[];
  policies: LivePolicy[];
  /** UTxOs at the address that are neither the pool nor a policy reference (e.g. stray sends). */
  ignored: number;
}

const unitOf = (a: AssetClass) => a.policyId + a.assetName;
const sameAsset = (a: AssetClass, b: AssetClass) => unitOf(a) === unitOf(b);

function amountOf(u: ChainUtxo, a: AssetClass): bigint {
  if (a.policyId === "") return BigInt(u.value);
  let n = 0n;
  for (const x of u.asset_list ?? []) if (x.policy_id === a.policyId && (x.asset_name ?? "") === a.assetName) n += BigInt(x.quantity);
  return n;
}
const holds = (u: ChainUtxo, policyId: string, name: (n: string) => boolean) =>
  (u.asset_list ?? []).some((x) => x.policy_id === policyId && name(x.asset_name ?? "") && BigInt(x.quantity) > 0n);

/**
 * Fold the UTxOs at the cover script address into live pool state.
 * `scriptHash` is the cover policy id (pool NFT + policy reference tokens),
 * `assets` the tranche assets in `CoverParams.assets` order.
 */
export function readPoolState(
  utxos: ChainUtxo[],
  scriptHash: string,
  assets: AssetClass[],
  maxUtilizationBps: bigint,
): LivePoolState {
  const pools = utxos.filter((u) => holds(u, scriptHash, (n) => n === POOL_NFT));
  if (pools.length !== 1) throw new Error(pools.length === 0 ? "pool NFT not found at the script address" : "pool NFT appears twice");
  const pool = pools[0];
  if (!pool.inline_datum?.bytes) throw new Error("pool UTxO has no inline datum");
  const d = decodeCoverDatum(pool.inline_datum.bytes);
  if (d.kind !== "Pool") throw new Error("pool UTxO does not carry a Pool datum");
  if (d.pool.tranches.length !== assets.length) throw new Error("pool datum tranche count does not match the deployment");

  const tranches: LiveTranche[] = d.pool.tranches.map((t, index) => {
    const asset = assets[index];
    const capital = amountOf(pool, asset);
    const cap = (capital * maxUtilizationBps) / BPS;
    return {
      index,
      asset,
      capital,
      totalShares: t.totalShares,
      activeCover: t.activeCover,
      utilizationBps: capital > 0n ? (t.activeCover * BPS) / capital : 0n,
      sharePriceMicro: t.totalShares > 0n ? (capital * 1_000_000n) / t.totalShares : 1_000_000n,
      freeCapacity: cap > t.activeCover ? cap - t.activeCover : 0n,
    };
  });

  const policies: LivePolicy[] = [];
  let ignored = 0;
  for (const u of utxos) {
    if (u === pool) continue;
    if (!holds(u, scriptHash, (n) => n.startsWith(REF_LABEL)) || !u.inline_datum?.bytes) {
      ignored++;
      continue;
    }
    try {
      const pd = decodeCoverDatum(u.inline_datum.bytes);
      if (pd.kind !== "Policy") throw new Error("not a policy");
      const tranche = assets.findIndex((a) => sameAsset(a, pd.policy.asset));
      if (tranche < 0) throw new Error("unknown tranche asset");
      policies.push({ ref: `${u.tx_hash}#${u.tx_index}`, policy: pd.policy, tranche, blockTime: u.block_time ?? null });
    } catch {
      ignored++;
    }
  }
  policies.sort((a, b) => Number(b.policy.start - a.policy.start));
  return { poolRef: `${pool.tx_hash}#${pool.tx_index}`, tranches, policies, ignored };
}

/** Fetch UTxOs at an address from a Koios endpoint (e.g. https://preview.koios.rest/api/v1). */
export async function fetchKoiosUtxos(
  baseUrl: string,
  address: string,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ChainUtxo[]> {
  const res = await fetchFn(`${baseUrl.replace(/\/$/, "")}/address_utxos`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ _addresses: [address], _extended: true }),
    signal,
  });
  if (!res.ok) throw new Error(`Koios ${res.status}`);
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) throw new Error("unexpected Koios response");
  return body as ChainUtxo[];
}

/** One UTxO as Blockfrost `/addresses/{address}/utxos` returns it. */
interface BlockfrostUtxo {
  tx_hash: string;
  output_index: number;
  amount: { unit: string; quantity: string }[];
  inline_datum: string | null;
}

/** Blockfrost's UTxO shape → the Koios-style `ChainUtxo` the readers here take. */
export function chainUtxoFromBlockfrost(u: BlockfrostUtxo): ChainUtxo {
  const lovelace = u.amount.find((a) => a.unit === "lovelace")?.quantity ?? "0";
  return {
    tx_hash: u.tx_hash,
    tx_index: u.output_index,
    value: lovelace,
    asset_list: u.amount
      .filter((a) => a.unit !== "lovelace")
      .map((a) => ({ policy_id: a.unit.slice(0, 56), asset_name: a.unit.slice(56), quantity: a.quantity })),
    inline_datum: u.inline_datum ? { bytes: u.inline_datum } : null,
    block_time: null,
  };
}

/**
 * Fetch UTxOs at an address from Blockfrost (e.g.
 * https://cardano-preview.blockfrost.io/api/v0). Unlike public Koios,
 * Blockfrost sends CORS headers to any origin, so a static site can call it.
 * Pages through results; an address with no UTxOs (404) is an empty list.
 */
export async function fetchBlockfrostUtxos(
  baseUrl: string,
  projectId: string,
  address: string,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ChainUtxo[]> {
  const out: ChainUtxo[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetchFn(`${baseUrl.replace(/\/$/, "")}/addresses/${address}/utxos?count=100&page=${page}`, {
      headers: { project_id: projectId, accept: "application/json" },
      signal,
    });
    if (res.status === 404) return out;
    if (!res.ok) throw new Error(`Blockfrost ${res.status}`);
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) throw new Error("unexpected Blockfrost response");
    out.push(...(body as BlockfrostUtxo[]).map(chainUtxoFromBlockfrost));
    if (body.length < 100) return out;
  }
  return out;
}
