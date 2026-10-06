/**
 * The Cardano Preview -> Midnight relay plan: every live PlutusShield policy on
 * Preview, whether it is already in policy-cover on Midnight Preprod, and if
 * not, whether the relay can register it (a Buy-tx ticket or a local policy
 * key that opens the datum) and prove cover (local policy key only).
 *
 * Network only, no Midnight runtime: Koios for Cardano (keyless), and a
 * caller-supplied `isMirrored` (the dry-run CLI reads the public indexer
 * state; the live relay decodes the ledger with the compiled contract).
 *
 * Trusts the chain, not files: policy id, coverage, expiry and the commitment
 * come from the on-chain datum; tickets and keys are only used if they open it.
 * Never returns or prints secrets: entries carry the key file path, not the key.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AssetClass } from "../../../packages/sdk/src/cardano.ts";
import { readPoolState, type ChainUtxo, type LivePolicy } from "../../../packages/sdk/src/chain.ts";
import { checkPolicyKey, parsePolicyKey, type PolicyKey } from "../../../packages/sdk/src/midnight.ts";
import { classifyMirror, parseTicket, type MirrorPlanEntry, type RegistrationTicket } from "../../../packages/sdk/src/relay.ts";

export const KOIOS_PREVIEW = "https://preview.koios.rest/api/v1";

export interface PreviewDeployment {
  scriptHash: string;
  address: string;
  maxUtilizationBps: string | number;
  assets: AssetClass[];
}

export interface RelayPlanEntry extends MirrorPlanEntry {
  /** Policy-datum UTxO; its tx is the Buy. */
  ref: string;
  buyTx: string;
  blockTime: number | null;
  coverage: bigint;
  expiry: bigint;
  midnightCommitment: string;
  tranche: number;
  ticket: RegistrationTicket | null;
  /** Path of a local policy key that opens the datum (never the key itself). */
  keyFile: string | null;
}

type Fetch = typeof fetch;

let retryMs = 2000;

async function koios<T>(koiosUrl: string, path: string, body: unknown, f: Fetch): Promise<T> {
  for (let i = 0; ; i++) {
    const r = await f(`${koiosUrl}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }).catch((e) => e as Error);
    if (!(r instanceof Error) && r.ok) return (await r.json()) as T;
    if (i >= 3) throw new Error(`Koios ${path}: ${r instanceof Error ? r.message : r.status}`);
    await new Promise((res) => setTimeout(res, retryMs * (i + 1)));
  }
}

/** Live policy datums at the cover script (Koios address_utxos). */
export async function previewPolicies(dep: PreviewDeployment, koiosUrl = KOIOS_PREVIEW, f: Fetch = fetch): Promise<LivePolicy[]> {
  const raw = await koios<(ChainUtxo & { inline_datum?: { bytes: string } | null })[]>(koiosUrl, "address_utxos", { _addresses: [dep.address], _extended: true }, f);
  const utxos: ChainUtxo[] = raw.map((u) => ({
    tx_hash: u.tx_hash,
    tx_index: u.tx_index,
    value: u.value,
    block_time: u.block_time ?? null,
    asset_list: (u.asset_list ?? []).map((a) => ({ policy_id: a.policy_id, asset_name: a.asset_name, quantity: a.quantity })),
    inline_datum: u.inline_datum?.bytes ? { bytes: u.inline_datum.bytes } : null,
  }));
  return readPoolState(utxos, dep.scriptHash, dep.assets, BigInt(dep.maxUtilizationBps)).policies;
}

/** Registration tickets in the given Buy txs (Koios tx_metadata), by tx hash. */
export async function buyTickets(txHashes: string[], koiosUrl = KOIOS_PREVIEW, f: Fetch = fetch): Promise<Map<string, RegistrationTicket | null>> {
  const out = new Map<string, RegistrationTicket | null>();
  for (let i = 0; i < txHashes.length; i += 50) {
    const rows = await koios<{ tx_hash: string; metadata: unknown }[]>(koiosUrl, "tx_metadata", { _tx_hashes: txHashes.slice(i, i + 50) }, f);
    for (const r of rows) out.set(r.tx_hash, parseTicket(r.metadata));
  }
  return out;
}

/** Policy key files (plutusshield/policy-key@1) in the given dirs, by policy id. Malformed files are skipped. */
export function localPolicyKeys(dirs: string[]): Map<string, { key: PolicyKey; file: string }> {
  const out = new Map<string, { key: PolicyKey; file: string }>();
  for (const dir of dirs) {
    if (!dir || !existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const file = join(dir, name);
      try {
        const key = parsePolicyKey(readFileSync(file, "utf8"));
        const id = key.policyId.toLowerCase();
        if (!out.has(id)) out.set(id, { key, file });
      } catch {
        /* not a plain policy key (encrypted backups need a passphrase; skip) */
      }
    }
  }
  return out;
}

export async function buildRelayPlan(opts: {
  deployment: PreviewDeployment;
  isMirrored: (policyId: string) => boolean | Promise<boolean>;
  keyDirs?: string[];
  koios?: string;
  fetch?: Fetch;
  /** Base backoff between Koios retries (3 retries, linear). */
  retryMs?: number;
}): Promise<RelayPlanEntry[]> {
  const f = opts.fetch ?? fetch;
  if (opts.retryMs !== undefined) retryMs = opts.retryMs;
  const policies = await previewPolicies(opts.deployment, opts.koios, f);
  const buys = [...new Set(policies.map((p) => p.ref.split("#")[0]))];
  const tickets = await buyTickets(buys, opts.koios, f);
  const keys = localPolicyKeys(opts.keyDirs ?? []);
  const out: RelayPlanEntry[] = [];
  for (const p of policies) {
    const id = p.policy.policyId.toLowerCase();
    const buyTx = p.ref.split("#")[0];
    const ticket = tickets.get(buyTx) ?? null;
    const local = keys.get(id);
    const keyOk = local ? (await checkPolicyKey({ ...local.key, coverage: p.policy.coverage.toString() }, p.policy.midnightCommitment)).ok : false;
    const e = await classifyMirror({ policyId: id, midnightCommitment: p.policy.midnightCommitment, blockTime: p.blockTime, mirrored: await opts.isMirrored(id), ticket, keyOpensDatum: keyOk });
    out.push({
      ...e,
      ref: p.ref,
      buyTx,
      blockTime: p.blockTime,
      coverage: p.policy.coverage,
      expiry: p.policy.expiry,
      midnightCommitment: p.policy.midnightCommitment,
      tranche: p.tranche,
      ticket: ticket && e.badTicket ? null : ticket,
      keyFile: keyOk ? local!.file : null,
    });
  }
  // Oldest first, so a batch relays in buy order.
  return out.sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0));
}

/** Public, secret-free view of a plan entry (what the CLI prints and the site snapshot bakes). */
export const publicEntry = (e: RelayPlanEntry) => ({
  policyId: e.policyId,
  state: e.state,
  source: e.source,
  canProve: e.canProve,
  badTicket: e.badTicket,
  buyTx: e.buyTx,
  blockTime: e.blockTime,
  tranche: e.tranche,
});
