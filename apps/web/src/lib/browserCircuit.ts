/**
 * Browser Compact circuit prover slot for proveCover / fileClaim.
 *
 * The Lace path (hint → prove strategy → balanceUnsealed → submit) lives in
 * `@plutusshield/sdk/laceCircuits`. Building + proving the Compact call needs
 * midnight-js + ZK configs, so the default prover is the holder's local prove
 * bridge (`pnpm midnight:prove-bridge`, `@plutusshield/sdk/proveBridge`). With no
 * bridge and nothing injected, `getBrowserCircuitProver()` returns null and the
 * UI keeps the claim kit CLI as the filer while still driving Lace readiness.
 *
 * Optional global for local/dev injection without a rebuild:
 *   window.__PLUTUSSHIELD_CIRCUIT_PROVER__ = { proveFileClaim, proveProveCover }
 *
 * Prefer `registerBrowserCircuitProver(prover)` or
 * `tryCreateMidnightJsProver({ runtime })` when a midnight-js adapter is available.
 */
import type { BrowserCircuitProver } from "@plutusshield/sdk/laceCircuits";
import {
  DEFAULT_ZK_ASSET_BASE,
  DEFAULT_ZK_CIRCUIT_IDS,
  probeZkAssets,
  type ProbeZkAssetsResult,
} from "@plutusshield/sdk/fetchZkConfig";
import {
  DEFAULT_PROVE_BRIDGE_URI,
  createProveBridgeProver,
  probeProveBridge,
  shieldedKeysFromLace,
  type ProveBridgeHealth,
  type ProveBridgeResult,
} from "@plutusshield/sdk/proveBridge";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { tryCreateMidnightJsProver, type MidnightJsProveRuntime } from "./midnightJsProver";

declare global {
  interface Window {
    __PLUTUSSHIELD_CIRCUIT_PROVER__?: BrowserCircuitProver | null;
  }
}

let registeredProver: BrowserCircuitProver | null = null;

/** Register a BrowserCircuitProver for this page session (also sets the window global). */
export function registerBrowserCircuitProver(prover: BrowserCircuitProver | null): void {
  registeredProver = prover;
  if (typeof window !== "undefined") {
    window.__PLUTUSSHIELD_CIRCUIT_PROVER__ = prover;
  }
}

function isProver(value: unknown): value is BrowserCircuitProver {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as BrowserCircuitProver).proveFileClaim === "function" &&
    typeof (value as BrowserCircuitProver).proveProveCover === "function"
  );
}

/**
 * Resolve the browser Compact prover. Order: registered → window injection →
 * midnight-js runtime adapter → the holder's local prove bridge (when a
 * healthy bridge was probed and Lace is connected) → null.
 */
export function getBrowserCircuitProver(
  options?: {
    midnightRuntime?: MidnightJsProveRuntime | null;
    bridge?: {
      health: ProveBridgeHealth | null;
      api: Pick<ConnectedAPI, "getShieldedAddresses"> | null;
      onProved?: (circuit: "fileClaim" | "proveCover", r: ProveBridgeResult) => void;
    };
  },
): BrowserCircuitProver | null {
  if (isProver(registeredProver)) return registeredProver;
  if (typeof window !== "undefined") {
    const injected = window.__PLUTUSSHIELD_CIRCUIT_PROVER__;
    if (isProver(injected)) return injected;
  }
  const runtime = tryCreateMidnightJsProver({ runtime: options?.midnightRuntime ?? null });
  if (runtime) return runtime;
  const b = options?.bridge;
  if (b?.health?.ok && b.api) {
    const api = b.api;
    return createProveBridgeProver({
      uri: b.health.uri,
      getShieldedKeys: () => shieldedKeysFromLace(api),
      onProved: b.onProved,
    });
  }
  return null;
}

/** Bridge URI: NEXT_PUBLIC_PROVE_BRIDGE_URI or the loopback default. */
export function proveBridgeUri(): string {
  return (process.env.NEXT_PUBLIC_PROVE_BRIDGE_URI ?? "").trim() || DEFAULT_PROVE_BRIDGE_URI;
}

/** Probe the holder's local prove bridge. Never throws. */
export function probeLocalProveBridge(fetchImpl: typeof fetch = fetch): Promise<ProveBridgeHealth> {
  return probeProveBridge(proveBridgeUri(), fetchImpl);
}

/** Public URL for Preprod v2 ZK assets, respecting NEXT_PUBLIC_BASE_PATH. */
export function defaultZkAssetBaseUrl(): string {
  const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
  const rel = DEFAULT_ZK_ASSET_BASE.replace(/^\//, "");
  return `${basePath}/${rel}`;
}

/**
 * Probe verifier + zkir for fileClaim / proveCover under the Pages public tree.
 * Prover keys are optional (local/dev only). Never throws.
 */
export async function probeDefaultZkAssets(
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeZkAssetsResult> {
  return probeZkAssets(defaultZkAssetBaseUrl(), DEFAULT_ZK_CIRCUIT_IDS, fetchImpl);
}

export type { MidnightJsProveRuntime, ProbeZkAssetsResult, ProveBridgeHealth };
