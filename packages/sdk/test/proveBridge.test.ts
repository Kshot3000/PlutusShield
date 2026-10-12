import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PROVE_BRIDGE_URI,
  ProveBridgeError,
  createProveBridgeProver,
  probeProveBridge,
  proveBridgeRequest,
  serializeHolderPrivateState,
  shieldedKeysFromLace,
} from "../src/proveBridge.ts";
import { prepareFileClaimCall, prepareProveCoverCall, runBrowserProveCover } from "../src/laceCircuits.ts";
import { makePolicyKey } from "../src/midnight.ts";

const POLICY = "44".repeat(32);
const EVIDENCE = "bb".repeat(32);
const KEYS = { coinPublicKey: "mn_shield-cpk_preprod1qqq", encryptionPublicKey: "mn_shield-epk_preprod1qqq" };

const sampleKey = () =>
  makePolicyKey({ network: "preview", policyId: POLICY, coverage: 25_000_000n, asset: "tADA", expiry: 1_900_000_000_000n });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("serializeHolderPrivateState turns SDK bytes/bigints into hex + decimal strings", async () => {
  const key = await sampleKey();
  const call = await prepareProveCoverCall({ key });
  const s = serializeHolderPrivateState(call.privateState as never);
  assert.equal(s.sk, key.holderSecret);
  assert.deepEqual(s.openings[POLICY], { amount: "25000000", salt: key.coverageSalt });
  assert.doesNotThrow(() => JSON.stringify(s));
  assert.throws(() => serializeHolderPrivateState({ sk: "zz", openings: {} }), ProveBridgeError);
});

test("proveBridgeRequest carries the circuit-specific argument", async () => {
  const key = await sampleKey();
  const file = proveBridgeRequest(await prepareFileClaimCall({ key, evidenceCommitment: EVIDENCE }), KEYS);
  assert.equal(file.circuit, "fileClaim");
  assert.equal((file as { evidenceCommitment: string }).evidenceCommitment, EVIDENCE);
  const prove = proveBridgeRequest(await prepareProveCoverCall({ key, minCoverage: "1000" }), KEYS);
  assert.equal(prove.circuit, "proveCover");
  assert.equal((prove as { minCoverage: string }).minCoverage, "1000");
  assert.equal(prove.coinPublicKey, KEYS.coinPublicKey);
});

test("probeProveBridge recognises the bridge and never throws", async () => {
  const ok = await probeProveBridge(DEFAULT_PROVE_BRIDGE_URI, async () =>
    json(200, { ok: true, service: "plutusshield-prove-bridge", circuits: ["proveCover", "fileClaim"], contractAddress: "54", proofServer: "http://127.0.0.1:6300" }),
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.proofServer, "http://127.0.0.1:6300");
  const other = await probeProveBridge("http://x", async () => json(200, { ok: true, service: "something-else" }));
  assert.equal(other.ok, false);
  const down = await probeProveBridge("http://x", async () => {
    throw new TypeError("Failed to fetch");
  });
  assert.equal(down.ok, false);
  assert.match(down.detail, /midnight:prove-bridge/);
});

test("createProveBridgeProver posts the call and returns Lace's unsealed tx", async () => {
  const key = await sampleKey();
  let sent: Record<string, unknown> | null = null;
  const proved: number[] = [];
  const prover = createProveBridgeProver({
    getShieldedKeys: async () => KEYS,
    fetchImpl: async (url, init) => {
      assert.equal(String(url), `${DEFAULT_PROVE_BRIDGE_URI}/prove`);
      sent = JSON.parse(String(init?.body));
      return json(200, { ok: true, unsealedTx: "6d".repeat(64), bytes: 64, provedMs: 900 });
    },
    onProved: (_c, r) => proved.push(r.bytes),
  });
  const call = await prepareFileClaimCall({ key, evidenceCommitment: EVIDENCE });
  const out = await prover.proveFileClaim(call, { proving: { kind: "unavailable", detail: "" } });
  assert.equal(out.unsealedTx, "6d".repeat(64));
  assert.equal((sent as unknown as { circuit: string }).circuit, "fileClaim");
  assert.equal(typeof (sent as unknown as { privateState: { sk: string } }).privateState.sk, "string");
  assert.deepEqual(proved, [64]);
});

test("circuit rejections surface as 422 ProveBridgeError", async () => {
  const key = await sampleKey();
  const prover = createProveBridgeProver({
    getShieldedKeys: async () => KEYS,
    fetchImpl: async () => json(422, { ok: false, error: "failed assert: caller does not hold this policy" }),
  });
  const call = await prepareProveCoverCall({ key });
  await assert.rejects(
    prover.proveProveCover(call, { proving: { kind: "unavailable", detail: "" } }),
    (e: unknown) => e instanceof ProveBridgeError && e.circuitRejected && /does not hold/.test(e.message),
  );
});

test("bridge prover plugs into runBrowserProveCover (Lace balances + submits)", async () => {
  const key = await sampleKey();
  const prover = createProveBridgeProver({
    getShieldedKeys: async () => KEYS,
    fetchImpl: async () => json(200, { ok: true, unsealedTx: "ab".repeat(40), bytes: 40, provedMs: 1 }),
  });
  const calls: string[] = [];
  const api = {
    hintUsage: async () => {},
    getConfiguration: async () => ({ proverServerUri: "http://127.0.0.1:6300", networkId: "preprod" }),
    balanceUnsealedTransaction: async (tx: string) => {
      calls.push(`balance:${tx.slice(0, 4)}`);
      return { tx: `${tx}ff` };
    },
    submitTransaction: async (tx: string) => {
      calls.push(`submit:${tx.slice(-2)}`);
    },
  };
  await runBrowserProveCover({ api: api as never, key, prover });
  assert.deepEqual(calls, ["balance:abab", "submit:ff"]);
});

test("shieldedKeysFromLace reads Lace's coin + encryption keys", async () => {
  const keys = await shieldedKeysFromLace({
    getShieldedAddresses: async () => ({ shieldedAddress: "a", shieldedCoinPublicKey: "c", shieldedEncryptionPublicKey: "e" }),
  });
  assert.deepEqual(keys, { coinPublicKey: "c", encryptionPublicKey: "e" });
  await assert.rejects(
    shieldedKeysFromLace({ getShieldedAddresses: async () => ({ shieldedAddress: "a" }) as never }),
    ProveBridgeError,
  );
});
