/**
 * Local signing keys for the Preview deployment.
 *
 *   .keys/deployer.sk   pays fees, consumes the seed UTxO, mints mock tUSDCx
 *   .keys/oracle.sk     signs the Preview test-oracle feed tokens
 *
 * Both are bech32 `ed25519_sk…` payment keys, generated locally and never
 * committed (.gitignore). Only the deployer address needs test ada.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CML,
  credentialToAddress,
  generatePrivateKey,
  mintingPolicyToId,
  scriptFromNative,
  type Network,
  type Script,
} from "@lucid-evolution/lucid";

export const DEPLOY_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const KEYS_DIR = process.env.PLUTUSSHIELD_KEYS_DIR ?? join(DEPLOY_DIR, ".keys");

export interface KeyInfo {
  name: string;
  privateKey: string;
  keyHash: string;
  address: string;
}

export function keyInfo(name: string, privateKey: string, network: Network): KeyInfo {
  const keyHash = CML.PrivateKey.from_bech32(privateKey).to_public().hash().to_hex();
  return { name, privateKey, keyHash, address: credentialToAddress(network, { type: "Key", hash: keyHash }) };
}

/** Load `.keys/<name>.sk`, or create it when `create` is set. */
export function loadKey(name: string, network: Network, create = false): KeyInfo {
  const file = join(KEYS_DIR, `${name}.sk`);
  if (!existsSync(file)) {
    if (!create) throw new Error(`missing ${file}; run \`pnpm keygen\` first`);
    mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(file, generatePrivateKey() + "\n", { mode: 0o600 });
    chmodSync(file, 0o600);
  }
  return keyInfo(name, readFileSync(file, "utf8").trim(), network);
}

export const hasKey = (name: string) => existsSync(join(KEYS_DIR, `${name}.sk`));

/** Single-signature native script: a Preview-only minting policy controlled by one key. */
export function sigPolicy(keyHash: string): { script: Script; policyId: string } {
  const script = scriptFromNative({ type: "sig", keyHash });
  return { script, policyId: mintingPolicyToId(script) };
}

/**
 * Keep a Buy's Midnight policy key (holder secret + coverage opening) next to
 * the signing keys: .keys/policy-keys/<policyId>.json, mode 600, never
 * committed. It is the only way to prove or claim the policy on Midnight.
 */
export function savePolicyKey(key: { policyId: string }): string {
  const dir = join(KEYS_DIR, "policy-keys");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${key.policyId}.json`);
  writeFileSync(file, `${JSON.stringify(key, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}
