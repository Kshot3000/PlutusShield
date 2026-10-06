"use client";

import { formatUnits, networkLabel, shortAddress } from "@plutusshield/sdk/cip30";
import { useWallet } from "@/lib/wallet";
import { WalletButton } from "./WalletButton";

/** /app overview card: live CIP-30 connection state. */
export function WalletStatusCard() {
  const w = useWallet();
  const connected = w.status === "connected" && w.address;
  const wrong = connected && w.networkId !== 0;
  return (
    <div className="glass-panel relative flex items-center justify-between gap-4 rounded-[1.4rem] px-5 py-4 sm:block sm:p-6">
      <p className="font-mono-label text-[9.5px] text-text-dim">Wallet</p>
      <p className={`font-display text-2xl sm:mt-3 sm:text-3xl ${connected ? "text-text" : "text-text-muted"}`}>
        {connected ? (w.balance ? `${formatUnits(w.balance.lovelace, 6)} ₳` : "Connected") : "Not connected"}
      </p>
      <p className={`mt-1 hidden text-xs sm:block ${wrong ? "text-danger" : "text-text-dim"}`}>
        {connected
          ? wrong
            ? `${networkLabel(w.networkId ?? -1)} wallet. Switch to Preview.`
            : `${w.wallet?.name ?? "Wallet"} · ${shortAddress(w.address!.bech32)}`
          : "CIP-30 wallets (Lace, Eternl, Typhon) on Preview"}
      </p>
      {!connected && <WalletButton className="mt-0 sm:mt-4" />}
    </div>
  );
}
