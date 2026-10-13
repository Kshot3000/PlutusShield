import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OPEN_DATA_ENDPOINTS,
  OPEN_DATA_SCHEMA,
  checkOpenDataEnvelope,
  fetchOpenData,
  openDataEnvelope,
  openDataJson,
  openDataUrl,
} from "../src/index.ts";

const ROOT = "https://kshot3000.github.io/PlutusShield";
const AT = "2026-10-13T19:00:00.000Z";

test("every dataset has one unique api/v1 path ending in .json", () => {
  const paths = OPEN_DATA_ENDPOINTS.map((e) => e.path);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(new Set(OPEN_DATA_ENDPOINTS.map((e) => e.dataset)).size, paths.length);
  for (const p of paths) assert.match(p, /^api\/v1\/[a-z]+\.json$/);
});

test("openDataUrl joins the site root with or without a trailing slash", () => {
  assert.equal(openDataUrl(ROOT, "claims"), `${ROOT}/api/v1/claims.json`);
  assert.equal(openDataUrl(`${ROOT}/`, "claims"), `${ROOT}/api/v1/claims.json`);
});

test("envelope carries schema, networks, testnet and not-audited flags, and the page URL", () => {
  const e = openDataEnvelope("products", { n: 1 }, { generatedAt: AT, siteRoot: ROOT });
  assert.equal(e.schema, OPEN_DATA_SCHEMA);
  assert.deepEqual(e.networks, { cardano: "preview", midnight: "preprod" });
  assert.equal(e.testnetOnly, true);
  assert.equal(e.audited, false);
  assert.equal(e.page, `${ROOT}/products/`);
  assert.deepEqual(checkOpenDataEnvelope(e, "products"), { ok: true });
  assert.throws(() => openDataEnvelope("products", {}, { generatedAt: "yesterday", siteRoot: ROOT }));
});

test("checkOpenDataEnvelope refuses other schemas, datasets, networks and a mainnet claim", () => {
  const e = openDataEnvelope("book", [], { generatedAt: AT, siteRoot: ROOT });
  assert.equal(checkOpenDataEnvelope({ ...e, schema: "plutusshield.open-data/v2" }).ok, false);
  assert.equal(checkOpenDataEnvelope(e, "claims").ok, false);
  assert.equal(checkOpenDataEnvelope({ ...e, networks: { cardano: "mainnet", midnight: "preprod" } }).ok, false);
  assert.equal(checkOpenDataEnvelope({ ...e, audited: true }).ok, false);
  assert.equal(checkOpenDataEnvelope(null).ok, false);
});

test("openDataJson keeps bigint amounts exact as decimal strings", () => {
  const big = 123_456_789_012_345_678_901n;
  assert.equal(JSON.parse(openDataJson({ lovelace: big })).lovelace, big.toString());
});

test("fetchOpenData checks the envelope it fetched", async () => {
  const good = openDataEnvelope("oracle", { publishes: [] }, { generatedAt: AT, siteRoot: ROOT });
  const seen: string[] = [];
  const fake = (body: unknown, status = 200) =>
    (async (url: string | URL | Request) => {
      seen.push(String(url));
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
  const got = await fetchOpenData(ROOT, "oracle", fake(good));
  assert.deepEqual(got.data, { publishes: [] });
  assert.equal(seen[0], `${ROOT}/api/v1/oracle.json`);
  await assert.rejects(fetchOpenData(ROOT, "claims", fake(good)), /expected claims/);
  await assert.rejects(fetchOpenData(ROOT, "oracle", fake({}, 404)), /404/);
});
