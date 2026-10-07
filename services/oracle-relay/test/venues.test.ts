import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../src/relay.ts";
import {
  HOUR,
  MINSWAP_V2_LP_POLICY,
  MINSWAP_V2_POOL_AUTH,
  POOLS,
  USDM_NAME,
  USDM_POLICY,
  USDCX_UNIT,
  candlesToSeries,
  liveInput,
  parseCoinGecko,
  parseGeckoTerminal,
  parseKrakenOhlc,
  parseMinswapV2Datum,
  spotToSeries,
  usdmPriceInOther,
  type FetchJson,
} from "../src/venues.ts";

// EXAMPLE DATA ONLY: synthetic API payloads shaped like the real responses.
const NOW = 1_790_000_000_000 - (1_790_000_000_000 % HOUR) + 10 * 60_000; // 10 min past an hour
const hours = (n: number) => Array.from({ length: n }, (_, i) => NOW - (n - i) * HOUR);

const coingecko = (price: (t: number) => number) => ({ prices: hours(49).map((t) => [t, price(t)]) });
const gecko = (base: string, quote: string, closes: (t: number) => number | undefined) => ({
  meta: { base: { address: base }, quote: { symbol: quote } },
  data: { attributes: { ohlcv_list: hours(50).reverse().flatMap((t) => { const c = closes(t); return c === undefined ? [] : [[t / 1000, c, c, c, c, 100]]; }) } },
});
const kraken = { error: [], result: { ADAUSD: hours(60).map((t) => [t / 1000, "0.27", "0.27", "0.27", "0.25", "0.27", "1", 1]), last: 0 } };

const asset = (policyId: string, assetName: string) => ({
  fields: [{ bytes: policyId }, { bytes: assetName }],
  constructor: 0,
});

function poolDatum(opts: { adaPerUsdm?: number; usdcxPerUsdm?: number; pair: "ada" | "usdcx" }) {
  const usdmReserve = 1_000_000_000n; // 1000 USDM (6 decimals)
  if (opts.pair === "ada") {
    const ada = BigInt(Math.round((opts.adaPerUsdm ?? 4) * Number(usdmReserve)));
    return {
      constructor: 0,
      fields: [
        { constructor: 0, fields: [] },
        asset("", ""),
        asset(USDM_POLICY, USDM_NAME),
        { int: 1 },
        { int: Number(ada) },
        { int: Number(usdmReserve) },
      ],
    };
  }
  const usdcx = BigInt(Math.round((opts.usdcxPerUsdm ?? 0.999) * Number(usdmReserve)));
  return {
    constructor: 0,
    fields: [
      { constructor: 0, fields: [] },
      asset(USDCX_UNIT.slice(0, 56), USDCX_UNIT.slice(56)),
      asset(USDM_POLICY, USDM_NAME),
      { int: 1 },
      { int: Number(usdcx) },
      { int: Number(usdmReserve) },
    ],
  };
}

function koiosPoolUtxo(lpUnit: string, datum: unknown) {
  const lpName = lpUnit.slice(56);
  return [
    {
      asset_list: [
        { policy_id: MINSWAP_V2_LP_POLICY, asset_name: MINSWAP_V2_POOL_AUTH, quantity: "1" },
        { policy_id: MINSWAP_V2_LP_POLICY, asset_name: lpName, quantity: "1" },
      ],
      inline_datum: { value: datum },
    },
  ];
}

function fakeFetch(opts: { cg?: number; adaPerUsdm?: number; usdcx?: number; skipHours?: boolean; cgHeader?: string[] } = {}): FetchJson {
  return async (url, init) => {
    if (url.includes("coingecko")) {
      if (opts.cgHeader) opts.cgHeader.push(init?.headers?.["x-cg-demo-api-key"] ?? init?.headers?.["X-Cg-Demo-Api-Key"] ?? "");
      // defaultFetchJson merges headers before calling; injected fakes see what venues pass.
      return coingecko(() => opts.cg ?? 1.0);
    }
    if (url.includes("kraken")) return kraken;
    if (url.includes("asset_utxos") || url.includes("blockfrost.io")) {
      const body = init?.body ?? "";
      const adaLp = POOLS["minswap-ada-usdm"];
      const usdcxLp = POOLS["minswap-usdcx-usdm"];
      if (url.includes(adaLp) || body.includes(adaLp.slice(56)))
        return koiosPoolUtxo(adaLp, poolDatum({ pair: "ada", adaPerUsdm: opts.adaPerUsdm ?? 4.0 }));
      if (url.includes(usdcxLp) || body.includes(usdcxLp.slice(56)))
        return koiosPoolUtxo(usdcxLp, poolDatum({ pair: "usdcx", usdcxPerUsdm: opts.usdcx ?? 0.999 }));
      throw new Error("unexpected pool");
    }
    // Legacy GeckoTerminal paths should not be hit by live venues anymore.
    if (url.includes("geckoterminal")) throw new Error("GeckoTerminal should not be used");
    throw new Error(`unexpected url ${url}`);
  };
}

test("candles are end-stamped and forward-filled through no-trade hours", () => {
  const open = (NOW - 5 * HOUR) / 1000;
  const s = candlesToSeries([[open, 1.0], [open + 3 * 3600, 0.98]], NOW);
  assert.deepEqual(s.map(([t]) => (t - NOW) / HOUR), [-4, -3, -2, -1, 0]);
  assert.deepEqual(s.map(([, p]) => p), [1.0, 1.0, 1.0, 0.98, 0.98]);
});

test("spotToSeries holds a constant bps across the lookback", () => {
  const s = spotToSeries(0.999, NOW, 5 * HOUR);
  assert.equal(s.length, 5);
  assert.ok(s.every(([, p]) => p === 9990));
  assert.equal(s.at(-1)![0], NOW - (NOW % HOUR));
});

test("parsers reject rate-limit and wrong-side payloads", () => {
  assert.throws(() => parseCoinGecko({ status: { error_code: 429 } }, NOW), /rate-limited/);
  assert.throws(() => parseGeckoTerminal(gecko("nope", "ADA", () => 1)), /not priced in USDM/);
  assert.throws(() => parseKrakenOhlc({ error: ["EGeneral:Too many requests"] }), /Too many/);
  assert.equal(parseCoinGecko(coingecko(() => 1.0123), NOW).at(-1)![1], 10123);
});

test("Minswap V2 datum decodes ADA/USDM and USDCx/USDM ratios", () => {
  const ada = usdmPriceInOther(parseMinswapV2Datum(poolDatum({ pair: "ada", adaPerUsdm: 4 })));
  assert.equal(ada.unit, "ADA");
  assert.equal(ada.price, 4);
  const usdcx = usdmPriceInOther(parseMinswapV2Datum(poolDatum({ pair: "usdcx", usdcxPerUsdm: 0.999 })));
  assert.equal(usdcx.unit, "USDCx");
  assert.equal(usdcx.price, 0.999);
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

test("live input: on-chain spot still gives a reading, a real depeg trips the breaker", async () => {
  const ok = evaluate((await liveInput({ now: NOW, fetchJson: fakeFetch() })).input);
  assert.ok(ok.peg?.healthy, "on-chain spot × Kraken");
  const dip = evaluate((await liveInput({ now: NOW, fetchJson: fakeFetch({ cg: 0.9, adaPerUsdm: 3.6, usdcx: 0.91 }) })).input);
  assert.equal(dip.peg?.healthy, false);
  assert.ok(dip.depeg, "a full 24h window below 95% is attestable");
});

test("live input: one venue down is reported, not fatal", async () => {
  const f = fakeFetch();
  const snap = await liveInput({
    now: NOW,
    fetchJson: async (u, init) => (u.includes("coingecko") ? { status: { error_code: 429 } } : f(u, init)),
  });
  assert.deepEqual(snap.venues.map((v) => v.ok), [false, true, true]);
  assert.ok(evaluate(snap.input).peg?.healthy);
});

test("live input: Minswap fails closed when pool UTxO is missing", async () => {
  const f = fakeFetch();
  const snap = await liveInput({
    now: NOW,
    fetchJson: async (u, init) => {
      if (u.includes("asset_utxos") || u.includes("blockfrost")) return [];
      return f(u, init);
    },
  });
  assert.deepEqual(snap.venues.map((v) => v.ok), [true, false, false]);
  assert.match(snap.venues[1].error!, /no pool UTxOs|not found/);
});
