#!/usr/bin/env node
/**
 * Copy policy-cover-v2 verifier + zkir (and optionally prover keys) into
 * apps/web/public/zk/policy-cover-v2 for Pages probes / local Lace experiments.
 *
 * Env:
 *   ZK_ASSET_SOURCE   — dir with keys/ and zkir/ (default: agent run tree)
 *   SYNC_PROVER_KEYS=1 — also copy multi-MB .prover files (never commit them)
 *   CIRCUITS          — comma list (default: fileClaim,proveCover)
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, "..");
const destRoot = join(webRoot, "public", "zk", "policy-cover-v2");

const DEFAULT_SOURCE =
  process.env.ZK_ASSET_SOURCE ||
  "/workspace/Midnight-GrokBot-Agent/.plutusshield-run/policy-cover-v2";

const circuits = (process.env.CIRCUITS || "fileClaim,proveCover")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const syncProver = process.env.SYNC_PROVER_KEYS === "1";
const source = resolve(DEFAULT_SOURCE);

if (!existsSync(join(source, "keys")) || !existsSync(join(source, "zkir"))) {
  console.error(`Source missing keys/ or zkir/: ${source}`);
  process.exit(1);
}

mkdirSync(join(destRoot, "keys"), { recursive: true });
mkdirSync(join(destRoot, "zkir"), { recursive: true });

function copy(kind, file) {
  const from = join(source, kind === "zkir" ? "zkir" : "keys", file);
  const to = join(destRoot, kind === "zkir" ? "zkir" : "keys", file);
  if (!existsSync(from)) {
    console.warn(`skip missing ${from}`);
    return;
  }
  copyFileSync(from, to);
  const n = statSync(to).size;
  console.log(`copied ${kind}/${file} (${n} bytes)`);
}

for (const id of circuits) {
  copy("keys", `${id}.verifier`);
  copy("zkir", `${id}.zkir`);
  if (syncProver) copy("keys", `${id}.prover`);
}

if (!syncProver) {
  console.log("Prover keys skipped (set SYNC_PROVER_KEYS=1 for local prove experiments).");
}
console.log(`Done → ${destRoot}`);
