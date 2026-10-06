/**
 * Read-only Preview chain access for the static site, without loading Lucid.
 *
 * Public Koios only sends CORS headers to its own origin, so a deployed site
 * reads through Blockfrost when the build has NEXT_PUBLIC_BLOCKFROST_PREVIEW_ID
 * (a Preview-only project id; Blockfrost allows any origin). Koios stays the
 * keyless default for local runs.
 */
import { fetchBlockfrostUtxos, fetchKoiosUtxos, type ChainUtxo } from "@plutusshield/sdk/chain";
import { PREVIEW } from "@/lib/preview";

export const BLOCKFROST_ID = process.env.NEXT_PUBLIC_BLOCKFROST_PREVIEW_ID;
export const BLOCKFROST_URL = "https://cardano-preview.blockfrost.io/api/v0";
export const CHAIN_API: "blockfrost" | "koios" = BLOCKFROST_ID ? "blockfrost" : "koios";

/** UTxOs at a Preview address, via Blockfrost when configured, else Koios. */
export function fetchPreviewUtxos(address: string, signal?: AbortSignal): Promise<ChainUtxo[]> {
  return BLOCKFROST_ID
    ? fetchBlockfrostUtxos(BLOCKFROST_URL, BLOCKFROST_ID, address, fetch, signal)
    : fetchKoiosUtxos(PREVIEW.koios, address, fetch, signal);
}
