import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_API_VERSION_RANGE,
  KitErrorCodes,
  LaceMidnightError,
  MidnightNetworkIds,
  PLUTUSSHIELD_MIDNIGHT_NETWORK,
  connectMidnightWallet,
  connectWithProvider,
  discoverProvidersFromMap,
  findProvider,
  formatInjectionKey,
  formatMidnightAddress,
  normalizeConnectorError,
  parseSemVer,
  safeIconUrl,
  safeWalletLabel,
  semverSatisfies,
  summarizeConfiguration,
  userHintForError,
} from "../src/lace.ts";
import type { ConnectedAPI, ConnectionStatus, InitialAPI } from "@midnight-ntwrk/dapp-connector-api";

function fakeApi(overrides: Partial<InitialAPI> = {}): InitialAPI {
  return {
    rdns: overrides.rdns ?? "io.lace.midnight",
    name: overrides.name ?? "Lace",
    icon: overrides.icon ?? "data:image/png;base64,abc",
    apiVersion: overrides.apiVersion ?? "4.0.1",
    connect:
      overrides.connect ??
      (async () => {
        throw new Error("connect not stubbed");
      }),
  };
}

test("semver caret accepts 4.x and rejects other majors", () => {
  assert.equal(semverSatisfies("4.0.1", "^4.0.0"), true);
  assert.equal(semverSatisfies("4.1.0", "^4.0.0"), true);
  assert.equal(semverSatisfies("3.9.9", "^4.0.0"), false);
  assert.equal(semverSatisfies("5.0.0", "^4.0.0"), false);
  assert.equal(semverSatisfies("4.0.0", "4.0.0"), true);
  assert.equal(semverSatisfies("4.0.1", "4.0.0"), false);
  assert.equal(parseSemVer("v4.0.1")?.major, 4);
  assert.equal(parseSemVer("nope"), null);
  assert.equal(DEFAULT_API_VERSION_RANGE, "^4.0.0");
  assert.equal(PLUTUSSHIELD_MIDNIGHT_NETWORK, MidnightNetworkIds.Preprod);
});

test("discoverProvidersFromMap enumerates UUID keys and never requires mnLace", () => {
  const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  const map: Record<string, unknown> = {
    [uuid]: fakeApi(),
    mnLace: { not: "a wallet" },
    junk: null,
  };
  const result = discoverProvidersFromMap(map);
  assert.equal(result.injectionKeys.includes(uuid), true);
  assert.equal(result.injectionKeys.includes("mnLace"), true);
  assert.equal(result.providers.length, 1);
  assert.equal(result.compatible.length, 1);
  assert.equal(result.compatible[0]!.injectionKey, uuid);
  assert.equal(result.hasDuplicateRdns, false);
});

test("discoverProvidersFromMap filters by apiVersion and detects duplicate rdns", () => {
  const map: Record<string, unknown> = {
    a: fakeApi({ apiVersion: "3.0.0", rdns: "io.lace.midnight" }),
    b: fakeApi({ apiVersion: "4.0.1", rdns: "io.lace.midnight", name: "Lace A" }),
    c: fakeApi({ apiVersion: "4.2.0", rdns: "io.lace.midnight", name: "Lace B" }),
  };
  const filtered = discoverProvidersFromMap(map);
  assert.equal(filtered.providers.length, 3);
  assert.equal(filtered.compatible.length, 2);
  assert.equal(filtered.hasDuplicateRdns, true);

  const all = discoverProvidersFromMap(map, { apiVersionRange: "*" });
  assert.equal(all.compatible.length, 3);

  assert.throws(
    () => discoverProvidersFromMap(map, { throwOnDuplicateRdns: true }),
    (e: unknown) => e instanceof LaceMidnightError && e.code === KitErrorCodes.DuplicateRdns,
  );
});

test("discoverProvidersFromMap returns empty when midnight is missing", () => {
  assert.deepEqual(discoverProvidersFromMap(undefined), {
    providers: [],
    compatible: [],
    hasDuplicateRdns: false,
    injectionKeys: [],
  });
  assert.deepEqual(discoverProvidersFromMap(null), {
    providers: [],
    compatible: [],
    hasDuplicateRdns: false,
    injectionKeys: [],
  });
});

test("findProvider selects by injectionKey, rdns, or preferRdnsIncludes", () => {
  const map: Record<string, unknown> = {
    "uuid-one": fakeApi({ rdns: "io.other.wallet", name: "Other" }),
    "uuid-two": fakeApi({ rdns: "io.lace.midnight", name: "Lace" }),
  };
  assert.equal(findProvider({ injectionKey: "uuid-two" }, map).injectionKey, "uuid-two");
  assert.equal(findProvider({ rdns: "io.lace.midnight" }, map).api.name, "Lace");
  assert.equal(findProvider({ preferRdnsIncludes: "lace" }, map).injectionKey, "uuid-two");
  assert.throws(
    () => findProvider({ rdns: "missing" }, map),
    (e: unknown) => e instanceof LaceMidnightError && e.code === KitErrorCodes.ProviderNotFound,
  );
  assert.throws(
    () => findProvider({ injectionKey: "x" }, {}),
    (e: unknown) => e instanceof LaceMidnightError && e.code === KitErrorCodes.NoProviders,
  );
});

test("safe labels and address formatters sanitize display strings", () => {
  assert.equal(safeWalletLabel({ name: "Lace<script>" }), "Lace");
  assert.equal(safeIconUrl({ icon: "data:image/png;base64,xx" }), "data:image/png;base64,xx");
  assert.equal(safeIconUrl({ icon: "javascript:alert(1)" }), null);
  assert.equal(safeIconUrl({ icon: "https://lace.io/icon.png" }), "https://lace.io/icon.png");
  const short = "mn_addr1abcdef";
  assert.equal(formatMidnightAddress(short), short);
  const long = "mn_shield-addr_preprod1" + "x".repeat(40);
  assert.match(formatMidnightAddress(long), /…/);
  assert.equal(formatMidnightAddress(long, { head: 6, tail: 4 }).startsWith("mn_shi"), true);
  assert.equal(formatMidnightAddress(null), "(unavailable)");
  assert.equal(formatInjectionKey("a1b2c3d4-e5f6-7890"), "a1b2c3d4…");
});

test("summarizeConfiguration maps service URIs for the UI", () => {
  const s = summarizeConfiguration({
    indexerUri: "https://indexer.example/api/v1",
    indexerWsUri: "wss://indexer.example/api/v1/graphql/ws",
    proverServerUri: "http://localhost:6300",
    substrateNodeUri: "wss://node.example",
    networkId: "preprod",
  });
  assert.equal(s.networkId, "preprod");
  assert.equal(s.proverServerUri, "http://localhost:6300");
  assert.equal(summarizeConfiguration(null).indexerUri, null);
});

test("normalizeConnectorError maps Lace strings and APIError codes", () => {
  const unavailable = normalizeConnectorError(new Error("Wallet is unavailable"));
  assert.equal(unavailable.code, KitErrorCodes.WalletUnavailable);
  assert.equal(unavailable.recoverable, true);
  assert.match(userHintForError(unavailable), /sync/i);

  const apiErr = normalizeConnectorError({
    type: "DAppConnectorAPIError",
    code: "Rejected",
    reason: "User said no",
    message: "User said no",
    name: "Error",
  });
  assert.equal(apiErr.code, "Rejected");
  assert.equal(apiErr.recoverable, true);

  const cancelled = normalizeConnectorError("user rejected the request");
  assert.equal(cancelled.code, KitErrorCodes.UserCancelled);
});

test("connectWithProvider reads addresses and configuration from a stub wallet", async () => {
  const status: ConnectionStatus = { status: "connected", networkId: "preprod" };
  const connected = {
    getConnectionStatus: async () => status,
    getConfiguration: async () => ({
      indexerUri: "https://indexer.example",
      indexerWsUri: "wss://indexer.example/ws",
      proverServerUri: "http://127.0.0.1:6300",
      substrateNodeUri: "wss://node.example",
      networkId: "preprod",
    }),
    getUnshieldedAddress: async () => ({ unshieldedAddress: "mn_addr_preprod1unshielded" }),
    getShieldedAddresses: async () => ({
      shieldedAddress: "mn_shield-addr_preprod1shielded",
      shieldedCoinPublicKey: "pk",
      shieldedEncryptionPublicKey: "epk",
    }),
    getDustAddress: async () => ({ dustAddress: "mn_dust_preprod1dust" }),
  } as unknown as ConnectedAPI;

  const provider = {
    injectionKey: "uuid-test",
    api: fakeApi({
      connect: async (networkId: string) => {
        assert.equal(networkId, "preprod");
        return connected;
      },
    }),
  };

  const session = await connectWithProvider(provider);
  assert.equal(session.networkId, "preprod");
  assert.equal(session.addresses.unshieldedAddress, "mn_addr_preprod1unshielded");
  assert.equal(session.addresses.shieldedAddress, "mn_shield-addr_preprod1shielded");
  assert.equal(session.services.proverServerUri, "http://127.0.0.1:6300");
});

test("connectMidnightWallet refuses when no providers and when multiple need a choice", async () => {
  await assert.rejects(
    () => connectMidnightWallet({ midnight: {} }),
    (e: unknown) => e instanceof LaceMidnightError && e.code === KitErrorCodes.NoProviders,
  );

  const map: Record<string, unknown> = {
    a: fakeApi({ name: "One", rdns: "io.one" }),
    b: fakeApi({ name: "Two", rdns: "io.two" }),
  };
  await assert.rejects(
    () => connectMidnightWallet({ midnight: map }),
    (e: unknown) => e instanceof LaceMidnightError && e.code === KitErrorCodes.ProviderNotFound,
  );
});
