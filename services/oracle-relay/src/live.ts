/**
 * Usage (from the repo root): pnpm relay:live [--json]
 *
 * Read-only: pulls the live USDM venues, runs the relay, and prints what a
 * relay would publish right now. Signs nothing. The Preview publisher in
 * contracts/cardano/deploy (`pnpm oracle:publish`) uses the same snapshot.
 */
import { evaluate } from "./relay.ts";
import { liveInput } from "./venues.ts";

const snap = await liveInput();
const ok = snap.venues.filter((v) => v.ok);
const report = ok.length ? evaluate(snap.input) : null;
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ venues: snap.venues, report }, null, 2));
} else {
  console.log(`PlutusShield oracle relay, live USDM venues at ${new Date(Number(snap.input.now)).toISOString()}`);
  for (const v of snap.venues)
    console.log(`  ${v.ok ? "ok  " : "FAIL"} ${v.name.padEnd(20)} ${v.ok ? `${v.samples} samples, last ${(v.lastBps! / 100).toFixed(2)}%` : v.error}  (${v.describe})`);
  for (const n of report?.notes ?? ["No venue answered: nothing to publish."]) console.log(`- ${n}`);
}
