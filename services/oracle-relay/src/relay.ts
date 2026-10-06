/**
 * Oracle relay core: one pure function from a price observation file to the
 * feed datums a relay would publish on Cardano.
 *
 * A relay operator runs this once per feed name it controls. Publishing (the
 * feed-token mint and the UTxO carrying the datum) is done by the deploy
 * tooling in contracts/cardano/deploy; this module decides *what* to publish
 * and proves it is what the validator will accept before anything is signed.
 */
import {
  DAY_MS,
  oracleDatumData,
  textHex,
  toCborHex,
  type OracleDatum,
  type Trigger,
} from "../../../packages/sdk/src/cardano.ts";
import {
  HOUR_MS,
  attests,
  attestsPeg,
  findDepegWindow,
  medianSeries,
  pegReading,
  type PriceSample,
} from "../../../packages/sdk/src/oracle.ts";

/** Input file shape. Numbers may be JSON numbers or decimal strings. */
export interface RelayInput {
  /** UTF-8 ticker as it appears in policy triggers, e.g. "USDM". */
  coveredAsset: string;
  /** Trigger threshold in bps of peg. Default 9500 (0.95). */
  thresholdBps?: number | string;
  /** Trigger window in ms. Default 24h. */
  windowMs?: number | string;
  /** Cover period to search for a depeg: [start, expiry] in POSIX ms. */
  start: number | string;
  expiry: number | string;
  /** "Now" for the sale circuit-breaker reading. Default: the latest sample. */
  now?: number | string;
  /** Freshness the pool requires of peg readings (SaleGuard.max_price_age_ms). Default 2h. */
  maxPriceAgeMs?: number | string;
  /** Largest tolerated gap between samples. Default 1h. */
  maxGapMs?: number | string;
  /** Venue name -> [[POSIX ms, price in bps of peg], ...]. */
  sources: Record<string, [number | string, number | string][]>;
}

export interface PublishedDatum {
  datum: { coveredAsset: string; priceBps: string; windowStart: string; windowEnd: string };
  /** Inline datum CBOR, ready for the feed UTxO. */
  cborHex: string;
}

export interface RelayReport {
  coveredAsset: string;
  coveredAssetHex: string;
  trigger: { thresholdBps: string; windowMs: string };
  venues: { name: string; samples: number; first?: string; last?: string }[];
  /** Earliest 24h-style window inside the cover period that proves the trigger. */
  depeg: PublishedDatum | null;
  /** Reading over the window ending at `now`; healthy means a Buy may proceed. */
  peg: (PublishedDatum & { healthy: boolean; freshUntil: string }) | null;
  /** Plain-language one-liners for operators and the app's status page. */
  notes: string[];
}

const big = (v: number | string | undefined, fallback: bigint, what: string): bigint => {
  if (v === undefined) return fallback;
  const s = String(v).trim();
  if (!/^-?\d+$/.test(s)) throw new Error(`${what} must be an integer, got ${JSON.stringify(v)}`);
  return BigInt(s);
};

const publish = (d: OracleDatum): PublishedDatum => ({
  datum: {
    coveredAsset: d.coveredAsset,
    priceBps: d.priceBps.toString(),
    windowStart: d.windowStart.toString(),
    windowEnd: d.windowEnd.toString(),
  },
  cborHex: toCborHex(oracleDatumData(d)),
});

const pct = (bps: bigint) => `${(Number(bps) / 100).toFixed(2)}%`;
const iso = (ms: bigint) => new Date(Number(ms)).toISOString();

export function evaluate(input: RelayInput): RelayReport {
  if (!input.coveredAsset) throw new Error("coveredAsset is required");
  const coveredAssetHex = textHex(input.coveredAsset);
  const trigger: Trigger = {
    coveredAsset: coveredAssetHex,
    thresholdBps: big(input.thresholdBps, 9_500n, "thresholdBps"),
    windowMs: big(input.windowMs, DAY_MS, "windowMs"),
  };
  if (trigger.thresholdBps <= 0n || trigger.thresholdBps > 10_000n) throw new Error("thresholdBps must be in 1..=10000");
  if (trigger.windowMs <= 0n) throw new Error("windowMs must be positive");
  const start = big(input.start, 0n, "start");
  const expiry = big(input.expiry, 0n, "expiry");
  if (expiry <= start) throw new Error("expiry must be after start");
  const maxGapMs = big(input.maxGapMs, HOUR_MS, "maxGapMs");
  const maxPriceAgeMs = big(input.maxPriceAgeMs, 2n * HOUR_MS, "maxPriceAgeMs");

  const names = Object.keys(input.sources ?? {});
  if (names.length === 0) throw new Error("at least one price source is required");
  const sources: PriceSample[][] = names.map((n) =>
    input.sources[n].map(([t, p], i) => ({ t: big(t, 0n, `${n}[${i}].t`), priceBps: big(p, 0n, `${n}[${i}].price`) })),
  );
  const venues = names.map((name, i) => {
    const ts = sources[i].map((s) => s.t).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return { name, samples: ts.length, first: ts[0]?.toString(), last: ts.at(-1)?.toString() };
  });
  const series = medianSeries(sources);
  const notes: string[] = [];
  if (names.length < 3) notes.push(`Only ${names.length} venue(s): a median needs 3+ to outvote one bad source.`);

  const depeg = findDepegWindow(series, trigger, start, expiry, { maxGapMs });
  if (depeg) {
    if (!attests(depeg, trigger, start, expiry)) throw new Error("internal: depeg datum would be rejected on chain");
    notes.push(
      `Trigger met: ${input.coveredAsset} averaged ${pct(depeg.priceBps)} of peg from ${iso(depeg.windowStart)} to ${iso(depeg.windowEnd)} (threshold ${pct(trigger.thresholdBps)}).`,
    );
  } else {
    notes.push(`No ${Number(trigger.windowMs) / 3_600_000}h window inside the cover period averages below ${pct(trigger.thresholdBps)} with complete data.`);
  }

  const now = input.now !== undefined ? big(input.now, 0n, "now") : series.at(-1)!.t;
  const reading = pegReading(series, coveredAssetHex, now, trigger.windowMs, { maxGapMs });
  let peg: RelayReport["peg"] = null;
  if (reading) {
    const ok = attestsPeg(reading, trigger, now - maxPriceAgeMs);
    peg = { ...publish(reading), healthy: ok, freshUntil: (reading.windowEnd + maxPriceAgeMs).toString() };
    notes.push(
      ok
        ? `Peg healthy at ${pct(reading.priceBps)}: cover sales stay open until ${iso(reading.windowEnd + maxPriceAgeMs)} unless refreshed.`
        : `Peg reading ${pct(reading.priceBps)} is below threshold: the pool's circuit-breaker blocks new cover.`,
    );
  } else {
    notes.push("Not enough recent data for a peg reading: the pool will refuse new cover until feeds are fresh.");
  }

  return {
    coveredAsset: input.coveredAsset,
    coveredAssetHex,
    trigger: { thresholdBps: trigger.thresholdBps.toString(), windowMs: trigger.windowMs.toString() },
    venues,
    depeg: depeg ? publish(depeg) : null,
    peg,
    notes,
  };
}
