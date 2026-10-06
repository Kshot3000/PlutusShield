import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../src/relay.ts";
import { HOUR, USDM_UNIT, candlesToSeries, liveInput, parseCoinGecko, parseGeckoTerminal, parseKrakenOhlc, type FetchJson } from "../src/venues.ts";

// EXAMPLE DATA ONLY: synthetic API payloads shaped like the real responses.
const NOW = 1_790_000_000_000 - (1_790_000_000_000 % HOUR) + 10 * 60_000; // 10 min past an hour
const hours = (n: number) => Array.from({ length: n }, (_, i) => NOW - (n - i) * HOUR);

const coingecko = (price: (t: number) => number) => ({ prices: hours(49).map((t) => [t, price(t)]) });
const gecko = (base: string, quote: string, closes: (t: number) => number | undefined) => ({
  meta: { base: { address: base }, quote: { symbol: quote } },
  data: { attributes: { ohlcv_list: hours(50).reverse().flatMap((t) => { const c = closes(t); return c === undefined ? [] : [[t / 1000, c, c, c, c, 100]]; }) } },
});
const kraken = { error: [], result: { ADAUSD: hours(60).map((t) => [t / 1000, "0.27", "0.27", "0.27", "0.25", "0.27", "1", 1]), last: 0 } };

function fakeFetch(opts: { cg?: number; adaPerUsdm?: number; usdcx?: number; skipHours?: boolean } = {}): FetchJson {
  return async (url) => {
    if (url.includes("coingecko")) return coingecko(() => opts.cg ?? 1.0);
    if (url.includes("kraken")) return kraken;
    const side = new URL(url).searchParams.get("token");
    if (url.includes("7dd6988c")) // ADA/USDM: USDM is the priced side only when token=quote
      return side === "quote" ? gecko(USDM_UNIT, "ADA", (t) => (opts.skipHours && (t / HOUR) % 3 !== 0 ? undefined : opts.adaPerUsdm ?? 4.0)) : gecko("other", "USDM", () => 0.25);
    return side === "base" ? gecko(USDM_UNIT, "USDCx", () => opts.usdcx ?? 0.999) : gecko("x", "y", () => 1);
  };
}

test("candles are end-stamped and forward-filled through no-trade hours", () => {
  const open = (NOW - 5 * HOUR) / 1000;
  const s = candlesToSeries([[open, 1.0], [open + 3 * 3600, 0.98]], NOW);
  assert.deepEqual(s.map(([t]) => (t - NOW) / HOUR), [-4, -3, -2, -1, 0]);
  assert.deepEqual(s.map(([, p]) => p), [1.0, 1.0, 1.0, 0.98, 0.98]);
});

test("parsers reject rate-limit and wrong-side payloads", () => {
  assert.throws(() => parseCoinGecko({ status: { error_code: 429 } }, NOW), /rate-limited/);
  assert.throws(() => parseGeckoTerminal(gecko("nope", "ADA", () => 1)), /not priced in USDM/);
  assert.throws(() => parseKrakenOhlc({ error: ["EGeneral:Too many requests"] }), /Too many/);
  assert.equal(parseCoinGecko(coingecko(() => 1.0123), NOW).at(-1)![1], 10123);
});

test("live input: three healthy venues give a healthy 24h reading", async () => {
  const snap = await liveInput({ now: NOW, fetchJson: fakeFetch() });
  assert.deepEqual(snap.venues.map((v) => v.ok), [true, true, true]);
  assert.equal(snap.venues[1].lastBps, 10_000, "4 ADA x $0.25 = $1.00");
  assert.equal(snap.venues[2].lastBps, 9_990);
  const r = evaluate(snap.input);
  assert.ok(r.peg?.healthy);
  assert.equal(r.depeg, null);
  assert.equal(BigInt(r.peg!.datum.windowEnd), BigInt(NOW));
});

test("live input: sparse DEX trades still give a reading, a real depeg trips the breaker", async () => {
  const sparse = evaluate((await liveInput({ now: NOW, fetchJson: fakeFetch({ skipHours: true }) })).input);
  assert.ok(sparse.peg?.healthy, "forward-filled AMM price");
  const dip = evaluate((await liveInput({ now: NOW, fetchJson: fakeFetch({ cg: 0.9, adaPerUsdm: 3.6, usdcx: 0.91 }) })).input);
  assert.equal(dip.peg?.healthy, false);
  assert.ok(dip.depeg, "a full 24h window below 95% is attestable");
});

test("live input: one venue down is reported, not fatal", async () => {
  const f = fakeFetch();
  const snap = await liveInput({ now: NOW, fetchJson: async (u) => (u.includes("coingecko") ? { status: { error_code: 429 } } : f(u)) });
  assert.deepEqual(snap.venues.map((v) => v.ok), [false, true, true]);
  assert.ok(evaluate(snap.input).peg?.healthy);
});
