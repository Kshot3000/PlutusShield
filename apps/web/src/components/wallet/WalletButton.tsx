"use client";

import { useEffect, useRef, useState } from "react";
import { balanceOf, formatUnits, networkLabel, shortAddress } from "@plutusshield/sdk/cip30";
import { PREVIEW_SCRIPT_HASH, PREVIEW_USDC_ID, RECOMMENDED_WALLETS, useWallet } from "@/lib/wallet";

export const FAUCET_URL = "https://docs.cardano.org/cardano-testnets/tools/faucet";

/** Header pill: "Connect wallet" or the connected address + ADA balance. */
export function WalletButton({ className = "", block = false }: { className?: string; block?: boolean }) {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const connected = w.status === "connected" && w.address;
  const wrongNetwork = connected && w.networkId !== 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={`inline-flex items-center justify-center gap-2 rounded-full border font-medium transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          block ? "h-12 w-full px-6 text-[15px]" : "h-9 px-3.5 text-[13px]"
        } ${
          wrongNetwork
            ? "border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-text"
            : "border-[var(--hairline)] bg-white/[0.035] text-text hover:border-white/15 hover:bg-white/[0.07]"
        } ${className}`}
      >
        {connected ? (
          <>
            <span className={`h-1.5 w-1.5 rounded-full ${wrongNetwork ? "bg-danger" : "bg-success"}`} aria-hidden="true" />
            {w.wallet?.icon && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={w.wallet.icon} alt="" width={16} height={16} className="h-4 w-4 rounded" />
            )}
            <span className="font-mono text-[12px]">{shortAddress(w.address!.bech32, 9, 4)}</span>
            {w.balance && (
              <span className="hidden text-text-muted sm:inline">{formatUnits(w.balance.lovelace, 6, 0)} ₳</span>
            )}
            <span className="sr-only">{wrongNetwork ? ", wrong network" : ", wallet connected"}</span>
          </>
        ) : w.status === "connecting" ? (
          <>
            <Spinner /> Connecting…
          </>
        ) : (
          <>
            <WalletIcon /> Connect wallet
          </>
        )}
      </button>
      <WalletDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function WalletDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const w = useWallet();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const connected = w.status === "connected" && w.address;
  const testnet = w.networkId === 0;

  const copy = async () => {
    if (!w.address) return;
    try {
      await navigator.clipboard.writeText(w.address.bech32);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the address is selectable text anyway */
    }
  };

  const rows: { label: string; value: string; hint?: string }[] = [];
  if (connected && w.balance) {
    rows.push({ label: testnet ? "Test ADA" : "ADA", value: formatUnits(w.balance.lovelace, 6) });
    if (PREVIEW_USDC_ID)
      rows.push({ label: "tUSDCx", value: formatUnits(balanceOf(w.balance, PREVIEW_USDC_ID), 6), hint: "Preview mock USDC" });
    if (PREVIEW_SCRIPT_HASH) {
      rows.push({ label: "LP shares · ADA", value: balanceOf(w.balance, `${PREVIEW_SCRIPT_HASH}.6c7000`).toString() });
      rows.push({ label: "LP shares · USDC", value: balanceOf(w.balance, `${PREVIEW_SCRIPT_HASH}.6c7001`).toString() });
    }
    const n = w.balance.assets.size;
    rows.push({ label: "Native tokens", value: n.toString(), hint: n === 1 ? "asset" : "assets" });
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="wallet-title"
      className="m-auto w-[min(440px,calc(100vw-1.5rem))] rounded-[1.6rem] border border-[var(--hairline)] bg-bg-elevated p-0 text-text shadow-[0_40px_120px_-30px_rgba(0,0,0,0.95)] backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <div className="relative p-6 sm:p-7">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-text-muted hover:bg-white/[0.06] hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>

        <p className="font-mono-label text-[9.5px] text-text-dim">Cardano · CIP-30</p>
        <h2 id="wallet-title" className="mt-2 font-display text-[1.9rem] leading-tight">
          {connected ? (w.wallet?.name ?? "Wallet") : "Connect a wallet"}
        </h2>

        {!connected && (
          <>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">
              PlutusShield is in preview on the Cardano Preview testnet. Set your wallet to Preview before you connect.
            </p>
            <div className="mt-5 space-y-2">
              {w.wallets.map((wl) => (
                <button
                  key={wl.key}
                  type="button"
                  disabled={w.status === "connecting"}
                  onClick={() => void w.connect(wl.key)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-[var(--hairline)] bg-white/[0.02] px-4 py-3 text-left text-sm transition-colors hover:border-[color-mix(in_srgb,var(--accent)_45%,transparent)] hover:bg-[var(--accent-glow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
                >
                  {wl.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={wl.icon} alt="" width={28} height={28} className="h-7 w-7 rounded-lg" />
                  ) : (
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.06]" aria-hidden="true">
                      <WalletIcon />
                    </span>
                  )}
                  <span className="flex-1 font-medium">{wl.name}</span>
                  <span className="font-mono-label text-[9px] text-text-dim">Detected</span>
                </button>
              ))}
              {w.detected && w.wallets.length === 0 && (
                <div className="rounded-2xl border border-[var(--hairline)] bg-white/[0.02] p-4">
                  <p className="text-sm text-text">No Cardano wallet found in this browser.</p>
                  <p className="mt-1 text-xs text-text-muted">Install one of these, switch it to Preview, then reload.</p>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {RECOMMENDED_WALLETS.map((r) => (
                      <li key={r.key}>
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-8 items-center rounded-full border border-[var(--hairline)] px-3 text-xs text-text hover:bg-white/[0.06]"
                        >
                          {r.name} <span aria-hidden="true">&nbsp;↗</span>
                          <span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!w.detected && w.wallets.length === 0 && (
                <p className="flex items-center gap-2 text-xs text-text-dim">
                  <Spinner /> Looking for wallets…
                </p>
              )}
            </div>
          </>
        )}

        {connected && (
          <>
            {!testnet && (
              <div
                role="alert"
                className="mt-4 rounded-2xl border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] p-3.5 text-xs leading-relaxed text-text-muted"
              >
                <span className="font-medium text-danger">Wrong network: {networkLabel(w.networkId ?? -1)}.</span> This
                build only works on the Cardano Preview testnet. Switch your wallet to Preview. PlutusShield never asks
                for mainnet funds during the preview.
              </div>
            )}
            <div className="mt-4 rounded-2xl border border-[var(--hairline)] bg-white/[0.02] p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono-label text-[9px] text-text-dim">
                  {testnet ? "Testnet" : networkLabel(w.networkId ?? -1)} · {w.address!.kind} address
                </p>
                <button
                  type="button"
                  onClick={() => void copy()}
                  className="rounded-full px-2.5 py-1 text-[11px] text-text-muted hover:bg-white/[0.06] hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="mt-2 select-all break-all font-mono text-[11.5px] leading-relaxed text-text">
                {w.address!.bech32}
              </p>
              <span className="sr-only" aria-live="polite">
                {copied ? "Address copied" : ""}
              </span>
            </div>
            <dl className="mt-3 divide-y divide-[var(--hairline)] rounded-2xl border border-[var(--hairline)] bg-white/[0.02]">
              {rows.map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                  <dt className="text-xs text-text-muted">{r.label}</dt>
                  <dd className="text-right font-mono text-sm text-text">
                    {r.value}
                    {r.hint && <span className="ml-1.5 font-sans text-[10.5px] text-text-dim">{r.hint}</span>}
                  </dd>
                </div>
              ))}
            </dl>
            {testnet && w.balance && w.balance.lovelace < 10_000_000n && (
              <p className="mt-3 text-xs text-text-muted">
                Low on test ADA?{" "}
                <a
                  href={FAUCET_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline-offset-2 hover:underline"
                >
                  Use the Cardano testnet faucet<span className="sr-only"> (opens in a new tab)</span>
                </a>{" "}
                and pick Preview.
              </p>
            )}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => void w.refresh()}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-full border border-[var(--hairline)] bg-white/[0.035] text-sm hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={() => {
                  w.disconnect();
                  onClose();
                }}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-full text-sm text-text-muted hover:bg-white/[0.04] hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Disconnect
              </button>
            </div>
          </>
        )}

        {w.error && (
          <p role="alert" className="mt-4 text-xs text-danger">
            {w.error}
          </p>
        )}

        <p className="mt-5 border-t border-[var(--hairline)] pt-4 text-[11px] leading-relaxed text-text-dim">
          Connecting is read-only: PlutusShield reads your network, address, and balance, and never sees your keys.
          Buying cover, depositing or withdrawing, and filing or releasing a claim are live on Preview — each one
          builds a testnet transaction and asks your wallet to sign it, so check the prompt before you approve.
          Wallets report every testnet the same way, so Preview and Preprod look identical here.
        </p>
      </div>
    </dialog>
  );
}

function WalletIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <rect x="3" y="6" width="18" height="13" rx="3" />
      <path d="M16 12.5h2M3 9h15a3 3 0 013 3" strokeLinecap="round" />
    </svg>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden="true"
    />
  );
}
