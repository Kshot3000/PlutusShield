import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ZK_ASSET_BASE,
  FetchZkConfigError,
  fetchZkConfig,
  isFetchZkConfigError,
  joinZkAssetUrl,
  probeZkAssets,
  zkAssetPaths,
  zkAssetsReadinessSummary,
} from "../src/fetchZkConfig.ts";

function bytes(n: number, fill = 1): Uint8Array {
  return new Uint8Array(n).fill(fill);
}

test("joinZkAssetUrl and zkAssetPaths match NodeZkConfigProvider layout", () => {
  assert.equal(DEFAULT_ZK_ASSET_BASE, "zk/policy-cover-v2");
  assert.equal(joinZkAssetUrl("/PlutusShield/zk/policy-cover-v2", "keys/fileClaim.verifier"), "/PlutusShield/zk/policy-cover-v2/keys/fileClaim.verifier");
  assert.equal(joinZkAssetUrl("zk/policy-cover-v2/", "/zkir/proveCover.zkir"), "zk/policy-cover-v2/zkir/proveCover.zkir");
  const paths = zkAssetPaths("fileClaim");
  assert.equal(paths.prover, "keys/fileClaim.prover");
  assert.equal(paths.verifier, "keys/fileClaim.verifier");
  assert.equal(paths.zkir, "zkir/fileClaim.zkir");
});

test("fetchZkConfig loads prover + verifier + zkir via injectable fetch", async () => {
  const store = new Map<string, Uint8Array>([
    ["http://assets/keys/fileClaim.prover", bytes(12, 9)],
    ["http://assets/keys/fileClaim.verifier", bytes(4, 2)],
    ["http://assets/zkir/fileClaim.zkir", bytes(8, 3)],
  ]);
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    const body = store.get(url);
    if (!body) return new Response(null, { status: 404 });
    return new Response(body, { status: 200 });
  };
  const cfg = await fetchZkConfig("http://assets", "fileClaim", fetchImpl);
  assert.equal(cfg.proverKey.byteLength, 12);
  assert.equal(cfg.verifierKey[0], 2);
  assert.equal(cfg.zkir[0], 3);
});

test("fetchZkConfig throws typed FetchZkConfigError on missing asset", async () => {
  const fetchImpl: typeof fetch = async () => new Response(null, { status: 404 });
  try {
    await fetchZkConfig("http://x", "proveCover", fetchImpl);
    assert.fail("expected throw");
  } catch (e) {
    assert.ok(isFetchZkConfigError(e));
    assert.equal((e as FetchZkConfigError).circuitId, "proveCover");
    assert.equal((e as FetchZkConfigError).code, "missing-asset");
    assert.ok(["prover", "verifier", "zkir"].includes((e as FetchZkConfigError).kind));
  }
});

test("probeZkAssets never throws; verifier+zkir required, prover optional", async () => {
  const okUrls = new Set([
    "http://a/keys/fileClaim.verifier",
    "http://a/zkir/fileClaim.zkir",
    "http://a/keys/proveCover.verifier",
    "http://a/zkir/proveCover.zkir",
  ]);
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (!okUrls.has(url)) return new Response(null, { status: 404 });
    if ((init as RequestInit | undefined)?.method === "HEAD") {
      return new Response(null, { status: 200, headers: { "content-length": "100" } });
    }
    return new Response(bytes(100), { status: 200 });
  };
  const probe = await probeZkAssets("http://a", ["fileClaim", "proveCover"], fetchImpl);
  assert.equal(probe.ok, true);
  assert.equal(probe.circuits.every((c) => c.ok), true);
  assert.equal(probe.circuits.every((c) => c.proverOk), false);
  assert.match(probe.detail, /ZK assets ready/);
  assert.match(probe.circuits[0]!.detail, /prover key local/);

  const down = await probeZkAssets("http://a", ["fileClaim"], async () => {
    throw new Error("offline");
  });
  assert.equal(down.ok, false);
  assert.equal(down.circuits[0]!.ok, false);

  const summary = zkAssetsReadinessSummary(probe);
  assert.equal(summary?.ok, true);
  assert.equal(zkAssetsReadinessSummary(null), null);
});
