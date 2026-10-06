"use client";

/**
 * Signed LP actions on the live Preview pool. Builds the Deposit / Withdraw
 * tx in the browser with the same builder our Preview e2e script runs
 * (lib/tx/lp.ts), asks the connected CIP-30 wallet to sign, submits, and
 * waits for the block.
 */
import { useMemo, useRef, useState } from "react";
import { AmountField } from "@/components/ui/AmountField";
import { Button } from "@/components/ui/Button";
import { ChoiceGroup, CurrencyMark } from "@/components/ui/ChoiceGroup";
import { WalletButton, FAUCET_URL } from "@/components/wallet/WalletButton";
import { useWallet } from "@/lib/wallet";
import { PREVIEW, PREVIEW_ASSETS, explorerTx } from "@/lib/preview";
import { lpTokenName } from "@plutusshield/sdk/cardano";
import { balanceOf, formatUnits } from "@plutusshield/sdk/cip30";
import type { LiveTranche } from "@plutusshield/sdk/chain";
import { quoteDeposit, quoteWithdraw } from "@/lib/tx/lp";

type Mode = "deposit" | "withdraw";
type Phase =
  | { kind: "idle" }
  | { kind: "building" }
  | { kind: "signing" }
  | { kind: "submitting" }
  | { kind: "confirming"; hash: string }
  | { kind: "done"; hash: string; summary: string }
  | { kind: "error"; message: string };

const DECIMALS = 6;

/** "12.5" → 12_500_000n without float rounding; null when not a positive amount. */
export function toUnits(raw: string, decimals = DECIMALS): bigint | null {
  const s = raw.replace(/,/g, "").trim();
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
  const [w, f = ""] = s.split(".");
  if (f.length > decimals) return null;
  const v = BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
  return v > 0n ? v : null;
}

const fmt = (x: bigint, d = 2) => formatUnits(x, DECIMALS, d);

export function LpPanel({ tranches, onConfirmed }: { tranches: LiveTranche[]; onConfirmed: () => void }) {
  const w = useWallet();
  const [mode, setMode] = useState<Mode>("deposit");
  const [tranche, setTranche] = useState<"0" | "1">("0");
  const [raw, setRaw] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const busy = phase.kind === "building" || phase.kind === "signing" || phase.kind === "submitting" || phase.kind === "confirming";
  const ac = useRef<AbortController | null>(null);

  const t = Number(tranche);
  const a = PREVIEW_ASSETS[t];
  const live = tranches.find((x) => x.index === t);
  const ledger = useMemo(
    () => (live ? { capital: live.capital, totalShares: live.totalShares, activeCover: live.activeCover } : null),
    [live],
  );

  const connected = w.status === "connected";
  const wrongNetwork = connected && w.networkId !== 0;
  const assetHeld = w.balance ? (t === 0 ? w.balance.lovelace : balanceOf(w.balance, `${a.asset.policyId}.${a.asset.assetName}`)) : 0n;
  const lpHeld = w.balance ? balanceOf(w.balance, `${PREVIEW.scriptHash}.${lpTokenName(t)}`) : 0n;

  const units = toUnits(raw);
  const quote = useMemo(() => {
    if (!ledger || units === null) return null;
    if (mode === "deposit") {
      const s = quoteDeposit(ledger, units);
      return s.ok ? { ok: true as const, line: `Mints ${fmt(s.shares, 6)} ${a.lpToken} shares` } : { ok: false as const, reason: s.reason };
    }
    const q = quoteWithdraw(ledger, units, PREVIEW.maxUtilizationBps, lpHeld);
    if (!q.step.ok) return { ok: false as const, reason: q.step.reason };
    return { ok: true as const, line: `Pays out ${fmt(q.step.payout, 6)} ${a.ticker}` };
  }, [ledger, units, mode, a, lpHeld]);

  const maxWithdraw = ledger ? quoteWithdraw(ledger, 1n, PREVIEW.maxUtilizationBps, lpHeld).maxShares : 0n;

  let fieldError: string | null = null;
  if (raw && units === null) fieldError = "Enter a positive amount with up to 6 decimals.";
  else if (units !== null && mode === "deposit" && connected && units > assetHeld) fieldError = `Your wallet holds ${fmt(assetHeld)} ${a.ticker}.`;
  else if (units !== null && mode === "withdraw" && connected && units > lpHeld) fieldError = `You hold ${fmt(lpHeld, 6)} ${a.lpToken} shares.`;
  else if (quote && !quote.ok) fieldError = quote.reason;

  const canSubmit = connected && !wrongNetwork && !busy && units !== null && !fieldError && quote?.ok;

  async function submit() {
    if (!canSubmit || units === null) return;
    const api = w.signingApi();
    if (!api) return setPhase({ kind: "error", message: "Reconnect your wallet and try again." });
    ac.current?.abort();
    ac.current = new AbortController();
    try {
      setPhase({ kind: "building" });
      const { lucidFor, POOL_SCRIPT, waitForTx } = await import("@/lib/tx/browser");
      const { buildDeposit, buildWithdraw } = await import("@/lib/tx/lp");
      const lucid = await lucidFor(api);
      const built = mode === "deposit" ? await buildDeposit(lucid, POOL_SCRIPT, t, units) : await buildWithdraw(lucid, POOL_SCRIPT, t, units);
      setPhase({ kind: "signing" });
      const signed = await built.tx.sign.withWallet().complete();
      setPhase({ kind: "submitting" });
      const hash = await signed.submit();
      setPhase({ kind: "confirming", hash });
      await waitForTx(hash, ac.current.signal);
      const summary =
        "shares" in built
          ? `Deposited ${fmt(units)} ${a.ticker} and minted ${fmt(built.shares, 6)} ${a.lpToken} shares.`
          : `Burned ${fmt(units, 6)} ${a.lpToken} shares for ${fmt(built.payout, 6)} ${a.ticker}.`;
      setPhase({ kind: "done", hash, summary });
      setRaw("");
      onConfirmed();
      void w.refresh();
    } catch (e) {
      const { txError } = await import("@/lib/tx/browser");
      setPhase({ kind: "error", message: txError(e) });
    }
  }

  const status: Record<Phase["kind"], string> = {
    idle: "",
    building: "Reading the pool and building your transaction…",
    signing: "Approve the transaction in your wallet.",
    submitting: "Submitting to Cardano Preview…",
    confirming: "Submitted. Waiting for it to land in a block (usually under a minute)…",
    done: "",
    error: "",
  };

  return (
    <div className="mt-6 rounded-[1.2rem] border border-border bg-white/[0.02] p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text">Provide liquidity on Preview</p>
          <p className="mt-1 text-xs text-text-muted">Real signed transactions from your wallet, checked by the validator. Testnet funds only.</p>
        </div>
        <div role="tablist" aria-label="LP action" className="flex rounded-full border border-border p-0.5">
          {(["deposit", "withdraw"] as Mode[]).map((m) => (
            <button
              key={m}
              role="tab"
              type="button"
              aria-selected={mode === m}
              onClick={() => (setMode(m), setRaw(""), setPhase({ kind: "idle" }))}
              className={`rounded-full px-4 py-1.5 text-xs capitalize transition ${mode === m ? "bg-white/[0.1] text-text" : "text-text-muted hover:text-text"}`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <ChoiceGroup<"0" | "1">
          name="lp-tranche"
          legend="Tranche"
          value={tranche}
          onChange={(v) => (setTranche(v), setRaw(""), setPhase({ kind: "idle" }))}
          className="grid-cols-2"
          compact
          options={PREVIEW_ASSETS.map((x, i) => ({ value: String(i) as "0" | "1", label: x.ticker, icon: <CurrencyMark currency={x.symbol} /> }))}
        />
        <div>
          <AmountField
            id="lp-live-amount"
            label={mode === "deposit" ? `Deposit (${a.ticker})` : `Shares to burn (${a.lpToken})`}
            raw={raw}
            onRaw={(s) => (setRaw(s), phase.kind === "done" || phase.kind === "error" ? setPhase({ kind: "idle" }) : undefined)}
            suffix={mode === "deposit" ? a.ticker : "shares"}
            error={fieldError}
            hint={
              connected
                ? mode === "deposit"
                  ? `Wallet: ${fmt(assetHeld)} ${a.ticker}${quote?.ok ? ` · ${quote.line}` : ""}`
                  : `You hold ${fmt(lpHeld, 6)} shares · max now ${fmt(maxWithdraw, 6)}${quote?.ok ? ` · ${quote.line}` : ""}`
                : quote?.ok
                  ? quote.line
                  : undefined
            }
            chips={
              mode === "deposit"
                ? (t === 0 ? [25, 100, 500] : [100, 1000, 5000]).map((v) => ({ label: `${v}`, value: v }))
                : connected && maxWithdraw > 0n
                  ? [{ label: "Max", value: Number(formatUnits(maxWithdraw, DECIMALS, 6).replace(/,/g, "")) }]
                  : undefined
            }
          />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {!connected ? (
          <WalletButton />
        ) : wrongNetwork ? (
          <p className="text-sm text-[var(--danger)]">Switch your wallet to the Preview testnet to continue.</p>
        ) : (
          <Button onClick={() => void submit()} disabled={!canSubmit}>
            {busy ? "Working…" : mode === "deposit" ? `Sign & deposit` : `Sign & withdraw`}
          </Button>
        )}
        {connected && !wrongNetwork && t === 0 && assetHeld === 0n && (
          <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="text-xs text-text-muted underline underline-offset-4 hover:text-text">
            Get test ada from the faucet ↗
          </a>
        )}
        {connected && t === 1 && mode === "deposit" && assetHeld === 0n && (
          <p className="text-xs text-text-dim">tUSDCx is a Preview-only mock stablecoin; it isn&apos;t on public faucets yet.</p>
        )}
      </div>

      <div aria-live="polite" className="mt-4 min-h-5 text-sm">
        {status[phase.kind] && (
          <p className="text-text-muted">
            {status[phase.kind]}{" "}
            {phase.kind === "confirming" && (
              <a href={explorerTx(phase.hash)} target="_blank" rel="noreferrer" className="font-mono text-xs underline underline-offset-4 hover:text-text">
                {phase.hash.slice(0, 10)}… ↗
              </a>
            )}
          </p>
        )}
        {phase.kind === "done" && (
          <p className="text-[var(--accent)]">
            {phase.summary}{" "}
            <a href={explorerTx(phase.hash)} target="_blank" rel="noreferrer" className="font-mono text-xs underline underline-offset-4">
              View tx ↗
            </a>
          </p>
        )}
        {phase.kind === "error" && <p className="text-[var(--danger)]">{phase.message}</p>}
      </div>
    </div>
  );
}
