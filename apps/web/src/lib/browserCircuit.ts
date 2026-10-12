/**
 * Browser Compact circuit prover slot for proveCover / fileClaim.
 *
 * The Lace path (hint → prove strategy → balanceUnsealed → submit) lives in
 * `@plutusshield/sdk/laceCircuits`. Building the unproven Compact call still
 * needs midnight-js + ZK configs; until that runtime is injected,
 * `getBrowserCircuitProver()` returns null and the UI keeps the claim kit CLI
 * as the working filer while still driving Lace readiness + ZK asset probes.
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
 * midnight-js runtime adapter (null when unavailable).
 */
export function getBrowserCircuitProver(
  options?: { midnightRuntime?: MidnightJsProveRuntime | null },
): BrowserCircuitProver | null {
  if (isProver(registeredProver)) return registeredProver;
  if (typeof window !== "undefined") {
    const injected = window.__PLUTUSSHIELD_CIRCUIT_PROVER__;
    if (isProver(injected)) return injected;
  }
  return tryCreateMidnightJsProver({ runtime: options?.midnightRuntime ?? null });
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

export type { MidnightJsProveRuntime, ProbeZkAssetsResult };
