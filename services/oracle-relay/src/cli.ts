/**
 * Usage (from the repo root): pnpm relay:evaluate <input.json> [--json]
 * Paths are resolved from the directory pnpm was invoked in.
 *
 * Prints what this relay would publish for its feed: the depeg attestation
 * (if the trigger is met inside the cover period) and the current peg reading
 * for the sale circuit-breaker, each with its inline-datum CBOR.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluate } from "./relay.ts";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: evaluate <input.json> [--json]");
  process.exit(2);
}
const report = evaluate(JSON.parse(readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), file), "utf8")));
if (args.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`PlutusShield oracle relay: ${report.coveredAsset} (${report.coveredAssetHex})`);
  console.log(`venues: ${report.venues.map((v) => `${v.name} (${v.samples})`).join(", ")}`);
  for (const n of report.notes) console.log(`- ${n}`);
  if (report.depeg) console.log(`depeg datum CBOR: ${report.depeg.cborHex}`);
  if (report.peg) console.log(`peg datum CBOR:   ${report.peg.cborHex}`);
}
