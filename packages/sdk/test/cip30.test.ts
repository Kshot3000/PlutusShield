import { test } from "node:test";
import assert from "node:assert/strict";
import {
  balanceOf,
  bech32Encode,
  decodeAddress,
  decodeCbor,
  formatUnits,
  hexToBytes,
  networkLabel,
  parseValue,
  shortAddress,
} from "../src/cip30.ts";

// Vectors below were produced with CML (cardano-multiplatform-lib) from @lucid-evolution/lucid 0.6.7.
const TUSDCX = "e5c5ae166089e4d907cabf8456dea8aebb76a2d5c65458c8e1e632ef.745553444378";
const POOL_NFT = "e5c5ae166089e4d907cabf8456dea8aebb76a2d5c65458c8e1e632ef.706f6f6c";

test("ada-only balance decodes to lovelace", () => {
  const b = parseValue("1a0016e360");
  assert.equal(b.lovelace, 1_500_000n);
  assert.equal(b.assets.size, 0);
  assert.equal(balanceOf(b, TUSDCX), 0n);
});

test("multi-asset balance decodes coin and every asset (8-byte uint)", () => {
  const b = parseValue(
    "821b00000002dfdc1c35a1581ce5c5ae166089e4d907cabf8456dea8aebb76a2d5c65458c8e1e632efa2467455534443781a0ee6b28044706f6f6c01",
  );
  assert.equal(b.lovelace, 12_345_678_901n);
  assert.equal(balanceOf(b, TUSDCX), 250_000_000n);
  assert.equal(balanceOf(b, POOL_NFT), 1n);
  assert.equal(balanceOf(b, TUSDCX.toUpperCase().replace("E5C5", "e5c5")), 250_000_000n);
  assert.equal(balanceOf(b, "lovelace"), 12_345_678_901n);
});

test("indefinite-length containers and bignum tags decode", () => {
  // indefinite array/map/bytes, plus tag-2 bignum = 2^64
  assert.deepEqual(decodeCbor("9f0102ff"), [1n, 2n]);
  const m = decodeCbor("bf0102ff");
  assert.ok(m instanceof Map && m.get(1n) === 2n);
  assert.equal(decodeCbor("c249010000000000000000"), 18446744073709551616n);
  assert.deepEqual(decodeCbor("5f42010243030405ff"), new Uint8Array([1, 2, 3, 4, 5]));
});

test("malformed CBOR is rejected, not misread", () => {
  assert.throws(() => decodeCbor("1a0016e3"), /truncated/);
  assert.throws(() => decodeCbor("0101"), /trailing/);
  assert.throws(() => decodeCbor("zz"), /hex/);
  assert.throws(() => parseValue("820101"), /Value/);
  assert.throws(() => parseValue("40"), /Value/);
  assert.throws(() => decodeCbor("5bffffffffffffffff"), /exceeds/);
});

test("enterprise testnet address round-trips to bech32 (Preview deployer)", () => {
  const a = decodeAddress("60de2b516ca6a4a377b94fea01884832dacc0f57bc21d2d52ebf9496d3");
  assert.equal(a.bech32, "addr_test1vr0zk5tv56j2xaaefl4qrzzgxtdvcr6hhssa94fwh72fd5ccklyuz");
  assert.equal(a.kind, "enterprise");
  assert.equal(a.networkId, 0);
  assert.equal(a.paymentHash, "de2b516ca6a4a377b94fea01884832dacc0f57bc21d2d52ebf9496d3");
  assert.equal(a.paymentIsScript, false);
});

test("base address with script stake credential", () => {
  const hex =
    "20de2b516ca6a4a377b94fea01884832dacc0f57bc21d2d52ebf9496d3eb8cc08ea47a99c9fa2623645339dc24acefd7cb9fbf9fb3ae1acb08";
  const a = decodeAddress(hex);
  assert.equal(
    a.bech32,
    "addr_test1yr0zk5tv56j2xaaefl4qrzzgxtdvcr6hhssa94fwh72fd5lt3nqgafr6n8yl5f3rv3fnnhpy4nha0julh70m8ts6evyqe6l6rw",
  );
  assert.equal(a.kind, "base");
  // CBOR-wrapped form (some wallets) decodes the same
  assert.equal(decodeAddress(`5839${hex}`).bech32, a.bech32);
});

test("mainnet reward address uses the stake hrp", () => {
  const a = decodeAddress("f1eb8cc08ea47a99c9fa2623645339dc24acefd7cb9fbf9fb3ae1acb08");
  assert.equal(a.bech32, "stake1784cesyw53afnj06yc3kg5eemsj2em7hew0ml8an4cdvkzqd2crsy");
  assert.equal(a.kind, "reward");
  assert.equal(a.networkId, 1);
  assert.equal(networkLabel(a.networkId), "Mainnet");
});

test("bech32 matches BIP-173 reference vector", () => {
  // BIP-173: "a12uel5l" is the empty-data string for hrp "a"
  assert.equal(bech32Encode("a", hexToBytes("")), "a12uel5l");
});

test("display helpers", () => {
  assert.equal(shortAddress("addr_test1vr0zk5tv56j2xaaefl4qrzzgxtdvcr6hhssa94fwh72fd5ccklyuz"), "addr_test1…cklyuz");
  assert.equal(formatUnits(12_345_678_901n, 6), "12,345.67");
  assert.equal(formatUnits(1_500_000n, 6), "1.5");
  assert.equal(formatUnits(2_000_000n, 6), "2");
  assert.equal(networkLabel(0), "Testnet");
});
