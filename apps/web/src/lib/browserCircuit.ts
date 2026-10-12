/**
 * Browser Compact circuit prover slot for proveCover / fileClaim.
 *
 * The Lace path (hint → prove strategy → balanceUnsealed → submit) lives in
 * `@plutusshield/sdk/laceCircuits`. Building the unproven Compact call still
 * needs midnight-js + ZK configs; until that bundle ships in the Pages app,
 * `getBrowserCircuitProver()` returns null and the UI keeps the claim kit CLI
 * as the working filer while still driving Lace readiness + permission hints.
 *
 * Optional global for local/dev injection without a rebuild:
 *   window.__PLUTUSSHIELD_CIRCUIT_PROVER__ = { proveFileClaim, proveProveCover }
 */
import type { BrowserCircuitProver } from "@plutusshield/sdk/laceCircuits";

declare global {
  interface Window {
    __PLUTUSSHIELD_CIRCUIT_PROVER__?: BrowserCircuitProver | null;
  }
}

export function getBrowserCircuitProver(): BrowserCircuitProver | null {
  if (typeof window === "undefined") return null;
  const injected = window.__PLUTUSSHIELD_CIRCUIT_PROVER__;
  if (
    injected &&
    typeof injected.proveFileClaim === "function" &&
    typeof injected.proveProveCover === "function"
  ) {
    return injected;
  }
  return null;
}
