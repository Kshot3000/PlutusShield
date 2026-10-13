#!/usr/bin/env node
/**
 * Test report: the one source for every test count the repo and site quote.
 *
 *   node scripts/test-report.mjs          run `pnpm test`, write apps/web/src/data/test-report.json,
 *                                         and rewrite the <!-- test-counts --> block in SECURITY.md
 *   node scripts/test-report.mjs --check  no tests run; fail if SECURITY.md or README.md quote a
 *                                         count that differs from the recorded report
 *
 * Counts come from each suite's own summary (Aiken's "Summary N checks", node:test's
 * "# tests / # pass / # fail", and the emulator's ✓ steps), never typed by hand.
 */
import { spawnSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = path.join(ROOT, 'apps/web/src/data/test-report.json');
const SECURITY = path.join(ROOT, 'SECURITY.md');
const README = path.join(ROOT, 'README.md');
const START = '<!-- test-counts -->';
const END = '<!-- /test-counts -->';

/** Package name in `pnpm test` output -> report key and label. */
const SUITES = {
  '@plutusshield/sdk': { key: 'sdk', label: 'SDK tests' },
  '@plutusshield/cardano-contracts': { key: 'aiken', label: 'Aiken checks' },
  '@plutusshield/cardano-deploy': { key: 'emulator', label: 'Lucid-emulator steps' },
  '@plutusshield/midnight-contracts': { key: 'midnight', label: 'Midnight simulation tests' },
  '@plutusshield/oracle-relay': { key: 'relay', label: 'oracle-relay tests' },
  '@plutusshield/committee': { key: 'committee', label: 'committee-kit tests' },
};

export function parse(log) {
  const out = {};
  const parts = log.split(/^> (@plutusshield\/[a-z-]+)@\S+ test\b.*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const s = SUITES[parts[i]];
    if (!s) continue;
    const body = parts[i + 1];
    if (s.key === 'aiken') {
      const m = body.match(/Summary (\d+) checks?, (\d+) errors?/);
      if (m) out.aiken = { total: +m[1], pass: +m[1] - +m[2], fail: +m[2] };
    } else if (s.key === 'emulator') {
      const steps = (body.match(/^\s*✓ /gm) ?? []).length;
      const refused = (body.match(/^\s*✓ .*\brefused\b/gm) ?? []).length;
      const ok = /emulator run passed/.test(body);
      out.emulator = { total: steps, pass: ok ? steps : 0, fail: ok ? 0 : 1, refused };
    } else {
      const n = (k) => +(body.match(new RegExp(`^# ${k} (\\d+)`, 'm'))?.[1] ?? NaN);
      out[s.key] = { total: n('tests'), pass: n('pass'), fail: n('fail') };
    }
  }
  return out;
}

export function sentence(suites) {
  const s = suites;
  return `On main today that runs ${s.aiken.total} Aiken checks, the Lucid-emulator end-to-end flow (${s.emulator.total} steps, ${s.emulator.refused} of them checks that a bad transaction or setup is refused), ${s.midnight.total} Midnight simulation tests, ${s.sdk.total} SDK tests, ${s.relay.total} oracle-relay tests and ${s.committee.total} committee-kit tests.`;
}

/** Quoted counts that must match the report, as [file, regex, suite key]. */
const CLAIMS = [
  [README, /(\d+) Aiken tests/g, 'aiken'],
  [README, /# (\d+) unit tests/g, 'aiken'],
  [SECURITY, /(\d+) Aiken checks/g, 'aiken'],
  [SECURITY, /(\d+) Midnight simulation tests/g, 'midnight'],
  [SECURITY, /(\d+) SDK tests/g, 'sdk'],
  [SECURITY, /(\d+) oracle-relay tests/g, 'relay'],
  [SECURITY, /(\d+) committee-kit tests/g, 'committee'],
];

function check(report) {
  const bad = [];
  for (const [file, re, key] of CLAIMS) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(re)) {
      if (+m[1] !== report.suites[key].total) bad.push(`${path.relative(ROOT, file)}: "${m[0]}" but the report has ${report.suites[key].total}`);
    }
  }
  const sec = fs.readFileSync(SECURITY, 'utf8');
  if (!sec.includes(`${START}\n${sentence(report.suites)}\n${END}`)) bad.push('SECURITY.md: test-counts block is not the generated sentence (run pnpm test:report)');
  return bad;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && process.argv.includes('--check')) {
  const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
  const bad = check(report);
  if (bad.length) { console.error('test-report check failed:\n  ' + bad.join('\n  ')); process.exit(1); }
  console.log(`test-report check ok (recorded ${report.recordedAt} at ${report.commit})`);
} else if (isMain) {
  // One stream, so each suite's stderr (Aiken prints its summary there) stays under its header.
  const r = spawnSync('sh', ['-c', 'pnpm test 2>&1'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
  const log = r.stdout ?? '';
  const suites = parse(log);
  const missing = Object.values(SUITES).map((s) => s.key).filter((k) => !suites[k] || Number.isNaN(suites[k].total));
  if (r.status !== 0 || missing.length) {
    console.error(log.slice(-4000));
    console.error(`pnpm test exit ${r.status}; unparsed suites: ${missing.join(', ') || 'none'}. Report not written.`);
    process.exit(1);
  }
  const failing = Object.entries(suites).filter(([, v]) => v.fail > 0);
  if (failing.length) { console.error(`failing suites: ${failing.map(([k]) => k).join(', ')}. Report not written.`); process.exit(1); }
  const commit = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  const total = Object.entries(suites).reduce((a, [k, v]) => a + (k === 'emulator' ? 0 : v.total), 0);
  const report = { recordedAt: new Date().toISOString(), commit, total, suites };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');
  const sec = fs.readFileSync(SECURITY, 'utf8');
  const block = `${START}\n${sentence(suites)}\n${END}`;
  const next = sec.includes(START) ? sec.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block) : sec.replace(/^On main today that runs .*$/m, block);
  fs.writeFileSync(SECURITY, next);
  for (const [k, v] of Object.entries(suites)) console.log(`${k.padEnd(10)} ${v.pass}/${v.total}`);
  console.log(`wrote ${path.relative(ROOT, REPORT)} (${total} tests + emulator, base ${commit})`);
  const bad = check(report);
  if (bad.length) { console.error('quoted counts out of date:\n  ' + bad.join('\n  ')); process.exit(1); }
}
