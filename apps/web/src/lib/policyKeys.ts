"use client";

/**
 * This browser's Midnight policy keys (holder secret + coverage opening per
 * policy), in localStorage, keyed by the 32-byte policy id. The Buy flow saves
 * a key before asking the wallet to sign, so a crash or closed tab between
 * signing and confirmation can't lose it, then stamps it with the tx hash.
 *
 * localStorage is per browser profile and per origin, and clearing site data
 * deletes it: the downloadable backup (plain or passphrase-encrypted) is the
 * copy that matters. Nothing here leaves the device.
 */
import { useSyncExternalStore } from "react";
import {
  checkPolicyKey,
  encryptPolicyKey,
  parsePolicyKey,
  policyKeyFileName,
  policyKeyFileText,
  readPolicyKeyFile,
  type PolicyKey,
} from "@plutusshield/sdk/midnight";

const STORE = "plutusshield:policy-keys:v1";
const EVENT = "plutusshield:policy-keys";

type Store = Record<string, PolicyKey>;

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORE);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Store = {};
    for (const [id, v] of Object.entries(parsed)) {
      try {
        out[id] = parsePolicyKey(v);
      } catch {
        /* skip a corrupt entry rather than lose the rest */
      }
    }
    return out;
  } catch {
    return {};
  }
}

let cache: { raw: string | null; store: Store } = { raw: null, store: {} };
function snapshot(): Store {
  if (typeof window === "undefined") return cache.store;
  const raw = window.localStorage.getItem(STORE);
  if (raw !== cache.raw) cache = { raw, store: read() };
  return cache.store;
}

function write(store: Store) {
  window.localStorage.setItem(STORE, JSON.stringify(store));
  window.dispatchEvent(new Event(EVENT));
}

/** Save (or update) a key. Throws if storage is unavailable (private mode, quota). */
export function savePolicyKey(key: PolicyKey) {
  const store = { ...read(), [key.policyId]: key };
  write(store);
}

export const getPolicyKey = (policyId: string): PolicyKey | undefined => snapshot()[policyId.toLowerCase()];

function subscribe(cb: () => void) {
  const on = (e: Event) => (e.type === EVENT || (e as StorageEvent).key === STORE || (e as StorageEvent).key === null) && cb();
  window.addEventListener(EVENT, on);
  window.addEventListener("storage", on);
  return () => {
    window.removeEventListener(EVENT, on);
    window.removeEventListener("storage", on);
  };
}

const EMPTY: Store = {};
/** Live view of the stored keys (re-renders on save, import, and changes from other tabs). */
export function usePolicyKeys(): Store {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

export function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Download a key backup: plain JSON, or encrypted under a passphrase when one is given. */
export async function exportPolicyKey(key: PolicyKey, passphrase?: string) {
  if (passphrase) downloadText(policyKeyFileName(key.policyId, true), policyKeyFileText(await encryptPolicyKey(key, passphrase)));
  else downloadText(policyKeyFileName(key.policyId), policyKeyFileText(key));
}

export type KeyState = "verified" | "mismatch" | "missing";

/** Verified = the stored key re-derives the datum's midnight_commitment. */
export async function keyState(key: PolicyKey | undefined, datumCommitment: string): Promise<KeyState> {
  if (!key) return "missing";
  return (await checkPolicyKey(key, datumCommitment)).ok ? "verified" : "mismatch";
}

/**
 * Restore a backup for one policy: decrypt if needed, check it opens the
 * policy's on-chain commitment, then store it. Returns the stored key.
 */
export async function importPolicyKey(text: string, expect: { policyId: string; midnightCommitment: string }, passphrase?: string) {
  const key = await readPolicyKeyFile(text, passphrase);
  if (key.policyId !== expect.policyId.toLowerCase()) throw new Error("This backup is for a different policy.");
  const c = await checkPolicyKey(key, expect.midnightCommitment);
  if (!c.ok) throw new Error(c.reason ?? "This key doesn't open the policy's Midnight commitment.");
  savePolicyKey(key);
  return key;
}
