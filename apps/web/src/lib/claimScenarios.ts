/**
 * Claim-checker scenarios for the /claim preview.
 *
 * EXAMPLE DATA ONLY. Prices are synthetic and generated here; nothing below is
 * real market data. What IS real is the evaluation: every verdict comes from
 * the SDK's exact mirrors of the Cardano validator (`settlementCheck`,
 * `healthy`) and the relay's window search (`findDepegWindow`), the same code
 * `services/oracle-relay` runs before it signs anything.
 */
import { DAY_MS, oracleDatumData, textHex, toCborHex, type OracleConfig, type OracleDatum, type Trigger } from "@plutusshield/sdk/cardano";
import {
  HOUR_MS,
  findDepegWindow,
  healthy,
  medianSeries,
  pegReading,
  settlementCheck,
  type FeedUtxo,
  type PriceSample,
  type SettlementBlocker,
} from "@plutusshield/sdk/oracle";

export type ScenarioId = "sharp" | "wick" | "late" | "calm";
export type VenueHealth = "honest" | "one-frozen" | "two-frozen";
export type FeedName = "feed-a" | "feed-b" | "feed-c";

export interface Scenario {
  id: ScenarioId;
  label: string;
  hint: string;
  /** Price in bps of peg at hour `h` of the timeline, before venue noise. */
  price: (h: number) => number;
}

/** Timeline: 240 hourly samples. Cover runs from hour 24 to hour 144 (5 days). */
export const TIMELINE_HOURS = 240;
export const COVER_START_H = 24;
export const COVER_END_H = 144;
/** Matches contracts/cardano/deploy/preview.config.json (claimGraceDays: 3). */
export const CLAIM_GRACE_H = 72;
/** Matches preview.config.json saleGuard.maxPriceAgeMinutes (120). */
export const MAX_PRICE_AGE_H = 2;

/** A fixed, hour-aligned epoch so the page renders identically on server and client. */
export const T0 = 1_790_000_000_000n - (1_790_000_000_000n % HOUR_MS);
export const atHour = (h: number) => T0 + BigInt(h) * HOUR_MS;
export const hourOf = (t: bigint) => Number((t - T0) / HOUR_MS);

const ramp = (h: number, a: number, b: number, from: number, to: number) =>
  h <= a ? from : h >= b ? to : Math.round(from + ((to - from) * (h - a)) / (b - a));

export const SCENARIOS: Scenario[] = [
  {
    id: "sharp",
    label: "Sharp depeg",
    hint: "Falls to 0.908 for 36 hours mid-cover",
    price: (h) => (h < 60 ? 9_995 : h < 64 ? ramp(h, 60, 64, 9_995, 9_080) : h < 96 ? 9_080 : ramp(h, 96, 104, 9_080, 9_990)),
  },
  {
    id: "wick",
    label: "Short wick",
    hint: "Dips to 0.93 for 10 hours, then recovers",
    price: (h) => (h >= 70 && h < 80 ? 9_300 : 9_995),
  },
  {
    id: "late",
    label: "Depeg after expiry",
    hint: "Breaks peg on day 6, after cover ends",
    price: (h) => (h < 150 ? 9_995 : h < 200 ? 9_050 : 9_990),
  },
  {
    id: "calm",
    label: "Holds the peg",
    hint: "Never leaves 0.99–1.00",
    price: () => 9_995,
  },
];

/** Deterministic ±4 bps jitter so venues look like real, slightly different books. */
function jitter(h: number, venue: number) {
  const x = Math.sin(h * 12.9898 + venue * 78.233) * 43_758.5453;
  return Math.round((x - Math.floor(x)) * 8 - 4);
}

export const VENUES = ["DEX pool A", "DEX pool B", "CEX ticker C"] as const;

/** Per-venue hourly samples. A frozen venue keeps quoting 1.0000 no matter what. */
export function venueSamples(s: Scenario, health: VenueHealth): PriceSample[][] {
  const frozen = health === "honest" ? 0 : health === "one-frozen" ? 1 : 2;
  return VENUES.map((_, v) => {
    const isFrozen = v >= VENUES.length - frozen;
    return Array.from({ length: TIMELINE_HOURS + 1 }, (_, h) => ({
      t: atHour(h),
      priceBps: BigInt(isFrozen ? 10_000 : Math.min(10_000, s.price(h) + jitter(h, v))),
    }));
  });
}

export const ORACLE_CONFIG = (feeds: FeedName[] = ["feed-a", "feed-b", "feed-c"]): OracleConfig => ({
  // Preview test-oracle policy from contracts/cardano/deploy/deployments/preview.json.
  policyId: "d8365e107288ee8c1e313505cf2c754386eef7c95b2cd75b1fa1dd93",
  feeds: feeds.map((f) => textHex(f)),
  quorum: 2n,
});

export const TRIGGER: Trigger = { coveredAsset: textHex("USDM"), thresholdBps: 9_500n, windowMs: DAY_MS };

export interface ClaimEvaluation {
  series: PriceSample[];
  /** The window the relay would attest, using only data published by `now`. */
  depeg?: OracleDatum;
  depegCbor?: string;
  settle: { ok: boolean; feeds: string[]; blockers: SettlementBlocker[]; deadline: bigint };
  /** Sale circuit-breaker at `now`: would a new Buy be allowed? */
  sale: { ok: boolean; missing: string[]; reading?: OracleDatum };
  coverStarted: boolean;
}

const feedUtxo = (name: FeedName, datum: OracleDatum): FeedUtxo => ({
  policyId: ORACLE_CONFIG().policyId,
  tokens: [{ name: textHex(name), quantity: 1n }],
  datum,
});

/**
 * Evaluate a claim at hour `nowH` with the given feeds online. Each online
 * feed runs the relay over the same venue median (in production every feed
 * operator runs it independently over its own sources).
 */
export function evaluateClaim(s: Scenario, health: VenueHealth, online: FeedName[], nowH: number): ClaimEvaluation {
  const series = medianSeries(venueSamples(s, health));
  const now = atHour(nowH);
  const start = atHour(COVER_START_H);
  const expiry = atHour(COVER_END_H);
  const published = series.filter((p) => p.t <= now);
  const searchEnd = now < expiry ? now : expiry;
  const depeg = searchEnd > start ? findDepegWindow(published, TRIGGER, start, searchEnd) : undefined;

  const config = ORACLE_CONFIG();
  const grace = BigInt(CLAIM_GRACE_H) * HOUR_MS;
  const check = settlementCheck(
    { trigger: TRIGGER, start, expiry },
    depeg ? online.map((f) => feedUtxo(f, depeg)) : [],
    config,
    grace,
    now,
  );

  const reading = nowH >= 24 ? pegReading(published, TRIGGER.coveredAsset, now, DAY_MS) : undefined;
  const fresh = now - BigInt(MAX_PRICE_AGE_H) * HOUR_MS;
  const sale = healthy(reading ? online.map((f) => feedUtxo(f, reading)) : [], config, TRIGGER, fresh);

  return {
    series,
    depeg,
    depegCbor: depeg ? toCborHex(oracleDatumData(depeg)) : undefined,
    settle: { ok: check.ok, feeds: check.feeds, blockers: check.blockers, deadline: expiry + grace },
    sale: { ok: sale.ok, missing: sale.missing, reading },
    coverStarted: nowH >= COVER_START_H,
  };
}

/** "Day 3 · 14:00" relative to the start of the timeline. */
export function dayLabel(h: number) {
  const d = Math.floor(h / 24);
  return `Day ${d} · ${String(h % 24).padStart(2, "0")}:00`;
}

/** Hex token name back to the feed's text name, e.g. 666565642d61 -> feed-a. */
export function feedLabel(hex: string) {
  const bytes = hex.match(/../g) ?? [];
  return bytes.map((b) => String.fromCharCode(parseInt(b, 16))).join("");
}
