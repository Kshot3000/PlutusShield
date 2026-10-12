#!/usr/bin/env node
/**
 * Build a holder claim kit from files: `pnpm midnight:claim-kit --key <policy-key.json>
 * --evidence <evidence-input.json> [--out <file>]`
 *
 * For holders whose policy key lives on disk (`pnpm exploit buy`, `pnpm web-buy`,
 * a restored backup) rather than in a browser. Runs the same SDK code as
 * /claim/evidence: seals the evidence (canonical bundle -> SHA-256 -> fresh salt
 * -> evidenceCommitment, AES-256-GCM envelope + key file) and wraps the policy
 * key in the passphrase envelope, then re-opens the kit before writing it.
 * The passphrase comes from PLUTUSSHIELD_CLAIM_KIT_PASSPHRASE (never argv, so
 * it stays out of shell history and `ps`). Target address defaults to the v2
 * registry in contracts/midnight/deployments/preprod-v2.json. No network, no
 * wallet. File it with `policy-cover-preprod.mjs --claim <policyId> --kit <file>`.
 * Prints only public data (policy id, evidence commitment, output path).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { claimKitFileName } from "../../../packages/sdk/src/claimkit.ts";
import { buildClaimKitFromFiles } from "./claims.ts";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");
// pnpm --filter runs in contracts/midnight; resolve paths against where the holder ran it.
const CWD = process.env.INIT_CWD ?? process.cwd();
const argv = process.argv.slice(2);
const opt = (k: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const keyFile = opt("key");
const evidenceFile = opt("evidence");
if (!keyFile || !evidenceFile) {
  console.error("usage: kit-cli.ts --key <policy-key.json> --evidence <evidence-input.json> [--out <file>] [--address <v2 contract>]");
  process.exit(2);
}
const record = join(ROOT, "contracts/midnight/deployments/preprod-v2.json");
const address = opt("address") ?? (existsSync(record) ? JSON.parse(readFileSync(record, "utf8")).contractAddress : undefined);
const { kit, text } = await buildClaimKitFromFiles({
  keyFile: resolve(CWD, keyFile),
  evidenceFile: resolve(CWD, evidenceFile),
  passphrase: process.env.PLUTUSSHIELD_CLAIM_KIT_PASSPHRASE ?? "",
  address,
});
const out = resolve(CWD, opt("out") ?? claimKitFileName(kit.policyId));
writeFileSync(out, text, { mode: 0o600 });
console.log(JSON.stringify({ kit: out, schema: kit.schema, policyId: kit.policyId, call: kit.call, target: kit.target }, null, 2));
