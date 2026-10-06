"use client";

import Link from "next/link";
import { useCoverChain } from "@/lib/useCoverChain";
import { useWallet } from "@/lib/wallet";
import { useMyPolicies } from "./MyPolicies";

/** /app overview card: how many live policies the connected wallet holds on Preview. */
export function PoliciesCard() {
  const w = useWallet();
  const chain = useCoverChain();
  const { policies } = useMyPolicies(chain);
  const live = policies?.filter((p) => p.status === "waiting" || p.status === "active" || p.status === "claimable");
  const connected = w.status === "connected";
  return (
    <Link
      href="/cover#my-policies"
      className="glass-panel relative flex items-center justify-between gap-4 rounded-[1.4rem] px-5 py-4 transition-colors hover:border-[color-mix(in_srgb,var(--accent)_35%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:block sm:p-6"
    >
      <p className="font-mono-label text-[9.5px] text-text-dim">Active policies</p>
      <p className={`font-display text-2xl sm:mt-3 sm:text-3xl ${live?.length ? "text-text" : "text-text-muted"}`}>
        {connected ? (live ? live.length : "…") : "—"}
      </p>
      <p className="mt-1 hidden text-xs text-text-dim sm:block">
        {connected ? "On Cardano Preview · view in My policies →" : "Connect a wallet to see your cover"}
      </p>
    </Link>
  );
}
