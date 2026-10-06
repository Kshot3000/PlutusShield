/**
 * Oracle side of PlutusShield parametric cover.
 *
 * Two halves:
 *
 * 1. Relay math. Raw price observations (from DEX pools, CEX tickers, or any
 *    other source) are combined per timestamp by median, turned into a step
 *    function, and averaged over time (TWAP). `findDepegWindow` searches for
 *    the earliest window that proves a trigger; `pegReading` produces the
 *    fresh healthy-peg reading the sale circuit-breaker needs. Both emit an
 *    `OracleDatum` ready to be published in a feed UTxO.
 *
 * 2. Exact mirrors of `contracts/cardano/lib/plutusshield/oracle.ak`
 *    (`attests`, `attests_peg`, the distinct-feed quorum) plus
 *    `settlementCheck`, which explains in plain terms whether a Settle
 *    transaction would pass the validator's oracle and claim-window rules.
 *
 * Integers only: prices are basis points of peg (10_000 = 1.00), times are
 * POSIX milliseconds, TWAPs round down exactly like integer division on chain.
 */
import type { OracleConfig, OracleDatum, PolicyDatum, Trigger } from "./cardano.ts";

/** One observation: the covered asset traded at `priceBps` of peg at time `t`. */
export interface PriceSample { t: bigint; priceBps: bigint }

export interface SeriesOptions {
  /**
   * Largest tolerated gap between consecutive samples inside a window. A
   * window that spans a longer gap is refused rather than averaged over
   * stale data. Default: 1 hour.
   */
  maxGapMs?: bigint;
}

export const HOUR_MS = 3_600_000n;
const DEFAULT_MAX_GAP = HOUR_MS;

const sorted = (s: PriceSample[]) => [...s].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

function check(samples: PriceSample[]) {
  for (const s of samples) {
    if (s.priceBps < 0n) throw new Error(`negative price at t=${s.t}`);
  }
}

/**
 * Combine several sources into one series: at every timestamp any source
 * reported, take the median of each source's latest price at or before that
 * time (sources that have not reported yet are skipped). The median of an
 * even count is the lower middle, so one manipulated source can never pull
 * the result toward itself past an honest one.
 */
export function medianSeries(sources: PriceSample[][]): PriceSample[] {
  const ss = sources.map(sorted);
  ss.forEach(check);
  const times = [...new Set(ss.flat().map((s) => s.t))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const idx = ss.map(() => -1);
  const out: PriceSample[] = [];
  for (const t of times) {
    const prices: bigint[] = [];
    ss.forEach((src, i) => {
      while (idx[i] + 1 < src.length && src[idx[i] + 1].t <= t) idx[i]++;
      if (idx[i] >= 0) prices.push(src[idx[i]].priceBps);
    });
    prices.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    out.push({ t, priceBps: prices[Math.floor((prices.length - 1) / 2)] });
  }
  return out;
}

/**
 * Time-weighted average price over [from, to]. Each sample's price holds until
 * the next sample. Returns undefined when the series does not cover the whole
 * window (no sample at or before `from`) or a gap inside it exceeds `maxGapMs`
 * (including the stretch from the last sample to `to`).
 */
export function twap(samples: PriceSample[], from: bigint, to: bigint, opts: SeriesOptions = {}): bigint | undefined {
  if (to <= from) throw new Error("window must have positive length");
  const s = sorted(samples);
  check(s);
  return twapSorted(s, from, to, opts.maxGapMs ?? DEFAULT_MAX_GAP);
}

function twapSorted(s: PriceSample[], from: bigint, to: bigint, maxGap: bigint): bigint | undefined {
  // i = last sample at or before `from` (binary search; s is sorted by t).
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid].t <= from) lo = mid + 1;
    else hi = mid;
  }
  const i = lo - 1;
  if (i < 0) return undefined;
  let weighted = 0n;
  for (let j = i; j < s.length && s[j].t < to; j++) {
    const segStart = j === i ? from : s[j].t;
    const segEnd = j + 1 < s.length && s[j + 1].t < to ? s[j + 1].t : to;
    // The price is stale once it is older than maxGap anywhere in the window.
    if (segEnd - s[j].t > maxGap) return undefined;
    weighted += s[j].priceBps * (segEnd - segStart);
  }
  return weighted / (to - from);
}

/**
 * The earliest window of exactly `trigger.windowMs` that lies inside
 * [start, expiry] and whose TWAP is below the trigger threshold, as the
 * `OracleDatum` a feed would publish to attest it.
 *
 * The window TWAP is piecewise linear in its start time, with breakpoints
 * where either edge crosses a sample. Checking every breakpoint (plus the
 * first and last allowed starts) therefore never misses a qualifying window:
 * if any window inside [start, expiry] proves the trigger, one of these does.
 */
export function findDepegWindow(
  samples: PriceSample[],
  trigger: Trigger,
  start: bigint,
  expiry: bigint,
  opts: SeriesOptions = {},
): OracleDatum | undefined {
  const s = sorted(samples);
  check(s);
  const maxGap = opts.maxGapMs ?? DEFAULT_MAX_GAP;
  const last = expiry - trigger.windowMs;
  if (last < start) return undefined;
  const starts = [...new Set([start, last, ...s.flatMap((x) => [x.t, x.t - trigger.windowMs])])]
    .filter((a) => a >= start && a <= last)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const a of starts) {
    const b = a + trigger.windowMs;
    const p = twapSorted(s, a, b, maxGap);
    if (p !== undefined && p < trigger.thresholdBps) {
      return { coveredAsset: trigger.coveredAsset, priceBps: p, windowStart: a, windowEnd: b };
    }
  }
  return undefined;
}

/**
 * A reading over the `windowMs` that ends at `now`, for the sale
 * circuit-breaker. Healthy or not, it is what the feed would publish; the
 * pool only accepts a Buy when EVERY allowlisted feed has such a reading at
 * or above the threshold and fresh (see `attestsPeg` and `healthy`).
 */
export function pegReading(
  samples: PriceSample[],
  coveredAsset: string,
  now: bigint,
  windowMs: bigint,
  opts: SeriesOptions = {},
): OracleDatum | undefined {
  const p = twap(samples, now - windowMs, now, opts);
  return p === undefined ? undefined : { coveredAsset, priceBps: p, windowStart: now - windowMs, windowEnd: now };
}

// ------------------------------------------------------------- on-chain mirrors

const sameBytes = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Mirror of `oracle.attests`: one datum proves the trigger fully inside [start, expiry]. */
export const attests = (d: OracleDatum, trigger: Trigger, start: bigint, expiry: bigint) =>
  sameBytes(d.coveredAsset, trigger.coveredAsset) &&
  d.priceBps < trigger.thresholdBps &&
  d.windowEnd - d.windowStart >= trigger.windowMs &&
  d.windowStart >= start &&
  d.windowEnd <= expiry;

/** Mirror of `oracle.attests_peg`: a healthy reading no older than `freshAfter`. */
export const attestsPeg = (d: OracleDatum, trigger: Trigger, freshAfter: bigint) =>
  sameBytes(d.coveredAsset, trigger.coveredAsset) && d.priceBps >= trigger.thresholdBps && d.windowEnd >= freshAfter;

/**
 * A candidate oracle UTxO as seen from a transaction's reference inputs:
 * the tokens it holds under `policyId` and its inline datum, if it decoded as
 * an `OracleDatum`.
 */
export interface FeedUtxo {
  /** Token names (hex) and quantities held under the oracle policy. */
  tokens: { name: string; quantity: bigint }[];
  policyId: string;
  datum?: OracleDatum;
}

/** Mirror of `oracle.feed_of`: exactly one token under the oracle policy, allowlisted. */
export function feedOf(u: FeedUtxo, config: OracleConfig): string | undefined {
  if (!sameBytes(u.policyId, config.policyId)) return undefined;
  if (u.tokens.length !== 1 || u.tokens[0].quantity !== 1n) return undefined;
  const name = u.tokens[0].name.toLowerCase();
  return config.feeds.some((f) => sameBytes(f, name)) ? name : undefined;
}

/**
 * Mirror of the private `quorum_agrees`: which distinct allowlisted feeds
 * agree, and whether that reaches the quorum. Also returns the subset of
 * UTxOs worth attaching as reference inputs (one per agreeing feed).
 */
export function quorumAgrees<T extends FeedUtxo>(
  utxos: T[],
  config: OracleConfig,
  pred: (d: OracleDatum) => boolean,
): { ok: boolean; feeds: string[]; use: T[] } {
  const feeds: string[] = [];
  const use: T[] = [];
  for (const u of utxos) {
    const name = feedOf(u, config);
    if (name === undefined || feeds.includes(name) || !u.datum || !pred(u.datum)) continue;
    feeds.push(name);
    use.push(u);
  }
  return { ok: config.quorum >= 1n && BigInt(feeds.length) >= config.quorum, feeds, use };
}

/** Mirror of `oracle.triggered`. */
export const triggered = <T extends FeedUtxo>(utxos: T[], config: OracleConfig, trigger: Trigger, start: bigint, expiry: bigint) =>
  quorumAgrees(utxos, config, (d) => attests(d, trigger, start, expiry));

/**
 * Mirror of `oracle.healthy`: EVERY allowlisted feed (not a quorum) has a
 * fresh healthy-peg reading among `utxos`. Unanimity because the buyer picks
 * the reference inputs and could otherwise omit a feed that shows a depeg.
 * `missing` lists the allowlisted feeds without a passing reading.
 *
 * On-chain any passing reading counts, even if a newer one from the same feed
 * reports a depeg; an honest client should pass only each feed's newest
 * reading (see `latestPerFeed`).
 */
export function healthy<T extends FeedUtxo>(
  utxos: T[],
  config: OracleConfig,
  trigger: Trigger,
  freshAfter: bigint,
): { ok: boolean; feeds: string[]; use: T[]; missing: string[] } {
  const q = quorumAgrees(utxos, config, (d) => attestsPeg(d, trigger, freshAfter));
  const missing = config.feeds.filter((f) => !q.feeds.some((n) => sameBytes(n, f)));
  return { ok: config.feeds.length >= 1 && q.feeds.length === config.feeds.length, feeds: q.feeds, use: q.use, missing };
}

/** The newest reading (largest `windowEnd`) per allowlisted feed. */
export function latestPerFeed<T extends FeedUtxo>(utxos: T[], config: OracleConfig): T[] {
  const best = new Map<string, T>();
  for (const u of utxos) {
    const name = feedOf(u, config);
    if (name === undefined || !u.datum) continue;
    const prev = best.get(name);
    if (!prev || u.datum.windowEnd > prev.datum!.windowEnd) best.set(name, u);
  }
  return [...best.values()];
}

export type SettlementBlocker =
  | { code: "after-grace"; detail: string }
  | { code: "no-quorum"; detail: string };

/**
 * Would a Settle for `policy` with validity upper bound `txUpperBound` pass
 * the validator's claim-window and oracle checks? Returns the reference
 * inputs to attach when it would, and human-readable reasons when it would
 * not. (Token burns and pool accounting are checked by the tx builder.)
 */
export function settlementCheck<T extends FeedUtxo>(
  policy: Pick<PolicyDatum, "trigger" | "start" | "expiry">,
  utxos: T[],
  config: OracleConfig,
  claimGraceMs: bigint,
  txUpperBound: bigint,
): { ok: boolean; use: T[]; feeds: string[]; blockers: SettlementBlocker[] } {
  const blockers: SettlementBlocker[] = [];
  const deadline = policy.expiry + claimGraceMs;
  if (txUpperBound > deadline) {
    blockers.push({ code: "after-grace", detail: `claim window closed at ${deadline}; tx upper bound is ${txUpperBound}` });
  }
  const q = triggered(utxos, config, policy.trigger, policy.start, policy.expiry);
  if (!q.ok) {
    blockers.push({
      code: "no-quorum",
      detail: `${q.feeds.length} of ${config.quorum} required feeds attest the trigger inside the cover period`,
    });
  }
  return { ok: blockers.length === 0, use: q.ok ? q.use : [], feeds: q.feeds, blockers };
}
