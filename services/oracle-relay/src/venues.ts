/**
 * Live venue adapters for the USDM peg feed.
 *
 * Each adapter returns a price series in bps of the USD peg, as the relay's
 * `RelayInput.sources` expects:
 *
 *   coingecko          CoinGecko USDM (id `usdm-2`) USD market chart. Sends
 *                      `x-cg-demo-api-key` when COINGECKO_DEMO_API_KEY or
 *                      COINGECKO_API_KEY is set; otherwise the public keyless path.
 *   minswap-ada-usdm   Minswap V2 ADA/USDM pool reserves (on-chain) converted to
 *                      USD with Kraken's ADA/USD hourly candles.
 *   minswap-usdcx-usdm Minswap V2 USDCx/USDM pool reserves (on-chain): USDM priced
 *                      against Circle's USDCx.
 *
 * Minswap legs read Cardano **mainnet** pool UTxOs (the same LP units GeckoTerminal
 * used to index). Prefer Blockfrost when `BLOCKFROST_PROJECT_ID` /
 * `BLOCKFROST_MAINNET_ID` is a mainnet token; Preview-only Blockfrost keys cannot
 * read mainnet, so we fall back to Koios mainnet (keyless). GeckoTerminal is no
 * longer the primary Minswap path.
 *
 * On-chain reads are spot reserves. We emit an end-stamped hourly series held at
 * that spot across the lookback so the relay's 24h TWAP / max-gap checks still
 * have complete data (fail closed if the pool UTxO cannot be fetched or decoded).
 *
 * The parsing is pure and unit-tested; `fetchJson` is injectable for tests.
 */
import type { RelayInput } from "./relay.ts";

/** Cardano USDM (Moneta): policy id + asset name "USDM". */
export const USDM_UNIT = "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad0014df105553444d";
export const USDM_POLICY = USDM_UNIT.slice(0, 56);
export const USDM_NAME = USDM_UNIT.slice(56);
/** Circle USDCx on Cardano mainnet. */
export const USDCX_UNIT = "1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378";
export const COINGECKO_ID = "usdm-2";
/** Minswap V2 LP / pool-auth policy. */
export const MINSWAP_V2_LP_POLICY = "f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c";
export const MINSWAP_V2_POOL_AUTH = "4d5350"; // "MSP"
export const MINSWAP_V2_POOL_ADDRESS =
  "addr1z84q0denmyep98ph3tmzwsmw0j7zau9ljmsqx6a4rvaau66j2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pq777e2a";

/** LP asset names (policy is MINSWAP_V2_LP_POLICY) — same ids formerly used with GeckoTerminal. */
export const POOLS = {
  "minswap-ada-usdm": `${MINSWAP_V2_LP_POLICY}7dd6988c5a86693c76aeec1ea94afa41770be0de21a775ca7a2a1eabdb6a0171`,
  "minswap-usdcx-usdm": `${MINSWAP_V2_LP_POLICY}1448500d5be7904281807b569bf2c7bb2204514a3d6a62441d1a5fc4f94f8d52`,
} as const;

export const HOUR = 3_600_000;
export type Sample = [number, number]; // [POSIX ms, bps of peg]
export type FetchInit = { method?: string; headers?: Record<string, string>; body?: string };
export type FetchJson = (url: string, init?: FetchInit) => Promise<unknown>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function coinGeckoDemoApiKey(): string | undefined {
  const k = (process.env.COINGECKO_DEMO_API_KEY ?? process.env.COINGECKO_API_KEY ?? "").trim();
  return k || undefined;
}

/** Blockfrost project id usable for Cardano mainnet pool reads (not Preview/Preprod). */
export function blockfrostMainnetProjectId(): string | undefined {
  for (const k of [
    process.env.BLOCKFROST_MAINNET_ID,
    process.env.BLOCKFROST_MAINNET_PROJECT_ID,
    process.env.BLOCKFROST_PROJECT_ID,
    process.env.BLOCKFROST_PREVIEW_ID,
  ]) {
    const v = (k ?? "").trim();
    if (v && v.toLowerCase().startsWith("mainnet")) return v;
  }
  return undefined;
}

function coinGeckoHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json", "User-Agent": "plutusshield-oracle-relay/0.1" };
  const key = coinGeckoDemoApiKey();
  if (key) h["x-cg-demo-api-key"] = key;
  return h;
}

/** Public free tiers rate-limit hard (HTTP 429), so back off and retry a few times. */
export const defaultFetchJson: FetchJson = async (url, init) => {
  const host = new URL(url).host;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "plutusshield-oracle-relay/0.1",
    ...(init?.headers ?? {}),
  };
  if (host.includes("coingecko.com")) Object.assign(headers, coinGeckoHeaders(), init?.headers ?? {});
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: init?.method, headers, body: init?.body });
    if (res.ok) return res.json();
    if (res.status !== 429 || attempt >= 2) throw new Error(`${res.status} ${res.statusText} from ${host}`);
    await sleep(Math.min(Number(res.headers.get("retry-after") ?? 0) * 1000 || 15_000 * (attempt + 1), 30_000));
  }
};

const toBps = (usd: number) => {
  if (!Number.isFinite(usd) || usd <= 0) throw new Error(`bad price ${usd}`);
  return Math.round(usd * 10_000);
};

/** Candles [openSec, close] -> end-stamped hourly samples, forward-filled across no-trade hours, clipped to `now`. */
export function candlesToSeries(candles: [number, number][], now: number, step = HOUR): [number, number][] {
  const byEnd = new Map<number, number>();
  for (const [openSec, close] of candles) byEnd.set(openSec * 1000 + step, close);
  const ends = [...byEnd.keys()].sort((a, b) => a - b);
  if (!ends.length) return [];
  const out: [number, number][] = [];
  let last = byEnd.get(ends[0])!;
  for (let t = ends[0]; t <= now; t += step) {
    if (byEnd.has(t)) last = byEnd.get(t)!;
    out.push([t, last]);
  }
  return out;
}

/** Hold a spot price as an end-stamped hourly series over `lookbackMs` ending at `now`. */
export function spotToSeries(spot: number, now: number, lookbackMs = 48 * HOUR, step = HOUR): Sample[] {
  if (!Number.isFinite(spot) || spot <= 0) throw new Error(`bad spot ${spot}`);
  const bps = toBps(spot);
  const firstEnd = now - (now % step) - lookbackMs + step;
  const out: Sample[] = [];
  for (let t = firstEnd; t <= now; t += step) out.push([t, bps]);
  return out;
}

/** Value of series `s` at time t (step function: latest sample at or before t). */
export function at(s: [number, number][], t: number): number | undefined {
  let v: number | undefined;
  for (const [ts, p] of s) {
    if (ts > t) break;
    v = p;
  }
  return v;
}

// ----------------------------------------------------------------- parsers

export function parseCoinGecko(json: unknown, now: number): Sample[] {
  const prices = (json as { prices?: [number, number][] }).prices;
  if (!Array.isArray(prices)) throw new Error("CoinGecko: no prices (rate-limited?)");
  return prices.filter(([t]) => t <= now).map(([t, p]) => [Math.floor(t), toBps(p)]);
}

/** @deprecated GeckoTerminal is no longer the primary Minswap path; kept for test fixtures. */
export function parseGeckoTerminal(json: unknown): { unit: string; candles: [number, number][] } {
  const j = json as { data?: { attributes?: { ohlcv_list?: number[][] } }; meta?: { base?: { address?: string }; quote?: { symbol?: string } } };
  const list = j.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) throw new Error("GeckoTerminal: no ohlcv_list (rate-limited?)");
  if (j.meta?.base?.address !== USDM_UNIT) throw new Error("GeckoTerminal: series is not priced in USDM terms");
  return { unit: j.meta?.quote?.symbol ?? "?", candles: list.map((r) => [r[0], r[4]] as [number, number]) };
}

export function parseKrakenOhlc(json: unknown): [number, number][] {
  const j = json as { error?: string[]; result?: Record<string, unknown> };
  if (j.error?.length) throw new Error(`Kraken: ${j.error.join(", ")}`);
  const key = Object.keys(j.result ?? {}).find((k) => k !== "last");
  const rows = key ? (j.result![key] as (string | number)[][]) : undefined;
  if (!Array.isArray(rows)) throw new Error("Kraken: no OHLC rows");
  return rows.map((r) => [Number(r[0]), Number(r[4])]);
}

export type MinswapAsset = { policyId: string; assetName: string };
export type MinswapPoolReserves = {
  assetA: MinswapAsset;
  assetB: MinswapAsset;
  reserveA: bigint;
  reserveB: bigint;
};

const assetOf = (field: unknown): MinswapAsset => {
  const f = field as { fields?: { bytes?: string }[] };
  const policyId = f.fields?.[0]?.bytes ?? "";
  const assetName = f.fields?.[1]?.bytes ?? "";
  if (policyId === undefined || assetName === undefined) throw new Error("Minswap: bad asset in datum");
  return { policyId, assetName };
};

/** Decode Minswap V2 PoolData inline-datum JSON (Koios/Blockfrost shape). */
export function parseMinswapV2Datum(value: unknown): MinswapPoolReserves {
  const v = value as { constructor?: number; fields?: unknown[] };
  const fields = v.fields;
  if (v.constructor !== 0 || !Array.isArray(fields) || fields.length < 6) throw new Error("Minswap: unexpected pool datum");
  const reserveA = BigInt((fields[4] as { int?: number | string }).int as number | string);
  const reserveB = BigInt((fields[5] as { int?: number | string }).int as number | string);
  if (reserveA <= 0n || reserveB <= 0n) throw new Error("Minswap: empty reserves");
  return { assetA: assetOf(fields[1]), assetB: assetOf(fields[2]), reserveA, reserveB };
}

/** USDM priced in the pool's other token (ADA or USDCx), matching the old GeckoTerminal convention. */
export function usdmPriceInOther(pool: MinswapPoolReserves): { unit: string; price: number } {
  const isUsdm = (a: MinswapAsset) => a.policyId === USDM_POLICY && a.assetName === USDM_NAME;
  const isAda = (a: MinswapAsset) => a.policyId === "" && a.assetName === "";
  const isUsdcx = (a: MinswapAsset) => `${a.policyId}${a.assetName}` === USDCX_UNIT;
  let other: MinswapAsset;
  let usdmReserve: bigint;
  let otherReserve: bigint;
  if (isUsdm(pool.assetB)) {
    other = pool.assetA;
    usdmReserve = pool.reserveB;
    otherReserve = pool.reserveA;
  } else if (isUsdm(pool.assetA)) {
    other = pool.assetB;
    usdmReserve = pool.reserveA;
    otherReserve = pool.reserveB;
  } else {
    throw new Error("Minswap: pool is not a USDM pair");
  }
  const price = Number(otherReserve) / Number(usdmReserve);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Minswap: bad reserve ratio");
  if (isAda(other)) return { unit: "ADA", price };
  if (isUsdcx(other)) return { unit: "USDCx", price };
  throw new Error(`Minswap: unsupported quote ${other.policyId}${other.assetName}`);
}

// ----------------------------------------------------------------- on-chain pool fetch

type PoolUtxo = { inline_datum?: { value?: unknown }; data?: { json_value?: unknown }; amount?: { unit: string; quantity: string }[] };

function pickPoolUtxo(utxos: unknown, lpUnit: string): MinswapPoolReserves {
  if (!Array.isArray(utxos) || !utxos.length) throw new Error("Minswap: no pool UTxOs");
  const lpName = lpUnit.slice(56);
  for (const u of utxos as PoolUtxo[]) {
    // Koios extended shape
    const assets = (u as { asset_list?: { policy_id: string; asset_name: string; quantity: string }[] }).asset_list;
    const hasAuth =
      assets?.some((a) => a.policy_id === MINSWAP_V2_LP_POLICY && a.asset_name === MINSWAP_V2_POOL_AUTH) ||
      (u.amount ?? []).some((a) => a.unit === `${MINSWAP_V2_LP_POLICY}${MINSWAP_V2_POOL_AUTH}`);
    const hasLp =
      assets?.some((a) => a.policy_id === MINSWAP_V2_LP_POLICY && a.asset_name === lpName) ||
      (u.amount ?? []).some((a) => a.unit === lpUnit);
    if (!hasAuth || !hasLp) continue;
    const value = u.inline_datum?.value ?? u.data?.json_value;
    if (value) return parseMinswapV2Datum(value);
  }
  throw new Error("Minswap: pool auth UTxO with inline datum not found");
}

async function fetchPoolBlockfrost(fetchJson: FetchJson, lpUnit: string, projectId: string): Promise<MinswapPoolReserves> {
  const url =
    `https://cardano-mainnet.blockfrost.io/api/v0/addresses/${MINSWAP_V2_POOL_ADDRESS}/utxos/${lpUnit}`;
  const json = await fetchJson(url, { headers: { project_id: projectId } });
  return pickPoolUtxo(json, lpUnit);
}

async function fetchPoolKoios(fetchJson: FetchJson, lpUnit: string): Promise<MinswapPoolReserves> {
  const policy = lpUnit.slice(0, 56);
  const name = lpUnit.slice(56);
  const json = await fetchJson("https://api.koios.rest/api/v1/asset_utxos", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ _asset_list: [[policy, name]], _extended: true }),
  });
  return pickPoolUtxo(json, lpUnit);
}

/** Preferred on-chain Minswap V2 pool read: Blockfrost mainnet if keyed, else Koios. */
export async function fetchMinswapPool(fetchJson: FetchJson, lpUnit: string): Promise<MinswapPoolReserves> {
  const bf = blockfrostMainnetProjectId();
  if (bf) {
    try {
      return await fetchPoolBlockfrost(fetchJson, lpUnit, bf);
    } catch (e) {
      // Fall through to Koios so a mis-scoped token does not brick the venue.
      if (!(e instanceof Error)) throw e;
    }
  }
  return fetchPoolKoios(fetchJson, lpUnit);
}

// ----------------------------------------------------------------- adapters

export type Venue = { name: string; describe: string; fetch: (fetchJson: FetchJson, now: number) => Promise<Sample[]> };

export const VENUES: Venue[] = [
  {
    name: "coingecko",
    describe: "CoinGecko USDM/USD aggregate",
    fetch: async (f, now) =>
      parseCoinGecko(await f(`https://api.coingecko.com/api/v3/coins/${COINGECKO_ID}/market_chart?vs_currency=usd&days=2`), now),
  },
  {
    name: "minswap-ada-usdm",
    describe: "Minswap ADA/USDM on-chain x Kraken ADA/USD",
    fetch: async (f, now) => {
      const pool = usdmPriceInOther(await fetchMinswapPool(f, POOLS["minswap-ada-usdm"]));
      if (pool.unit !== "ADA") throw new Error(`expected USDM priced in ADA, got ${pool.unit}`);
      const adaUsd = candlesToSeries(parseKrakenOhlc(await f("https://api.kraken.com/0/public/OHLC?pair=ADAUSD&interval=60")), now);
      // Spot pool ratio × hourly ADA/USD; stamp at each ADA candle end so the series tracks FX moves.
      return adaUsd.flatMap(([t, usd]) => [[t, toBps(pool.price * usd)] as Sample]);
    },
  },
  {
    name: "minswap-usdcx-usdm",
    describe: "Minswap USDCx/USDM on-chain (USDM in USDCx)",
    fetch: async (f, now) => {
      const pool = usdmPriceInOther(await fetchMinswapPool(f, POOLS["minswap-usdcx-usdm"]));
      if (pool.unit !== "USDCx") throw new Error(`expected USDM priced in USDCx, got ${pool.unit}`);
      return spotToSeries(pool.price, now);
    },
  },
];

export interface LiveSnapshot {
  input: RelayInput;
  venues: { name: string; describe: string; ok: boolean; samples: number; lastBps?: number; error?: string }[];
}

/**
 * Pull every venue and build a relay input whose `now` is the wall clock.
 * The search period for a depeg is the last `lookbackMs` (default 48h), so the
 * same run also reports whether a 24h trigger window just completed.
 */
export async function liveInput(
  opts: { now?: number; fetchJson?: FetchJson; lookbackMs?: number; maxGapMs?: number; maxPriceAgeMs?: number } = {},
): Promise<LiveSnapshot> {
  const now = opts.now ?? Date.now();
  const f = opts.fetchJson ?? defaultFetchJson;
  const sources: RelayInput["sources"] = {};
  const venues: LiveSnapshot["venues"] = [];
  for (const v of VENUES) {
    try {
      const s = await v.fetch(f, now);
      if (!s.length) throw new Error("no samples");
      sources[v.name] = s;
      venues.push({ name: v.name, describe: v.describe, ok: true, samples: s.length, lastBps: s.at(-1)![1] });
    } catch (e) {
      venues.push({ name: v.name, describe: v.describe, ok: false, samples: 0, error: (e as Error).message });
    }
  }
  return {
    venues,
    input: {
      coveredAsset: "USDM",
      thresholdBps: 9500,
      windowMs: 24 * HOUR,
      start: now - (opts.lookbackMs ?? 48 * HOUR),
      expiry: now,
      now,
      // Venues sample hourly, so a 2h tolerance absorbs one late candle without accepting stale data.
      maxGapMs: opts.maxGapMs ?? 2 * HOUR,
      maxPriceAgeMs: opts.maxPriceAgeMs ?? 2 * HOUR,
      sources,
    },
  };
}
