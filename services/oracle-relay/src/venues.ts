/**
 * Live venue adapters for the USDM peg feed.
 *
 * Each adapter returns a price series in bps of the USD peg, as the relay's
 * `RelayInput.sources` expects. They use only public, keyless HTTP APIs so any
 * relay operator can reproduce a reading:
 *
 *   coingecko          CoinGecko USDM (id `usdm-2`) USD market chart: a cross-venue aggregate.
 *   minswap-ada-usdm   Minswap ADA/USDM pool (via GeckoTerminal OHLCV, priced in ADA)
 *                      converted to USD with Kraken's ADA/USD hourly candles, so the
 *                      ADA leg comes from a different provider than the pool leg.
 *   minswap-usdcx-usdm Minswap USDCx/USDM pool (via GeckoTerminal OHLCV): USDM priced
 *                      against Circle's USDCx, a stable-vs-stable cross.
 *
 * AMM prices only move when someone trades, so hourly candles with no trades
 * are forward-filled from the previous close. Samples are stamped at the END
 * of their candle (the close is only known then), never at its open, so a
 * reading can't look ahead.
 *
 * The parsing is pure and unit-tested; `fetchJson` is injectable for tests.
 */
import type { RelayInput } from "./relay.ts";

/** Cardano USDM (Moneta): policy id + asset name "USDM". */
export const USDM_UNIT = "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad0014df105553444d";
export const COINGECKO_ID = "usdm-2";
export const POOLS = {
  "minswap-ada-usdm": "f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c7dd6988c5a86693c76aeec1ea94afa41770be0de21a775ca7a2a1eabdb6a0171",
  "minswap-usdcx-usdm": "f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c1448500d5be7904281807b569bf2c7bb2204514a3d6a62441d1a5fc4f94f8d52",
} as const;

export const HOUR = 3_600_000;
export type Sample = [number, number]; // [POSIX ms, bps of peg]
export type FetchJson = (url: string) => Promise<unknown>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Public free tiers rate-limit hard (HTTP 429), so back off and retry a few times. */
export const defaultFetchJson: FetchJson = async (url) => {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "plutusshield-oracle-relay/0.1" } });
    if (res.ok) return res.json();
    if (res.status !== 429 || attempt >= 2) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
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

/** GeckoTerminal OHLCV -> [openSec, close] where close is the price of USDM in the pool's other token. */
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

// ----------------------------------------------------------------- adapters

const gt = (pool: string, token: "base" | "quote") =>
  `https://api.geckoterminal.com/api/v2/networks/cardano/pools/${pool}/ohlcv/hour?aggregate=1&limit=72&currency=token&token=${token}`;

/** GeckoTerminal labels the priced side by `token`; ask for whichever side is USDM. */
async function usdmCandles(fetchJson: FetchJson, pool: string) {
  let lastErr: unknown;
  for (const side of ["base", "quote"] as const) {
    try {
      return parseGeckoTerminal(await fetchJson(gt(pool, side)));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export type Venue = { name: string; describe: string; fetch: (fetchJson: FetchJson, now: number) => Promise<Sample[]> };

export const VENUES: Venue[] = [
  {
    name: "coingecko",
    describe: "CoinGecko USDM/USD aggregate",
    fetch: async (f, now) => parseCoinGecko(await f(`https://api.coingecko.com/api/v3/coins/${COINGECKO_ID}/market_chart?vs_currency=usd&days=2`), now),
  },
  {
    name: "minswap-ada-usdm",
    describe: "Minswap ADA/USDM pool x Kraken ADA/USD",
    fetch: async (f, now) => {
      const pool = await usdmCandles(f, POOLS["minswap-ada-usdm"]);
      if (pool.unit !== "ADA") throw new Error(`expected USDM priced in ADA, got ${pool.unit}`);
      const usdmAda = candlesToSeries(pool.candles, now);
      const adaUsd = candlesToSeries(parseKrakenOhlc(await f("https://api.kraken.com/0/public/OHLC?pair=ADAUSD&interval=60")), now);
      return usdmAda.flatMap(([t, ada]) => {
        const usd = at(adaUsd, t);
        return usd === undefined ? [] : [[t, toBps(ada * usd)] as Sample];
      });
    },
  },
  {
    name: "minswap-usdcx-usdm",
    describe: "Minswap USDCx/USDM pool (USDM in USDCx)",
    fetch: async (f, now) => {
      const pool = await usdmCandles(f, POOLS["minswap-usdcx-usdm"]);
      return candlesToSeries(pool.candles, now).map(([t, p]) => [t, toBps(p)] as Sample);
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
