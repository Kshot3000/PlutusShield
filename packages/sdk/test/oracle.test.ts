import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY_MS, textHex, type OracleConfig, type OracleDatum, type Trigger } from "../src/cardano.ts";
import {
  HOUR_MS,
  attests,
  attestsPeg,
  findDepegWindow,
  healthy,
  latestPerFeed,
  medianSeries,
  pegReading,
  settlementCheck,
  triggered,
  twap,
  type FeedUtxo,
  type PriceSample,
} from "../src/oracle.ts";

const H = HOUR_MS;
const USDM = textHex("USDM");
const trigger: Trigger = { coveredAsset: USDM, thresholdBps: 9_500n, windowMs: DAY_MS };
const policy = textHex("0aac1e").padEnd(56, "0");
const config: OracleConfig = { policyId: policy, feeds: ["feed-a", "feed-b", "feed-c"].map(textHex), quorum: 2n };

/** Hourly samples: price(h) for h in [0, hours]. */
const hourly = (hours: number, price: (h: number) => number): PriceSample[] =>
  Array.from({ length: hours + 1 }, (_, h) => ({ t: BigInt(h) * H, priceBps: BigInt(price(h)) }));

test("twap weights each price by how long it held", () => {
  const s: PriceSample[] = [
    { t: 0n, priceBps: 10_000n },
    { t: 3n * H, priceBps: 9_000n },
  ];
  // 3h at 1.00 then 1h at 0.90 => 0.975
  assert.equal(twap(s, 0n, 4n * H, { maxGapMs: 3n * H }), 9_750n);
  // unsorted input is fine
  assert.equal(twap([...s].reverse(), 0n, 4n * H, { maxGapMs: 3n * H }), 9_750n);
  // but a 3h-old price is stale under the default 1h tolerance
  assert.equal(twap(s, 0n, 4n * H), undefined);
});

test("twap rounds down like on-chain integer division", () => {
  const s: PriceSample[] = [
    { t: 0n, priceBps: 10_000n },
    { t: 1n, priceBps: 9_999n },
    { t: 2n, priceBps: 9_999n },
  ];
  // (10000 + 9999 + 9999) / 3 = 9999.33..
  assert.equal(twap(s, 0n, 3n, { maxGapMs: 10n }), 9_999n);
});

test("twap refuses windows it cannot fully see or that span stale data", () => {
  const s = hourly(10, () => 10_000);
  assert.equal(twap(s, -1n, 2n * H), undefined, "no sample before window start");
  const gappy = s.filter((x) => x.t !== 5n * H && x.t !== 6n * H);
  assert.equal(twap(gappy, 0n, 10n * H), undefined, "3h gap > 1h default");
  assert.equal(twap(gappy, 0n, 10n * H, { maxGapMs: 3n * H }), 10_000n);
  assert.equal(twap(s, 9n * H, 12n * H), undefined, "last sample too old by window end");
});

test("median of sources resists one manipulated feed", () => {
  const honest1 = hourly(4, () => 10_000);
  const honest2 = hourly(4, () => 9_990);
  const attacker = hourly(4, () => 5_000);
  const m = medianSeries([honest1, attacker, honest2]);
  assert.deepEqual(m.map((x) => x.priceBps), [9_990n, 9_990n, 9_990n, 9_990n, 9_990n]);
  // even count takes the lower middle
  assert.equal(medianSeries([honest1, honest2])[0].priceBps, 9_990n);
});

test("median carries a source's last price forward", () => {
  const a: PriceSample[] = [{ t: 0n, priceBps: 10_000n }];
  const b: PriceSample[] = [{ t: 0n, priceBps: 9_000n }, { t: 10n, priceBps: 8_000n }];
  const c: PriceSample[] = [{ t: 5n, priceBps: 9_500n }];
  assert.deepEqual(medianSeries([a, b, c]), [
    { t: 0n, priceBps: 9_000n },
    { t: 5n, priceBps: 9_500n },
    { t: 10n, priceBps: 9_500n },
  ]);
});

test("findDepegWindow finds the earliest provable 24h depeg inside cover", () => {
  // Peg holds for 2 days, then trades at 0.90 from hour 48 to hour 96.
  const s = hourly(120, (h) => (h >= 48 && h < 96 ? 9_000 : 10_000));
  const d = findDepegWindow(s, trigger, 0n, 120n * H);
  assert.ok(d);
  assert.ok(d.priceBps < 9_500n);
  assert.equal(d.windowEnd - d.windowStart, DAY_MS);
  // Earliest 24h window with TWAP < 0.95: needs > 12h of 0.90 inside it,
  // i.e. start at hour 37 (11h at 1.00 + 13h at 0.90 = 0.9458).
  assert.equal(d.windowStart, 37n * H);
  assert.equal(d.priceBps, (11n * 10_000n + 13n * 9_000n) / 24n);
  assert.ok(attests(d, trigger, 0n, 120n * H), "what the relay publishes is what the validator accepts");
});

test("findDepegWindow ignores a dip that is too short or outside the cover period", () => {
  const blip = hourly(120, (h) => (h >= 48 && h < 58 ? 9_000 : 10_000));
  assert.equal(findDepegWindow(blip, trigger, 0n, 120n * H), undefined, "10h at 0.90 averages above 0.95 over any 24h");
  const late = hourly(120, (h) => (h >= 80 ? 9_000 : 10_000));
  assert.equal(findDepegWindow(late, trigger, 0n, 90n * H), undefined, "depeg mostly after expiry");
  assert.ok(findDepegWindow(late, trigger, 0n, 120n * H));
  assert.equal(findDepegWindow(late, trigger, 100n * H, 110n * H), undefined, "cover shorter than the window");
});

test("findDepegWindow will not prove a depeg across a data outage", () => {
  // 32h depeg, but the feed went dark for 22h in the middle of it.
  const full = hourly(120, (h) => (h >= 48 && h < 80 ? 9_000 : 10_000));
  assert.ok(findDepegWindow(full, trigger, 0n, 120n * H));
  const s = full.filter((x) => x.t < 50n * H || x.t > 70n * H);
  assert.equal(findDepegWindow(s, trigger, 0n, 120n * H), undefined);
  assert.ok(findDepegWindow(s, trigger, 0n, 120n * H, { maxGapMs: 22n * H }), "only if the deployment tolerates the gap");
});

test("pegReading gives the sale circuit-breaker a fresh reading", () => {
  const s = hourly(48, () => 9_990);
  const r = pegReading(s, USDM, 48n * H, DAY_MS);
  assert.deepEqual(r, { coveredAsset: USDM, priceBps: 9_990n, windowStart: 24n * H, windowEnd: 48n * H });
  assert.ok(attestsPeg(r!, trigger, 47n * H));
  assert.ok(!attestsPeg(r!, trigger, 48n * H + 1n), "stale for a later sale");
});

// --- mirrors of the Aiken tests in contracts/cardano/lib/plutusshield/oracle.ak

const feed = (name: string, datum?: OracleDatum, pol = policy, quantity = 1n): FeedUtxo => ({
  policyId: pol,
  tokens: [{ name: textHex(name), quantity }],
  datum,
});
const depeg = (price: bigint): OracleDatum => ({ coveredAsset: USDM, priceBps: price, windowStart: 1_000n, windowEnd: 1_000n + DAY_MS });
const peg = (price: bigint, windowEnd: bigint): OracleDatum => ({ coveredAsset: USDM, priceBps: price, windowStart: windowEnd - DAY_MS, windowEnd });

test("aiken parity: quorum of two distinct feeds triggers", () => {
  assert.ok(triggered([feed("feed-a", depeg(9_100n)), feed("feed-c", depeg(9_400n))], config, trigger, 0n, 200_000_000n).ok);
});

test("aiken parity: same feed twice does not make quorum", () => {
  assert.ok(!triggered([feed("feed-a", depeg(9_100n)), feed("feed-a", depeg(9_100n))], config, trigger, 0n, 200_000_000n).ok);
});

test("aiken parity: malformed datum, wrong policy, unlisted feed, or 2 tokens are ignored", () => {
  const ok = feed("feed-a", depeg(9_100n));
  for (const bad of [
    feed("feed-b", undefined),
    feed("feed-b", depeg(9_100n), "ff".repeat(28)),
    feed("feed-z", depeg(9_100n)),
    feed("feed-b", depeg(9_100n), policy, 2n),
  ]) {
    assert.ok(!triggered([ok, bad], config, trigger, 0n, 200_000_000n).ok);
  }
});

test("aiken parity: sale circuit-breaker needs every feed", () => {
  const a = feed("feed-a", peg(10_000n, 5_000_000n));
  const b = feed("feed-b", peg(10_000n, 5_000_000n));
  assert.ok(healthy([a, feed("feed-b", peg(9_980n, 5_000_000n)), feed("feed-c", peg(9_990n, 4_500_000n))], config, trigger, 4_000_000n).ok);
  assert.ok(healthy(["feed-a", "feed-b", "feed-c"].map((n) => feed(n, peg(9_500n, 5_000_000n))), config, trigger, 5_000_000n).ok, "exactly at threshold");
  assert.ok(!healthy([a, b, feed("feed-c", peg(9_400n, 5_000_000n))], config, trigger, 4_000_000n).ok, "one feed depegged");
  const omitted = healthy([a, b], config, trigger, 4_000_000n);
  assert.ok(!omitted.ok, "a healthy quorum that omits a feed is not enough");
  assert.deepEqual(omitted.missing, [textHex("feed-c")]);
  assert.ok(!healthy([a, b, feed("feed-c", peg(10_000n, 3_999_999n))], config, trigger, 4_000_000n).ok, "stale");
  const other: OracleDatum = { coveredAsset: textHex("DJED"), priceBps: 10_000n, windowStart: 0n, windowEnd: 5_000_000n };
  assert.ok(!healthy([a, b, feed("feed-c", other)], config, trigger, 4_000_000n).ok, "another asset");
  assert.ok(!healthy([a, b, b], config, trigger, 4_000_000n).ok, "distinct feeds");
  assert.ok(!healthy([], { ...config, feeds: [] }, trigger, 0n).ok, "empty allowlist");
});

test("latestPerFeed keeps each feed's newest reading", () => {
  const old = feed("feed-c", peg(10_000n, 4_000_000n));
  const fresh = feed("feed-c", peg(9_300n, 5_000_000n));
  const a = feed("feed-a", peg(10_000n, 5_000_000n));
  const b = feed("feed-b", peg(10_000n, 5_000_000n));
  // on-chain the old healthy feed-c reading would still pass; the client must not use it
  assert.ok(healthy([a, b, old, fresh], config, trigger, 3_000_000n).ok);
  const latest = latestPerFeed([a, b, old, fresh], config);
  assert.equal(latest.length, 3);
  assert.ok(latest.includes(fresh) && !latest.includes(old));
  assert.ok(!healthy(latest, config, trigger, 3_000_000n).ok);
});

test("settlementCheck explains why a claim would or would not settle", () => {
  const p = { trigger, start: 0n, expiry: 200_000_000n };
  const grace = 3n * DAY_MS;
  const utxos = [feed("feed-a", depeg(9_100n)), feed("feed-b", peg(10_000n, 5_000_000n)), feed("feed-c", depeg(9_400n))];

  const good = settlementCheck(p, utxos, config, grace, 200_000_000n + grace);
  assert.ok(good.ok);
  assert.deepEqual(good.feeds, ["feed-a", "feed-c"].map(textHex));
  assert.equal(good.use.length, 2, "only agreeing feeds are attached as reference inputs");

  const late = settlementCheck(p, utxos, config, grace, 200_000_000n + grace + 1n);
  assert.deepEqual(late.blockers.map((b) => b.code), ["after-grace"]);

  const thin = settlementCheck(p, utxos.slice(0, 2), config, grace, 100_000_000n);
  assert.deepEqual(thin.blockers.map((b) => b.code), ["no-quorum"]);
  assert.match(thin.blockers[0].detail, /1 of 2/);
  assert.equal(thin.use.length, 0);
});

test("end to end: raw sources -> relay datums -> settlement passes", () => {
  // Three venues; one is frozen at peg (stale/manipulated) and gets outvoted.
  const venueA = hourly(120, (h) => (h >= 48 && h < 96 ? 9_100 : 10_000));
  const venueB = hourly(120, (h) => (h >= 48 && h < 96 ? 9_050 : 9_995));
  const frozen = hourly(120, () => 10_000);
  const series = medianSeries([venueA, venueB, frozen]);
  const d = findDepegWindow(series, trigger, 0n, 120n * H)!;
  assert.ok(d);
  // two independent relays publish the same datum under different feed tokens
  const check = settlementCheck({ trigger, start: 0n, expiry: 120n * H }, [feed("feed-a", d), feed("feed-b", d)], config, DAY_MS, 130n * H);
  assert.ok(check.ok, JSON.stringify(check.blockers));
});
