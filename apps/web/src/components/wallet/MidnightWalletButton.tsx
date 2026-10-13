"use client";

import { useEffect, useRef, useState } from "react";
import {
  LACE_MIDNIGHT_INSTALL_URL,
  formatMidnightAddress,
  useMidnightWallet,
} from "@/lib/midnightWallet";

/** Header / panel pill for Lace Midnight (Preprod). */
export function MidnightWalletButton({ className = "", block = false }: { className?: string; block?: boolean }) {
  const w = useMidnightWallet();
  const [open, setOpen] = useState(false);
  const connected = w.status === "connected" && (w.unshieldedAddress || w.shieldedAddress);
  const wrongNetwork = connected && w.networkId && w.networkId !== "preprod";
  const display = w.unshieldedAddress || w.shieldedAddress || null;

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
            : "border-[color-mix(in_srgb,var(--midnight)_40%,transparent)] bg-[color-mix(in_srgb,var(--midnight)_8%,transparent)] text-text hover:border-[color-mix(in_srgb,var(--midnight)_55%,transparent)] hover:bg-[color-mix(in_srgb,var(--midnight)_14%,transparent)]"
        } ${className}`}
      >
        {connected ? (
          <>
            <span className={`h-1.5 w-1.5 rounded-full ${wrongNetwork ? "bg-danger" : "bg-midnight"}`} aria-hidden="true" />
            {w.wallet?.icon && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={w.wallet.icon} alt="" width={16} height={16} className="h-4 w-4 rounded" />
            )}
            <span className="font-mono text-[12px]">{formatMidnightAddress(display, { head: 8, tail: 4 })}</span>
            <span className="hidden text-text-muted sm:inline">Midnight</span>
            <span className="sr-only">{wrongNetwork ? ", wrong Midnight network" : ", Midnight wallet connected"}</span>
          </>
        ) : w.status === "connecting" ? (
          <>
            <Spinner /> Connecting Midnight…
          </>
        ) : (
          <>
            <MidnightIcon /> Connect Midnight
          </>
        )}
      </button>
      <MidnightWalletDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function MidnightWalletDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const w = useMidnightWallet();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const connected = w.status === "connected";
  const display = w.unshieldedAddress || w.shieldedAddress || null;
  const onPreprod = w.networkId === "preprod";

  const copy = async () => {
    if (!display) return;
    try {
      await navigator.clipboard.writeText(display);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="midnight-wallet-title"
      className="m-auto w-[min(460px,calc(100vw-1.5rem))] rounded-[1.6rem] border border-[var(--hairline)] bg-bg-elevated p-0 text-text shadow-[0_40px_120px_-30px_rgba(0,0,0,0.95)] backdrop:bg-black/60 backdrop:backdrop-blur-sm"
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

        <p className="font-mono-label text-[9.5px] text-text-dim">Midnight · DApp Connector 4.0.1 · Preprod</p>
        <h2 id="midnight-wallet-title" className="mt-2 font-display text-[1.9rem] leading-tight">
          {connected ? (w.wallet?.name ?? "Midnight wallet") : "Connect Lace Midnight"}
        </h2>

        {!connected && (
          <>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">
              Connect Lace&apos;s Midnight edition on Preprod. This reads your address and service URIs, and{" "}
              <span className="font-mono text-[12px]">/claim/evidence</span> drives the Lace circuit-submit path for{" "}
              <span className="text-text">proveCover</span> / <span className="text-text">fileClaim</span> (hints,
              proving strategy, balance + submit). Compact prove uses the local holder prove bridge; until the first
              finalized File-with-Lace drill tx, use the holder claim kit on that page.
            </p>
            <div className="mt-5 space-y-2">
              {w.providers.map((p) => (
                <button
                  key={p.injectionKey}
                  type="button"
                  disabled={w.status === "connecting"}
                  onClick={() => void w.connect(p.injectionKey)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-[var(--hairline)] bg-white/[0.02] px-4 py-3 text-left text-sm transition-colors hover:border-[color-mix(in_srgb,var(--midnight)_45%,transparent)] hover:bg-[var(--midnight-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
                >
                  {p.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.icon} alt="" width={28} height={28} className="h-7 w-7 rounded-lg" />
                  ) : (
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--midnight)_18%,transparent)]" aria-hidden="true">
                      <MidnightIcon />
                    </span>
                  )}
                  <span className="flex-1">
                    <span className="block font-medium">{p.name}</span>
                    <span className="mt-0.5 block font-mono text-[10px] text-text-dim">
                      {p.rdns} · api {p.apiVersion}
                    </span>
                  </span>
                  <span className="font-mono-label text-[9px] text-text-dim">Detected</span>
                </button>
              ))}
              {w.detected && w.providers.length === 0 && (
                <div className="rounded-2xl border border-[var(--hairline)] bg-white/[0.02] p-4">
                  <p className="text-sm text-text">No Midnight wallet found in this browser.</p>
                  <p className="mt-1 text-xs text-text-muted">
                    Install Lace with Midnight enabled, switch it to Preprod, then reload. We enumerate{" "}
                    <span className="font-mono">window.midnight</span> — we never hardcode{" "}
                    <span className="font-mono">mnLace</span>.
                  </p>
                  <a
                    href={LACE_MIDNIGHT_INSTALL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex h-9 items-center rounded-full border border-[var(--hairline)] px-4 text-xs text-text hover:bg-white/[0.06]"
                  >
                    Install Lace Midnight <span aria-hidden="true">&nbsp;↗</span>
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </div>
              )}
              {!w.detected && w.providers.length === 0 && (
                <p className="flex items-center gap-2 text-xs text-text-dim">
                  <Spinner /> Looking for Midnight wallets…
                </p>
              )}
              {w.providers.length === 1 && (
                <button
                  type="button"
                  disabled={w.status === "connecting"}
                  onClick={() => void w.connect(w.providers[0]!.injectionKey)}
                  className="inline-flex h-11 w-full items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--midnight)_85%,black)] text-sm font-medium text-white hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
                >
                  {w.status === "connecting" ? (
                    <>
                      <Spinner /> Connecting…
                    </>
                  ) : (
                    `Connect ${w.providers[0]!.name}`
                  )}
                </button>
              )}
            </div>
          </>
        )}

        {connected && (
          <>
            {!onPreprod && (
              <div
                role="alert"
                className="mt-4 rounded-2xl border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] p-3.5 text-xs leading-relaxed text-text-muted"
              >
                <span className="font-medium text-danger">Wrong network: {w.networkId ?? "unknown"}.</span> PlutusShield
                uses Midnight Preprod. Switch Lace to Preprod and reconnect.
              </div>
            )}
            <div className="mt-4 rounded-2xl border border-[var(--hairline)] bg-white/[0.02] p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono-label text-[9px] text-text-dim">
                  {onPreprod ? "Preprod" : w.networkId ?? "Network"} · unshielded address
                </p>
                {display && (
                  <button
                    type="button"
                    onClick={() => void copy()}
                    className="rounded-full px-2.5 py-1 text-[11px] text-text-muted hover:bg-white/[0.06] hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                )}
              </div>
              <p className="mt-2 select-all break-all font-mono text-[11.5px] leading-relaxed text-text">
                {display ?? "(address unavailable — wait for Lace sync)"}
              </p>
              <span className="sr-only" aria-live="polite">
                {copied ? "Address copied" : ""}
              </span>
            </div>

            {(w.shieldedAddress || w.dustAddress) && (
              <dl className="mt-3 divide-y divide-[var(--hairline)] rounded-2xl border border-[var(--hairline)] bg-white/[0.02]">
                {w.shieldedAddress && (
                  <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                    <dt className="text-xs text-text-muted">Shielded</dt>
                    <dd className="truncate font-mono text-[11px] text-text">{formatMidnightAddress(w.shieldedAddress)}</dd>
                  </div>
                )}
                {w.dustAddress && (
                  <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                    <dt className="text-xs text-text-muted">DUST</dt>
                    <dd className="truncate font-mono text-[11px] text-text">{formatMidnightAddress(w.dustAddress)}</dd>
                  </div>
                )}
              </dl>
            )}

            {w.services && (w.services.proverServerUri || w.services.indexerUri || w.services.substrateNodeUri) && (
              <div className="mt-3 rounded-2xl border border-[var(--hairline)] bg-white/[0.02] p-4">
                <p className="font-mono-label text-[9px] text-text-dim">serviceUriConfig · from Lace</p>
                <dl className="mt-2 space-y-1.5">
                  {w.services.proverServerUri && (
                    <Row label="Proof server" value={w.services.proverServerUri} />
                  )}
                  {w.services.indexerUri && <Row label="Indexer" value={w.services.indexerUri} />}
                  {w.services.substrateNodeUri && <Row label="Node" value={w.services.substrateNodeUri} />}
                </dl>
              </div>
            )}

            <p className="mt-3 text-xs leading-relaxed text-text-muted">
              Connected. Browser <span className="font-mono">proveCover</span> / <span className="font-mono">fileClaim</span>{" "}
              still need ZK configs and a proof server in the page — until that ships, download a claim kit on{" "}
              <a href="#claim-kit-note" className="text-accent underline-offset-2 hover:underline">
                /claim/evidence
              </a>{" "}
              and run{" "}
              <span className="font-mono text-[11px]">policy-cover-preprod.mjs --claim … --kit …</span>.
            </p>

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
          Connecting is read-only for now: PlutusShield reads your Midnight network, addresses, and Lace service URIs, and
          never sees your keys. Circuit submits from this wallet are next.
        </p>
      </div>
    </dialog>
  );
}

/** Compact status card for /app and /claim/evidence. */
export function MidnightWalletStatusCard() {
  const w = useMidnightWallet();
  const connected = w.status === "connected";
  const display = w.unshieldedAddress || w.shieldedAddress;
  const wrong = connected && w.networkId && w.networkId !== "preprod";

  return (
    <div className="glass-panel relative rounded-[1.4rem] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono-label text-[9.5px] text-text-dim">Midnight · Lace</p>
          <p className={`mt-2 font-display text-2xl leading-tight sm:text-3xl ${connected ? "text-text" : "text-text-muted"}`}>
            {connected ? (wrong ? "Wrong network" : "Connected") : "Not connected"}
          </p>
          <p className={`mt-1.5 text-xs leading-relaxed ${wrong ? "text-danger" : "text-text-dim"}`}>
            {connected
              ? wrong
                ? `${w.networkId} — switch Lace to Preprod.`
                : `${w.wallet?.name ?? "Wallet"} · ${formatMidnightAddress(display)}`
              : "Connect Lace Midnight on Preprod. proveCover / fileClaim from the browser are next; use the claim kit until then."}
          </p>
        </div>
        <MidnightWalletButton className="shrink-0" />
      </div>
      {connected && w.services?.proverServerUri && (
        <p className="mt-3 truncate font-mono text-[10.5px] text-text-dim">
          Proof server · {w.services.proverServerUri}
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[11px] text-text-muted">{label}</dt>
      <dd className="truncate text-right font-mono text-[10.5px] text-text">{value}</dd>
    </div>
  );
}

function MidnightIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M12 3a9 9 0 109 9c0-5-4-9-9-9z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.5" />
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
