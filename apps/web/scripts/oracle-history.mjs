#!/usr/bin/env node
/**
 * Bake the Preview oracle publish history into src/data/preview-oracle-history.json
 * for the /oracle page: every reading the relay published to the three Preview
 * feeds, with its tx hash, read from the deployment record the publisher appends
 * to (contracts/cardano/deploy/deployments/preview.json `txs`). Local file only,
 * no network. Everything in it is public on-chain data.
 * Non-fatal: on any error the committed history is kept.
 */
import { readFileSync, writeFileSync } from "node:fs";

const SRC = new URL("../../../contracts/cardano/deploy/deployments/preview.json", import.meta.url);
const OUT = new URL("../src/data/preview-oracle-history.json", import.meta.url);
const KEY = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) oracle (live )?peg (\d+)bps/;

try {
  const file = JSON.parse(readFileSync(SRC, "utf8"));
  const publishes = Object.entries(file.txs ?? {})
    .map(([k, tx]) => {
      const m = KEY.exec(k);
      return m && /^[0-9a-f]{64}$/.test(String(tx)) ? { at: m[1], bps: Number(m[3]), tx: String(tx), live: Boolean(m[2]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.at.localeCompare(b.at));
  if (publishes.length === 0) throw new Error("no oracle publishes in the deployment record");
  writeFileSync(OUT, `${JSON.stringify({ feeds: file.oracle?.feeds ?? [], publishes }, null, 2)}\n`);
  console.log(`oracle history: ${publishes.length} publishes, last ${publishes.at(-1).at}`);
} catch (e) {
  console.warn(`oracle history skipped (${e instanceof Error ? e.message : e}); keeping the committed file`);
}
