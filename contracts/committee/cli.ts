#!/usr/bin/env -S node --experimental-strip-types --no-warnings
/**
 * PlutusShield assessor-operator CLI. Offline: no network, no chain tx.
 *
 *   committee keygen --out <dir> --handle <@you> [--affiliation <protocol>]... [--seat <0|1|2>]
 *       fresh Cardano Preview assessor key + Midnight Preprod committee seat secret
 *       (0600 files in <dir>), and a PUBLIC signed enrollment.json to share
 *   committee verify <enrollment.json>... [--secrets <dir>] [--json]
 *       check encodings, key hash / address derivation and the ed25519 signature;
 *       --secrets also checks your local key files open the record
 *   committee seat --dir <dir> --seat <0|1|2>
 *       relabel your local seat file once the team assigns your seat
 *   committee plan <a.json> <b.json> <c.json> [--threshold 2] [--out plan.json] [--no-current]
 *       dry run: the exploit-cover Committee parameter (CBOR) and the Midnight
 *       policy-cover-v2 constructor args a redeploy with these three seats would use
 *
 * Run from a checkout: `node --experimental-strip-types contracts/committee/cli.ts <cmd>`
 * or `pnpm committee <cmd>` (paths resolve from where you ran pnpm).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkLocalSecrets, currentFromRepo, FILES, keygen, KitError, planCommittee, setSeat, verifyEnrollment, type Enrollment } from "./lib/kit.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CWD = process.env.INIT_CWD ?? process.cwd();
const abs = (p: string) => resolve(CWD, p.replace(/^~(?=\/|$)/, process.env.HOME ?? "~"));

function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split(/=(.*)/s, 2);
      const boolean = ["json", "no-current", "help"].includes(k);
      const v = inline ?? (boolean ? "true" : argv[++i]);
      if (v === undefined) throw new KitError(`--${k} needs a value`);
      (flags[k] ??= []).push(v);
    } else pos.push(a);
  }
  return { pos, flags, one: (k: string) => flags[k]?.at(-1), has: (k: string) => !!flags[k] };
}

const USAGE = `usage:
  committee keygen --out <dir> --handle <@you> [--affiliation <protocol>]... [--seat <0|1|2>]
  committee verify <enrollment.json>... [--secrets <dir>] [--json]
  committee seat --dir <dir> --seat <0|1|2>
  committee plan <a.json> <b.json> <c.json> [--threshold 2] [--out plan.json] [--no-current]`;

const readJson = (f: string) => JSON.parse(readFileSync(abs(f), "utf8"));

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const a = parseArgs(rest);
  if (!cmd || cmd === "help" || cmd === "--help" || a.has("help")) {
    console.log(USAGE);
    return cmd ? 0 : 1;
  }

  if (cmd === "keygen") {
    const out = a.one("out");
    const handle = a.one("handle");
    if (!out || !handle) throw new KitError("keygen needs --out <dir> and --handle <@you>");
    const seat = a.one("seat") === undefined ? 0 : Number(a.one("seat"));
    const r = await keygen({ dir: abs(out), handle, affiliations: a.flags.affiliation ?? [], seat });
    console.log(`assessor identity written to ${r.dir} (directory 0700, secrets 0600):`);
    console.log(`  SECRET  ${FILES.cardanoSk}     Cardano Preview signing key (bech32 ed25519_sk)`);
    console.log(`  SECRET  ${FILES.cardanoSkey}   same key as a cardano-cli TextEnvelope`);
    console.log(`  SECRET  ${FILES.midnightSeat}     Midnight Preprod committee seat secret (relay format)`);
    console.log(`  public  ${FILES.cardanoVkey}   verification key`);
    console.log(`  public  ${FILES.enrollment}        share THIS file, and only this file`);
    console.log("");
    console.log(`handle          ${r.enrollment.operator.handle}`);
    console.log(`Cardano keyHash ${r.enrollment.cardano.keyHash}`);
    console.log(`Cardano address ${r.enrollment.cardano.address}`);
    console.log(`Midnight seat   ${r.enrollment.midnight.seatCommitment}`);
    console.log("\nBack up the secret files offline. Nobody from PlutusShield will ever ask for them.");
    return 0;
  }

  if (cmd === "verify") {
    if (!a.pos.length) throw new KitError("verify needs at least one enrollment.json");
    let bad = 0;
    const results = [];
    for (const f of a.pos) {
      let rec: unknown;
      let v;
      try {
        rec = readJson(f);
        v = verifyEnrollment(rec);
      } catch (e) {
        v = { ok: false, problems: [`cannot read ${f}: ${(e as Error).message}`] };
      }
      const secretsDir = a.one("secrets");
      if (v.ok && secretsDir) {
        const s = await checkLocalSecrets(rec as Enrollment, abs(secretsDir));
        v = { ok: s.ok, problems: s.problems };
      }
      if (!v.ok) bad++;
      const r = rec as Enrollment | undefined;
      results.push({ file: f, ok: v.ok, problems: v.problems, handle: r?.operator?.handle, keyHash: r?.cardano?.keyHash, seatCommitment: r?.midnight?.seatCommitment });
    }
    if (a.has("json")) console.log(JSON.stringify(results, null, 2));
    else
      for (const r of results) {
        console.log(`${r.ok ? "✓" : "✗"} ${r.file}${r.ok ? `  ${r.handle}  keyHash ${r.keyHash}  seat ${r.seatCommitment}` : ""}`);
        for (const p of r.problems) console.log(`    - ${p}`);
      }
    return bad ? 1 : 0;
  }

  if (cmd === "seat") {
    const dir = a.one("dir");
    const seat = a.one("seat");
    if (!dir || seat === undefined) throw new KitError("seat needs --dir <dir> and --seat <0|1|2>");
    const r = setSeat(abs(dir), Number(seat));
    console.log(`${r.file} now labelled seat ${seat}; the Midnight relay expects it as ${r.relayFileName}`);
    return 0;
  }

  if (cmd === "plan") {
    const threshold = a.one("threshold") === undefined ? 2 : Number(a.one("threshold"));
    const plan = planCommittee(a.pos.map(readJson), { threshold, current: a.has("no-current") ? undefined : currentFromRepo(REPO_ROOT) });
    const text = `${JSON.stringify(plan, null, 2)}\n`;
    const out = a.one("out");
    if (out) {
      writeFileSync(abs(out), text);
      console.error(`dry-run plan written to ${abs(out)} (planSha256 ${plan.planSha256})`);
    } else process.stdout.write(text);
    for (const w of plan.warnings) console.error(`warning: ${w}`);
    return 0;
  }

  console.error(USAGE);
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof KitError || e instanceof SyntaxError ? `error: ${e.message}` : e);
    process.exit(1);
  },
);
