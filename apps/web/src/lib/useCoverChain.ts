"use client";

/**
 * Live Preview state for buying cover, read without Lucid: the pool UTxOs
 * (tranches + every policy datum) and the oracle feed UTxOs. Starts from the
 * build-time pool snapshot so the page always has real numbers to show.
 */
import { useCallback, useEffect, useState } from "react";
import { readPoolState, type ChainUtxo, type LivePoolState } from "@plutusshield/sdk/chain";
import type { FeedUtxo } from "@plutusshield/sdk/oracle";
import { PREVIEW, PREVIEW_ASSETS } from "@/lib/preview";
import { fetchPreviewUtxos } from "@/lib/chainRead";
import { coverScriptFrom, feedOfChainUtxo } from "@/lib/tx/cover";
import artifact from "@/data/preview-deployment.json";
import snapshot from "@/data/preview-pool-snapshot.json";

export const COVER = coverScriptFrom(artifact);
const assets = PREVIEW_ASSETS.map((a) => a.asset);
const readPool = (utxos: ChainUtxo[]) => readPoolState(utxos, PREVIEW.scriptHash, assets, PREVIEW.maxUtilizationBps);

export interface CoverChain {
  pool: LivePoolState | null;
  /** Oracle feed UTxOs; null until read (or when the read failed). */
  feeds: (FeedUtxo & { ref: string })[] | null;
  source: "live" | "snapshot";
  at: Date;
  error: string | null;
  feedError: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

function fromSnapshot(): LivePoolState | null {
  try {
    return readPool(snapshot.utxos as ChainUtxo[]);
  } catch {
    return null;
  }
}

export function useCoverChain(): CoverChain {
  const [pool, setPool] = useState<LivePoolState | null>(fromSnapshot);
  const [feeds, setFeeds] = useState<CoverChain["feeds"]>(null);
  const [source, setSource] = useState<"live" | "snapshot">("snapshot");
  const [at, setAt] = useState(() => new Date(snapshot.takenAt));
  const [error, setError] = useState<string | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    const [p, f] = await Promise.allSettled([
      fetchPreviewUtxos(PREVIEW.poolAddress, signal),
      COVER.oracleAddress ? fetchPreviewUtxos(COVER.oracleAddress, signal) : Promise.reject(new Error("no oracle address in this build")),
    ]);
    if (signal?.aborted) return;
    if (p.status === "fulfilled") {
      try {
        setPool(readPool(p.value));
        setSource("live");
        setAt(new Date());
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } else setError(p.reason instanceof Error ? p.reason.message : String(p.reason));
    if (f.status === "fulfilled") {
      setFeeds(f.value.map((u) => feedOfChainUtxo(u, COVER.params.oracle.policyId)));
      setFeedError(null);
    } else setFeedError(f.reason instanceof Error ? f.reason.message : String(f.reason));
    setLoading(false);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    const id = setTimeout(() => void load(ac.signal), 0);
    return () => (clearTimeout(id), ac.abort());
  }, [load]);

  const refresh = useCallback(() => load(), [load]);
  return { pool, feeds, source, at, error, feedError, loading, refresh };
}
