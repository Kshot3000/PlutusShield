/**
 * Injectable midnight-js Compact prove adapter for the browser.
 *
 * The static Pages export must not pull heavy midnight-js deps. Pass a
 * `MidnightJsProveRuntime` (loaded from a local bundle / dynamic import in
 * future) to get a real `BrowserCircuitProver`; otherwise returns null.
 */
import type {
  BrowserCircuitProver,
  FileClaimCall,
  ProveCoverCall,
  ProvingStrategy,
} from "@plutusshield/sdk/laceCircuits";

export type MidnightJsProveRuntime = {
  proveFileClaim(
    call: FileClaimCall,
    ctx: { proving: ProvingStrategy },
  ): Promise<{ unsealedTx: string }>;
  proveProveCover(
    call: ProveCoverCall,
    ctx: { proving: ProvingStrategy },
  ): Promise<{ unsealedTx: string }>;
};

export type TryCreateMidnightJsProverOptions = {
  runtime?: MidnightJsProveRuntime | null;
};

/**
 * Wrap an injected midnight-js prove runtime as BrowserCircuitProver.
 * Returns null when no runtime is available (default on Pages).
 */
export function tryCreateMidnightJsProver(
  options: TryCreateMidnightJsProverOptions = {},
): BrowserCircuitProver | null {
  const runtime = options.runtime ?? null;
  if (
    !runtime ||
    typeof runtime.proveFileClaim !== "function" ||
    typeof runtime.proveProveCover !== "function"
  ) {
    return null;
  }
  return {
    proveFileClaim: (call, ctx) => runtime.proveFileClaim(call, ctx),
    proveProveCover: (call, ctx) => runtime.proveProveCover(call, ctx),
  };
}

/**
 * Dev stub that implements BrowserCircuitProver but rejects with a clear
 * message — useful to exercise Lace balance/submit wiring without real proofs.
 */
export function createFetchBackedProverStub(message =
  "Compact prove stub: inject midnight-js runtime or window.__PLUTUSSHIELD_CIRCUIT_PROVER__",
): BrowserCircuitProver {
  const reject = async (): Promise<{ unsealedTx: string }> => {
    throw new Error(message);
  };
  return {
    proveFileClaim: reject,
    proveProveCover: reject,
  };
}
