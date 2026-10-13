#!/usr/bin/env node
/**
 * Snapshot the live Preview pool UTxOs so the static site always has real
 * on-chain state to show, even if a browser can't reach Koios:
 *
 *   USDM depeg pool          src/data/preview-pool-snapshot.json
 *   exploit-cover v2 pool    src/data/preview-exploit-v2-pool-snapshot.json
 *
 * Runs as part of `pnpm build`, so every Pages deploy bakes in fresh state.
 * Non-fatal: on any error the committed snapshot is kept.
 */
import { readFileSync, writeFileSync } from "node:fs";

const KOIOS = process.env.NEXT_PUBLIC_PREVIEW_KOIOS ?? "https://preview.koios.rest/api/v1";
const exploit = JSON.parse(readFileSync(new URL("../src/data/preview-exploit-v2-deployment.json", import.meta.url), "utf8"));

const TARGETS = [
  {
    name: "depeg pool",
    address: process.env.NEXT_PUBLIC_PREVIEW_POOL_ADDRESS ?? "addr_test1wp89ggl7ls5gwxh02w7ja6zhytqe4a6zu6m6n82s0cxw9tq4j5tgr",
    out: new URL("../src/data/preview-pool-snapshot.json", import.meta.url),
  },
  { name: "exploit v2 pool", address: exploit.address, out: new URL("../src/data/preview-exploit-v2-pool-snapshot.json", import.meta.url) },
];

for (const t of TARGETS) {
  try {
    const res = await fetch(`${KOIOS}/address_utxos`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ _addresses: [t.address], _extended: true }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Koios ${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body) || body.length === 0) throw new Error("no UTxOs at the pool address");
    const utxos = body.map((u) => ({
      tx_hash: u.tx_hash,
      tx_index: u.tx_index,
      value: u.value,
      block_time: u.block_time ?? null,
      asset_list: (u.asset_list ?? []).map((a) => ({ policy_id: a.policy_id, asset_name: a.asset_name, quantity: a.quantity })),
      inline_datum: u.inline_datum?.bytes ? { bytes: u.inline_datum.bytes } : null,
    }));
    writeFileSync(t.out, JSON.stringify({ takenAt: new Date().toISOString(), address: t.address, utxos }, null, 1) + "\n");
    console.log(`snapshot (${t.name}): ${utxos.length} UTxOs at ${t.address}`);
  } catch (e) {
    console.warn(`snapshot (${t.name}) skipped (${e instanceof Error ? e.message : e}); keeping the committed snapshot`);
  }
}
