/**
 * Holder prove bridge client — the BrowserCircuitProver behind "File with Lace".
 *
 * Lace balances + submits a proven, unsealed Midnight tx but cannot build a
 * Compact call. `contracts/midnight/preprod/prove-bridge.mjs` runs on the
 * holder's machine (loopback only, next to their proof server) and does that
 * one step with midnight-js: createUnprovenCallTx against the live Preprod v2
 * registry with the holder's private state as witnesses, then proveTx. This
 * module is the browser half: probe the bridge, serialize the holder private
 * state to JSON-safe hex/decimal strings, read Lace's shielded coin/enc keys,
 * and expose it all as a `BrowserCircuitProver` so `runBrowserFileClaim` /
 * `runBrowserProveCover` can hand the result to Lace.
 *
 * Pure fetch + types — no midnight-js in the browser bundle.
 */
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import type {
  BrowserCircuitProver,
  FileClaimCall,
  ProveCoverCall,
  ProvingStrategy,
} from "./laceCircuits.ts";

/** Default loopback address of `prove-bridge.mjs`. */
export const DEFAULT_PROVE_BRIDGE_URI = "http://127.0.0.1:6310";

const HEX32 = /^[0-9a-f]{64}$/;

export class ProveBridgeError extends Error {
  readonly status: number | null;
  /** True when the circuit itself rejected the call (wrong key, policy not ACTIVE, coverage too low). */
  readonly circuitRejected: boolean;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ProveBridgeError";
    this.status = status;
    this.circuitRejected = status === 422;
  }
}

export type ProveBridgeHealth = {
  ok: boolean;
  uri: string;
  contractAddress: string | null;
  circuits: string[];
  proofServer: string | null;
  detail: string;
};

/** GET {uri}/health. Never throws. */
export async function probeProveBridge(
  uri: string = DEFAULT_PROVE_BRIDGE_URI,
  fetchImpl: typeof fetch = fetch,
): Promise<ProveBridgeHealth> {
  const base = uri.replace(/\/$/, "");
  const empty = { uri: base, contractAddress: null, circuits: [], proofServer: null };
  try {
    const res = await fetchImpl(`${base}/health`, { method: "GET", mode: "cors" });
    if (!res.ok) return { ok: false, ...empty, detail: `HTTP ${res.status} from ${base}/health` };
    const body = (await res.json()) as Record<string, unknown>;
    if (body?.service !== "plutusshield-prove-bridge" || body?.ok !== true) {
      return { ok: false, ...empty, detail: `${base} is not a PlutusShield prove bridge` };
    }
    const circuits = Array.isArray(body.circuits) ? body.circuits.map(String) : [];
    return {
      ok: circuits.includes("fileClaim") && circuits.includes("proveCover"),
      uri: base,
      contractAddress: typeof body.contractAddress === "string" ? body.contractAddress : null,
      circuits,
      proofServer: typeof body.proofServer === "string" ? body.proofServer : null,
      detail: `Prove bridge healthy at ${base}`,
    };
  } catch (e) {
    return {
      ok: false,
      ...empty,
      detail: `No prove bridge at ${base} (${e instanceof Error ? e.message : String(e)}) — run pnpm midnight:prove-bridge`,
    };
  }
}

type AnyBytes = Uint8Array | string;
type HolderStateLike = {
  sk: AnyBytes;
  openings: Record<string, { amount: bigint | number | string; salt: AnyBytes }>;
};

function toHex32(v: AnyBytes, what: string): string {
  const h =
    typeof v === "string"
      ? v.trim().toLowerCase().replace(/^0x/, "")
      : Array.from(v, (b) => b.toString(16).padStart(2, "0")).join("");
  if (!HEX32.test(h)) throw new ProveBridgeError(`${what} must be 32 bytes`);
  return h;
}

/** JSON-safe holder private state (hex secret, decimal amounts, hex salts) for the bridge. */
export function serializeHolderPrivateState(ps: HolderStateLike): {
  sk: string;
  openings: Record<string, { amount: string; salt: string }>;
} {
  const openings: Record<string, { amount: string; salt: string }> = {};
  for (const [id, o] of Object.entries(ps.openings ?? {})) {
    const amount = typeof o.amount === "bigint" ? o.amount.toString() : String(o.amount);
    if (!/^\d+$/.test(amount)) throw new ProveBridgeError(`opening ${id.slice(0, 16)}… amount must be a non-negative integer`);
    openings[toHex32(id, "policy id")] = { amount, salt: toHex32(o.salt, "coverage salt") };
  }
  return { sk: toHex32(ps.sk, "holder secret"), openings };
}

export type ShieldedKeys = { coinPublicKey: string; encryptionPublicKey: string };

/** Lace's shielded coin + encryption public keys (bech32m; the bridge decodes them). */
export async function shieldedKeysFromLace(
  api: Pick<ConnectedAPI, "getShieldedAddresses">,
): Promise<ShieldedKeys> {
  const s = await api.getShieldedAddresses();
  if (!s?.shieldedCoinPublicKey || !s?.shieldedEncryptionPublicKey) {
    throw new ProveBridgeError("Lace did not return shielded coin/encryption public keys");
  }
  return { coinPublicKey: s.shieldedCoinPublicKey, encryptionPublicKey: s.shieldedEncryptionPublicKey };
}

export type ProveBridgeResult = { unsealedTx: string; bytes: number; provedMs: number };

export type CreateProveBridgeProverOptions = {
  uri?: string;
  getShieldedKeys: () => Promise<ShieldedKeys>;
  fetchImpl?: typeof fetch;
  /** Called after each successful proof (UI: show size + time). */
  onProved?: (circuit: "fileClaim" | "proveCover", r: ProveBridgeResult) => void;
};

/** Build the request body the bridge's POST /prove expects. */
export function proveBridgeRequest(call: FileClaimCall | ProveCoverCall, keys: ShieldedKeys) {
  const base = {
    circuit: call.circuit,
    policyId: call.policyId,
    contractAddress: call.contractAddress,
    privateState: serializeHolderPrivateState(call.privateState as unknown as HolderStateLike),
    coinPublicKey: keys.coinPublicKey,
    encryptionPublicKey: keys.encryptionPublicKey,
  };
  return call.circuit === "fileClaim"
    ? { ...base, evidenceCommitment: (call as FileClaimCall).evidenceCommitment }
    : { ...base, minCoverage: (call as ProveCoverCall).minCoverage };
}

/** A BrowserCircuitProver that proves through the holder's local prove bridge. */
export function createProveBridgeProver(opts: CreateProveBridgeProverOptions): BrowserCircuitProver {
  const base = (opts.uri ?? DEFAULT_PROVE_BRIDGE_URI).replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const prove = async (call: FileClaimCall | ProveCoverCall, _ctx: { proving: ProvingStrategy }) => {
    const keys = await opts.getShieldedKeys();
    let res: Response;
    try {
      res = await fetchImpl(`${base}/prove`, {
        method: "POST",
        mode: "cors",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(proveBridgeRequest(call, keys)),
      });
    } catch (e) {
      throw new ProveBridgeError(`Prove bridge unreachable at ${base}: ${e instanceof Error ? e.message : String(e)}`);
    }
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      /* non-JSON */
    }
    if (!res.ok || body.ok !== true) {
      throw new ProveBridgeError(String(body.error ?? `Prove bridge HTTP ${res.status}`), res.status);
    }
    const unsealedTx = String(body.unsealedTx ?? "");
    if (!/^[0-9a-f]+$/i.test(unsealedTx) || unsealedTx.length < 64) {
      throw new ProveBridgeError("Prove bridge returned no unsealed transaction");
    }
    const r = { unsealedTx, bytes: Number(body.bytes ?? unsealedTx.length / 2), provedMs: Number(body.provedMs ?? 0) };
    opts.onProved?.(call.circuit, r);
    return { unsealedTx };
  };
  return {
    proveFileClaim: (call, ctx) => prove(call, ctx),
    proveProveCover: (call, ctx) => prove(call, ctx),
  };
}
