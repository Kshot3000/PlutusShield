"use client";

/**
 * /app overview card: the connected wallet's LP shares in each Preview pool
 * tranche (lp00 ADA, lp01 USDC) and what they redeem for right now, using the
 * same `shareValue` floor the validator applies on Withdraw. Pool state is read
 * live (Blockfrost or Koios) with the build-time snapshot as a fallback.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { readPoolState, type ChainUtxo, type LivePoolState } from "@plutusshield/sdk/chain";
import { lpTokenName } from "@plutusshield/sdk/cardano";
import { balanceOf, formatUnits } from "@plutusshield/sdk/cip30";
import { shareValue } from "@plutusshield/sdk/pool";
import { fetchPreviewUtxos } from "@/lib/chainRead";
import { PREVIEW, PREVIEW_ASSETS } from "@/lib/preview";
import { useWallet } from "@/lib/wallet";
import snapshot from "@/data/preview-pool-snapshot.json";

const assets = PREVIEW_ASSETS.map((a) => a.asset);
const read = (utxos: ChainUtxo[]) => readPoolState(utxos, PREVIEW.scriptHash, assets, PREVIEW.maxUtilizationBps);

function fromSnapshot(): LivePoolState | null {
  try {
    return read(snapshot.utxos as ChainUtxo[]);
  } catch {
    return null;
  }
}

export interface LpPosition {
  index: number;
  lpToken: string;
  ticker: string;
  shares: bigint;
  /** Base units the shares redeem for today (before the capital lock). */
  value: bigint;
}

/** The wallet's LP positions given its balance and the pool state; tranches with no shares are dropped. */
export function lpPositions(state: LivePoolState | null, held: (unit: string) => bigint): LpPosition[] {
  return PREVIEW_ASSETS.flatMap((a, index) => {
    const shares = held(`${PREVIEW.scriptHash}.${lpTokenName(index)}`);
    if (shares <= 0n) return [];
    const t = state?.tranches.find((x) => x.index === index);
    const value = t ? shareValue({ capital: t.capital, totalShares: t.totalShares, activeCover: t.activeCover }, shares) : 0n;
    return [{ index, lpToken: a.lpToken, ticker: a.ticker, shares, value }];
  });
}

export function LpPositionsCard() {
  const w = useWallet();
  const connected = w.status === "connected";
  const [state, setState] = useState<LivePoolState | null>(fromSnapshot);

  useEffect(() => {
    if (!connected) return;
    const ac = new AbortController();
    fetchPreviewUtxos(PREVIEW.poolAddress, ac.signal)
      .then((u) => setState(read(u)))
      .catch(() => {
        /* keep the snapshot */
      });
    return () => ac.abort();
  }, [connected]);

  const positions = useMemo(
    () => (w.balance ? lpPositions(state, (unit) => balanceOf(w.balance!, unit)) : null),
    [w.balance, state],
  );

  const hint = !connected
    ? "Connect a wallet to see your lp00 (ADA) and lp01 (USDC) shares"
    : !positions
      ? "Reading your wallet…"
      : positions.length === 0
        ? "No shares yet · underwrite on the Pool page →"
        : `${positions.map((p) => `${formatUnits(p.value, 6, 2)} ${p.ticker}`).join(" · ")} redeemable · manage →`;

  return (
    <Link
      href="/pool"
      className="glass-panel relative flex items-center justify-between gap-4 rounded-[1.4rem] px-5 py-4 transition-colors hover:border-[color-mix(in_srgb,var(--accent)_35%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:block sm:p-6"
    >
      <p className="font-mono-label text-[9.5px] text-text-dim">LP positions</p>
      <p className={`font-display text-2xl sm:mt-3 sm:text-3xl ${positions?.length ? "text-text" : "text-text-muted"}`}>
        {connected ? (positions ? positions.length : "…") : "—"}
      </p>
      <p className="mt-1 hidden text-xs text-text-dim sm:block">{hint}</p>
    </Link>
  );
}
