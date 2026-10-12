import { test } from "node:test";
import assert from "node:assert/strict";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import {
  BrowserCircuits,
  CIRCUIT_SUBMIT_HINT_METHODS,
  DEFAULT_PROOF_SERVER_URI,
  PREPROD_V2_CONTRACT_ADDRESS,
  assessCircuitSubmitReadiness,
  balanceAndSubmitViaLace,
  hintCircuitPermissions,
  prepareFileClaimCall,
  prepareProveCoverCall,
  probeProverHealth,
  resolveProvingStrategy,
  runBrowserFileClaim,
  runBrowserProveCover,
  type BrowserCircuitProver,
} from "../src/laceCircuits.ts";
import { ErrorCodes, KitErrorCodes, LaceMidnightError, isLaceMidnightError } from "../src/lace.ts";
import { makePolicyKey } from "../src/midnight.ts";

const POLICY = "33".repeat(32);
const EVIDENCE = "aa".repeat(32);

async function sampleKey() {
  return makePolicyKey({
    network: "preview",
    policyId: POLICY,
    coverage: 25_000_000n,
    asset: "tADA",
    expiry: 1_900_000_000_000n,
  });
}

test("resolveProvingStrategy prefers getProvingProvider, then Lace URI, then localhost", () => {
  const withDelegated = {
    getProvingProvider: async () => ({}),
  } as unknown as ConnectedAPI;
  assert.equal(resolveProvingStrategy(withDelegated, null).kind, "delegated");

  const laceHttp = resolveProvingStrategy({} as ConnectedAPI, {
    indexerUri: "https://i",
    indexerWsUri: "wss://i",
    substrateNodeUri: "wss://n",
    networkId: "preprod",
    proverServerUri: "http://prover.lace.example:6300/",
  });
  assert.equal(laceHttp.kind, "http");
  if (laceHttp.kind === "http") {
    assert.equal(laceHttp.proverServerUri, "http://prover.lace.example:6300");
    assert.equal(laceHttp.source, "lace-config");
  }

  const fallback = resolveProvingStrategy({} as ConnectedAPI, {
    indexerUri: "https://i",
    indexerWsUri: "wss://i",
    substrateNodeUri: "wss://n",
    networkId: "preprod",
  });
  assert.equal(fallback.kind, "http");
  if (fallback.kind === "http") {
    assert.equal(fallback.proverServerUri, DEFAULT_PROOF_SERVER_URI);
    assert.equal(fallback.source, "fallback-default");
  }
});

test("probeProverHealth tries /health then root; never throws", async () => {
  const calls: string[] = [];
  const okFetch: typeof fetch = async (input) => {
    calls.push(String(input));
    return new Response("ok", { status: 200 });
  };
  const healthy = await probeProverHealth("http://127.0.0.1:6300", okFetch);
  assert.equal(healthy.ok, true);
  assert.equal(calls[0], "http://127.0.0.1:6300/health");

  const failFetch: typeof fetch = async () => {
    throw new Error("ECONNREFUSED");
  };
  const down = await probeProverHealth("http://127.0.0.1:6300", failFetch);
  assert.equal(down.ok, false);
  assert.match(down.detail, /ECONNREFUSED/);
});

test("prepareFileClaimCall and prepareProveCoverCall validate key + args", async () => {
  const key = await sampleKey();
  const file = await prepareFileClaimCall({ key, evidenceCommitment: EVIDENCE.toUpperCase() });
  assert.equal(file.circuit, BrowserCircuits.fileClaim);
  assert.equal(file.policyId, POLICY);
  assert.equal(file.evidenceCommitment, EVIDENCE);
  assert.equal(file.contractAddress, PREPROD_V2_CONTRACT_ADDRESS);
  assert.equal(file.privateState.openings[POLICY].amount, 25_000_000n);

  await assert.rejects(
    () => prepareFileClaimCall({ key, evidenceCommitment: "zz" }),
    (e: unknown) => isLaceMidnightError(e) && e.code === ErrorCodes.InvalidRequest,
  );
  await assert.rejects(
    () => prepareFileClaimCall({ key, evidenceCommitment: EVIDENCE, datumCommitment: "00".repeat(32) }),
    (e: unknown) => isLaceMidnightError(e) && e.recoverable === true,
  );

  const prove = await prepareProveCoverCall({ key });
  assert.equal(prove.circuit, BrowserCircuits.proveCover);
  assert.equal(prove.minCoverage, "25000000");
  await assert.rejects(
    () => prepareProveCoverCall({ key, minCoverage: 25_000_001n }),
    (e: unknown) => isLaceMidnightError(e) && e.code === ErrorCodes.InvalidRequest,
  );
});

test("assessCircuitSubmitReadiness separates Lace path vs midnight-js prover gap", () => {
  const blocked = assessCircuitSubmitReadiness({
    connected: false,
    hasCircuitProver: false,
    callPrepared: false,
  });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.lacePathReady, false);
  assert.equal(blocked.checks.find((c) => c.id === "wallet-connected")?.ok, false);

  const laceReady = assessCircuitSubmitReadiness({
    connected: true,
    networkId: "preprod",
    api: {} as ConnectedAPI,
    configuration: {
      indexerUri: "https://i",
      indexerWsUri: "wss://i",
      substrateNodeUri: "wss://n",
      networkId: "preprod",
      proverServerUri: "http://127.0.0.1:6300",
    },
    proverHealth: { ok: true, uri: "http://127.0.0.1:6300", status: 200, detail: "healthy" },
    hasCircuitProver: false,
    callPrepared: true,
  });
  assert.equal(laceReady.lacePathReady, true);
  assert.equal(laceReady.ready, false);
  assert.equal(laceReady.checks.find((c) => c.id === "circuit-prover")?.ok, false);
  assert.equal(laceReady.proving.kind, "http");

  const full = assessCircuitSubmitReadiness({
    ...laceReady,
    connected: true,
    networkId: "preprod",
    api: { getProvingProvider: async () => ({}) } as unknown as ConnectedAPI,
    configuration: laceReady.services as never,
    proverHealth: { ok: true, uri: "x", status: 200, detail: "ok" },
    hasCircuitProver: true,
    callPrepared: true,
  });
  // rebuild properly
  const full2 = assessCircuitSubmitReadiness({
    connected: true,
    networkId: "preprod",
    api: { getProvingProvider: async () => ({}) } as unknown as ConnectedAPI,
    configuration: {
      indexerUri: "https://i",
      indexerWsUri: "wss://i",
      substrateNodeUri: "wss://n",
      networkId: "preprod",
    },
    hasCircuitProver: true,
    callPrepared: true,
  });
  assert.equal(full2.ready, true);
  assert.equal(full2.proving.kind, "delegated");
  assert.ok(CIRCUIT_SUBMIT_HINT_METHODS.includes("submitTransaction"));
});

test("hintCircuitPermissions and balanceAndSubmitViaLace drive ConnectedAPI", async () => {
  const hinted: string[][] = [];
  const api = {
    hintUsage: async (methods: string[]) => {
      hinted.push(methods);
    },
    balanceUnsealedTransaction: async (tx: string, opts?: { payFees?: boolean }) => {
      assert.equal(tx, "unsealed-hex");
      assert.equal(opts?.payFees, true);
      return { tx: "balanced-hex" };
    },
    submitTransaction: async (tx: string) => {
      assert.equal(tx, "balanced-hex");
    },
  } as unknown as ConnectedAPI;

  await hintCircuitPermissions(api);
  assert.deepEqual(hinted[0], [...CIRCUIT_SUBMIT_HINT_METHODS]);

  const result = await balanceAndSubmitViaLace(api, "unsealed-hex");
  assert.equal(result.balancedTx, "balanced-hex");
  assert.equal(result.submitted, true);
  assert.equal(hinted.length, 2);

  await assert.rejects(
    () => balanceAndSubmitViaLace(api, ""),
    (e: unknown) => e instanceof LaceMidnightError && e.code === ErrorCodes.InvalidRequest,
  );
});

test("runBrowserFileClaim and runBrowserProveCover orchestrate prove + Lace submit", async () => {
  const key = await sampleKey();
  const prover: BrowserCircuitProver = {
    proveFileClaim: async (call) => {
      assert.equal(call.policyId, POLICY);
      assert.equal(call.evidenceCommitment, EVIDENCE);
      return { unsealedTx: "file-unsealed" };
    },
    proveProveCover: async (call) => {
      assert.equal(call.minCoverage, "25000000");
      return { unsealedTx: "prove-unsealed" };
    },
  };

  const submitted: string[] = [];
  const api = {
    getProvingProvider: async () => ({}),
    getConfiguration: async () => ({
      indexerUri: "https://i",
      indexerWsUri: "wss://i",
      substrateNodeUri: "wss://n",
      networkId: "preprod",
    }),
    hintUsage: async () => {},
    balanceUnsealedTransaction: async (tx: string) => ({ tx: `balanced:${tx}` }),
    submitTransaction: async (tx: string) => {
      submitted.push(tx);
    },
  } as unknown as ConnectedAPI;

  const filed = await runBrowserFileClaim({
    api,
    key,
    evidenceCommitment: EVIDENCE,
    prover,
  });
  assert.equal(filed.call.circuit, "fileClaim");
  assert.equal(filed.proving.kind, "delegated");
  assert.equal(filed.submit.balancedTx, "balanced:file-unsealed");
  assert.deepEqual(submitted, ["balanced:file-unsealed"]);

  const proved = await runBrowserProveCover({ api, key, prover });
  assert.equal(proved.call.circuit, "proveCover");
  assert.equal(proved.submit.balancedTx, "balanced:prove-unsealed");
  assert.equal(submitted.at(-1), "balanced:prove-unsealed");
});

test("balanceAndSubmitViaLace normalizes wallet rejection", async () => {
  const api = {
    hintUsage: async () => {},
    balanceUnsealedTransaction: async () => {
      throw { type: "DAppConnectorAPIError", code: "Rejected", reason: "Nope", message: "Nope", name: "Error" };
    },
    submitTransaction: async () => {},
  } as unknown as ConnectedAPI;
  await assert.rejects(
    () => balanceAndSubmitViaLace(api, "tx"),
    (e: unknown) => isLaceMidnightError(e) && e.code === "Rejected" && e.recoverable === true,
  );
  assert.equal(KitErrorCodes.Unknown, "Unknown");
});
