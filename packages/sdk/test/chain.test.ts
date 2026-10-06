import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ADA,
  POOL_NFT,
  buildPolicyDatum,
  coverDatumData,
  depegTrigger,
  encodePlutusData,
  bytesToHex,
  textHex,
  toCborHex,
  type AssetClass,
  type PlutusData,
  type ProductTerms,
} from "../src/cardano.ts";
import { decodeCoverDatum, decodePlutusData, readPoolState, type ChainUtxo } from "../src/chain.ts";

const USDC: AssetClass = { policyId: "e5c5ae166089e4d907cabf8456dea8aebb76a2d5c65458c8e1e632ef", assetName: "745553444378" };
const SCRIPT = "4e5423fefc28871aef53bd2ee85722c19af742e6b7a99d507e0ce2ac";

test("decodePlutusData inverts encodePlutusData across every shape", () => {
  const samples: PlutusData[] = [
    { int: 0n },
    { int: -1n },
    { int: (1n << 64n) - 1n },
    { int: 1n << 70n },
    { int: -(1n << 70n) },
    { bytes: "" },
    { bytes: "ab".repeat(100) }, // chunked > 64 bytes
    { list: [] },
    { list: [{ int: 1n }, { bytes: "00" }] },
    { map: [{ k: { int: 1n }, v: { bytes: "ff" } }] },
    { constructor: 0, fields: [] },
    { constructor: 6, fields: [{ int: 7n }] },
    { constructor: 7, fields: [{ int: 8n }] },
    { constructor: 127, fields: [] },
    { constructor: 200, fields: [{ list: [{ constructor: 1, fields: [] }] }] },
  ];
  for (const s of samples) assert.deepEqual(decodePlutusData(bytesToHex(encodePlutusData(s))), s);
});

test("decodeCoverDatum round-trips a Policy datum built by the SDK", () => {
  const terms = {
    productId: textHex("depeg"),
    trigger: depegTrigger(textHex("USDM")),
  } as unknown as ProductTerms;
  const policy = buildPolicyDatum({
    poolRef: { txHash: "11".repeat(32), outputIndex: 2 },
    terms,
    asset: USDC,
    coverage: 1_000_000_000n,
    premium: 5_000_000n,
    start: 1_759_700_000_000n,
    days: 30n,
    midnightCommitment: "ab".repeat(32),
    refundTo: { payment: { type: "Key", hash: "de".repeat(28) }, stake: { type: "Key", hash: "ad".repeat(28) } },
  });
  const back = decodeCoverDatum(toCborHex(coverDatumData({ kind: "Policy", policy })));
  assert.deepEqual(back, { kind: "Policy", policy });
});

test("decodeCoverDatum rejects data that is not a cover datum", () => {
  assert.throws(() => decodeCoverDatum(toCborHex({ constructor: 2, fields: [] })), /malformed/);
  assert.throws(() => decodeCoverDatum(toCborHex({ constructor: 0, fields: [{ int: 1n }] })), /malformed/);
  assert.throws(() => decodeCoverDatum("d8799f"), /truncated/);
});

const fixture = JSON.parse(readFileSync(new URL("./fixtures/preview-pool-utxos.json", import.meta.url), "utf8")) as ChainUtxo[];

test("readPoolState reads the live Preview pool snapshot", () => {
  const s = readPoolState(fixture, SCRIPT, [ADA, USDC], 9_000n);
  assert.equal(s.tranches.length, 2);
  const [ada, usd] = s.tranches;
  // Snapshot after InitPool, 2000 ADA + 100k tUSDCx deposits, 150 ADA and 1000 tUSDCx covers.
  assert.equal(ada.totalShares, 2_000_000_000n);
  assert.equal(ada.activeCover, 150_000_000n);
  assert.equal(usd.totalShares, 100_000_000_000n);
  assert.equal(usd.activeCover, 1_000_000_000n);
  assert.equal(usd.capital, 100_005_000_000n); // deposits + one 5 tUSDCx premium
  assert.ok(ada.capital > ada.totalShares, "ADA share price is above 1 after a premium");
  assert.equal(usd.utilizationBps, (1_000_000_000n * 10_000n) / 100_005_000_000n);
  assert.equal(usd.freeCapacity, (100_005_000_000n * 9_000n) / 10_000n - 1_000_000_000n);
  assert.equal(s.policies.length, 2);
  assert.deepEqual(new Set(s.policies.map((p) => p.tranche)), new Set([0, 1]));
  assert.equal(s.ignored, 0);
});

test("readPoolState needs exactly one pool NFT", () => {
  const noPool = fixture.filter((u) => !(u.asset_list ?? []).some((a) => a.asset_name === POOL_NFT));
  assert.throws(() => readPoolState(noPool, SCRIPT, [ADA, USDC], 9_000n), /not found/);
  const pool = fixture.find((u) => (u.asset_list ?? []).some((a) => a.asset_name === POOL_NFT))!;
  assert.throws(() => readPoolState([...fixture, { ...pool, tx_index: 9 }], SCRIPT, [ADA, USDC], 9_000n), /twice/);
});

test("readPoolState ignores stray UTxOs and bad policy datums", () => {
  const stray: ChainUtxo = { tx_hash: "22".repeat(32), tx_index: 0, value: "1000000", asset_list: [], inline_datum: null };
  const s = readPoolState([...fixture, stray], SCRIPT, [ADA, USDC], 9_000n);
  assert.equal(s.ignored, 1);
  assert.equal(s.policies.length, 2);
});

test("decodeOracleDatum reads feed datums and skips anything else", async () => {
  const { decodeOracleDatum } = await import("../src/chain.ts");
  const { oracleDatumData } = await import("../src/cardano.ts");
  const d = { coveredAsset: textHex("USDM"), priceBps: 10_000n, windowStart: 1_000n, windowEnd: 86_401_000n };
  assert.deepEqual(decodeOracleDatum(toCborHex(oracleDatumData(d))), d);
  assert.equal(decodeOracleDatum(undefined), undefined);
  assert.equal(decodeOracleDatum(toCborHex({ constructor: 0, fields: [{ int: 1n }] })), undefined);
  assert.equal(decodeOracleDatum("zz"), undefined);
});

test("chainUtxoFromBlockfrost maps Blockfrost UTxOs onto the Koios shape readPoolState takes", async () => {
  const { chainUtxoFromBlockfrost, fetchBlockfrostUtxos } = await import("../src/chain.ts");
  // Rebuild each fixture UTxO the way Blockfrost would return it, then map back.
  const bf = fixture.map((u) => ({
    tx_hash: u.tx_hash,
    output_index: u.tx_index,
    amount: [{ unit: "lovelace", quantity: u.value }, ...(u.asset_list ?? []).map((a) => ({ unit: a.policy_id + (a.asset_name ?? ""), quantity: a.quantity }))],
    inline_datum: u.inline_datum?.bytes ?? null,
  }));
  const mapped = bf.map(chainUtxoFromBlockfrost);
  const a = readPoolState(fixture, SCRIPT, [ADA, USDC], 9_000n);
  const b = readPoolState(mapped, SCRIPT, [ADA, USDC], 9_000n);
  assert.deepEqual(b.tranches, a.tranches);
  assert.deepEqual(b.policies.map((p) => p.policy), a.policies.map((p) => p.policy));

  // Paging + 404-as-empty, with a fake fetch.
  const calls: string[] = [];
  const page = (n: number) => Array.from({ length: n }, () => bf[0]);
  const fake = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    assert.equal((init?.headers as Record<string, string>).project_id, "previewXYZ");
    const p = Number(new URL(url).searchParams.get("page"));
    return new Response(JSON.stringify(p === 1 ? page(100) : page(3)), { status: 200 });
  }) as typeof fetch;
  assert.equal((await fetchBlockfrostUtxos("https://bf.example/api/v0/", "previewXYZ", "addr_test1x", fake)).length, 103);
  assert.equal(calls.length, 2);
  const none = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
  assert.deepEqual(await fetchBlockfrostUtxos("https://bf.example/api/v0", "p", "addr_test1x", none), []);
});
