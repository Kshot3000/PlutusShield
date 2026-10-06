"use client";

/**
 * Browser glue for signed Preview transactions. Lucid Evolution (and its WASM)
 * is loaded on demand, the first time someone actually builds a tx, so the
 * rest of the site stays light.
 */
import type { LucidEvolution, WalletApi } from "@lucid-evolution/lucid";
import { PREVIEW } from "@/lib/preview";
import artifact from "@/data/preview-deployment.json";
import { BLOCKFROST_ID, BLOCKFROST_URL } from "@/lib/chainRead";
import { poolScriptFrom } from "./lp";
import { coverScriptFrom } from "./cover";

export const POOL_SCRIPT = poolScriptFrom(artifact);
export const COVER_SCRIPT = coverScriptFrom(artifact);
export { CHAIN_API } from "@/lib/chainRead";

/**
 * Lucid's HTTP layer adds a W3C `traceparent` header, which neither Koios nor
 * Blockfrost lists in Access-Control-Allow-Headers, so every preflight fails.
 * Strip tracing headers from outgoing requests once, before Lucid loads.
 */
function scrubTracingHeaders() {
  const w = window as unknown as { __psFetchScrubbed?: boolean };
  if (w.__psFetchScrubbed) return;
  w.__psFetchScrubbed = true;
  const original = window.fetch.bind(window);
  const TRACE = ["traceparent", "tracestate", "b3"];
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (input instanceof Request && TRACE.some((h) => (input as Request).headers.has(h))) {
      const headers = new Headers((input as Request).headers);
      TRACE.forEach((h) => headers.delete(h));
      input = new Request(input, { headers });
    }
    if (init?.headers) {
      const headers = new Headers(init.headers);
      if (TRACE.some((h) => headers.has(h))) {
        TRACE.forEach((h) => headers.delete(h));
        init = { ...init, headers };
      }
    }
    return original(input, init);
  };
}

export async function lucidFor(api: unknown): Promise<LucidEvolution> {
  scrubTracingHeaders();
  const { Lucid, Koios, Blockfrost } = await import("@lucid-evolution/lucid");
  const provider = BLOCKFROST_ID ? new Blockfrost(BLOCKFROST_URL, BLOCKFROST_ID) : new Koios(PREVIEW.koios);
  const lucid = await Lucid(provider, "Preview");
  lucid.selectWallet.fromAPI(api as WalletApi);
  return lucid;
}

async function confirmed(hash: string, signal?: AbortSignal): Promise<boolean> {
  if (BLOCKFROST_ID) {
    const r = await fetch(`${BLOCKFROST_URL}/txs/${hash}`, { headers: { project_id: BLOCKFROST_ID }, signal });
    return r.ok;
  }
  const r = await fetch(`${PREVIEW.koios}/tx_status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ _tx_hashes: [hash] }),
    signal,
  });
  const [s] = (await r.json()) as { num_confirmations: number | null }[];
  return Boolean(s?.num_confirmations);
}

/** Poll until the tx is in a block (Lucid's Koios awaitTx trips on Koios' collateral_output shape). */
export async function waitForTx(hash: string, signal?: AbortSignal, timeoutMs = 300_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (signal?.aborted) return;
    try {
      if (await confirmed(hash, signal)) return;
    } catch {
      // transient; try again
    }
    await new Promise((res) => setTimeout(res, 4000));
  }
  throw new Error("Not confirmed yet. Check the explorer link; Preview can be slow.");
}

/** Human message for CIP-30 / Lucid failures. */
export function txError(e: unknown): string {
  const code = typeof e === "object" && e !== null && "code" in e ? (e as { code: unknown }).code : undefined;
  const info = typeof e === "object" && e !== null && "info" in e ? String((e as { info: unknown }).info) : "";
  if (code === 2 || code === -3 || /declin|reject|cancel/i.test(info)) return "You declined the signature in your wallet. Nothing was sent.";
  const msg = e instanceof Error ? e.message : info || String(e);
  if (/Transport error|Failed to fetch|NetworkError|CORS/i.test(msg))
    return "This browser couldn't reach the Cardano Preview API (it blocked the cross-site request). Nothing was signed or sent.";
  if (/InputsExhausted|insufficient|not enough/i.test(msg)) return "Your wallet doesn't hold enough for this amount plus fees and collateral.";
  if (/circuit-breaker/i.test(msg))
    return "Sales are paused: the oracle feeds don't all show a fresh healthy peg right now. Nothing was signed or sent.";
  if (/collateral/i.test(msg)) return "Your wallet needs a collateral UTxO (about 5 tADA). Set it in the wallet's settings, then try again.";
  return msg.length > 220 ? `${msg.slice(0, 220)}…` : msg;
}
