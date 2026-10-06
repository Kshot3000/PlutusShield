"use client";

/**
 * Buy USDM depeg cover on Cardano Preview from a CIP-30 wallet.
 *
 * Prices against the live tranche with the SDK's validator mirror, checks the
 * oracle sale circuit-breaker in the browser, then builds the Buy with the
 * same lib/tx/cover.ts the `pnpm web-buy` CLI and the emulator run use, asks
 * the wallet to sign, submits, and waits for the block.
 */
import { useMemo, useRef, useState } from "react";
import { useNow } from "@/lib/useNow";
import { AmountField } from "@/components/ui/AmountField";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ChoiceGroup, CurrencyMark } from "@/components/ui/ChoiceGroup";
import { WalletButton, FAUCET_URL } from "@/components/wallet/WalletButton";
import { toUnits } from "@/components/pool/LpPanel";
import { balanceOf, formatUnits } from "@plutusshield/sdk/cip30";
import { useWallet } from "@/lib/wallet";
import { PREVIEW_ASSETS, explorerTx } from "@/lib/preview";
import { CHAIN_API } from "@/lib/chainRead";
import { BUY_WINDOW_MS, POLICY_REF_LOVELACE, maxCoverage, quoteBuy, saleCheck, type FeedState } from "@/lib/tx/cover";
import { COVER, type CoverChain } from "@/lib/useCoverChain";

type Phase =
  | { kind: "idle" }
  | { kind: "building" }
  | { kind: "signing" }
  | { kind: "submitting" }
  | { kind: "confirming"; hash: string }
  | { kind: "done"; hash: string; summary: string }
  | { kind: "error"; message: string };

const P = COVER.params;
const MIN_DAYS = Number(P.product.minDays);
const MAX_DAYS = Number(P.product.maxDays);
const WAIT_MIN = Number(P.saleGuard.waitingPeriodMs) / 60_000;
const MAX_AGE_H = Number(P.saleGuard.maxPriceAgeMs) / 3_600_000;
/** Rough ada a Buy needs on top of an ada premium: policy deposit + fee headroom. */
const ADA_OVERHEAD = POLICY_REF_LOVELACE + 1_500_000n;

const fmt = (x: bigint, d = 2) => formatUnits(x, 6, d);
function age(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

export function BuyCover({ chain }: { chain: CoverChain }) {
  const w = useWallet();
  const [tranche, setTranche] = useState<"0" | "1">("0");
  const [raw, setRaw] = useState("100");
  const [days, setDays] = useState(30);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const now = useNow(15_000);
  const ac = useRef<AbortController | null>(null);
  const busy = phase.kind === "building" || phase.kind === "signing" || phase.kind === "submitting" || phase.kind === "confirming";

  const t = Number(tranche);
  const a = PREVIEW_ASSETS[t];
  const live = chain.pool?.tranches.find((x) => x.index === t);
  const ledger = useMemo(() => (live ? { capital: live.capital, totalShares: live.totalShares, activeCover: live.activeCover } : null), [live]);
  const cap = ledger ? maxCoverage(P, ledger) : 0n;

  const units = toUnits(raw);
  const q = useMemo(() => (ledger && units !== null ? quoteBuy(P, ledger, t, units, BigInt(days)) : null), [ledger, units, t, days]);
  const sale = useMemo(() => (chain.feeds && now !== null ? saleCheck(P, chain.feeds, now + BUY_WINDOW_MS) : null), [chain.feeds, now]);

  const connected = w.status === "connected";
  const wrongNetwork = connected && w.networkId !== 0;
  const held = w.balance ? (t === 0 ? w.balance.lovelace : balanceOf(w.balance, `${a.asset.policyId}.${a.asset.assetName}`)) : 0n;
  const ada = w.balance?.lovelace ?? 0n;

  let fieldError: string | null = null;
  if (raw && units === null) fieldError = "Enter a positive amount with up to 6 decimals.";
  else if (q && !q.ok) fieldError = units !== null && units > cap ? `Max for one policy in this tranche right now is ${fmt(cap, 0)} ${a.ticker}.` : q.reason;
  let fundsError: string | null = null;
  if (connected && q?.ok) {
    if (t === 0 && ada < q.premium + ADA_OVERHEAD)
      fundsError = `You need about ${fmt(q.premium + ADA_OVERHEAD)} tADA (premium + ${fmt(POLICY_REF_LOVELACE, 1)} ADA policy deposit + fees). Wallet: ${fmt(ada)} tADA.`;
    else if (t === 1 && held < q.premium) fundsError = `The premium is ${fmt(q.premium, 6)} tUSDCx; your wallet holds ${fmt(held)} tUSDCx.`;
    else if (t === 1 && ada < ADA_OVERHEAD) fundsError = `You also need about ${fmt(ADA_OVERHEAD)} tADA for the policy deposit and fees.`;
  }

  const canBuy = connected && !wrongNetwork && !busy && !!q?.ok && !fieldError && !fundsError && !!sale?.ok;
  const annual = q?.ok && units ? (Number(q.premium) / Number(units)) * (365 / days) : null;

  async function buy() {
    if (!canBuy || units === null || !q?.ok) return;
    const api = w.signingApi();
    if (!api) return setPhase({ kind: "error", message: "Reconnect your wallet and try again." });
    ac.current?.abort();
    ac.current = new AbortController();
    try {
      setPhase({ kind: "building" });
      const { lucidFor, COVER_SCRIPT, waitForTx } = await import("@/lib/tx/browser");
      const { buildBuy, placeholderCommitment } = await import("@/lib/tx/cover");
      const lucid = await lucidFor(api);
      const feeds = await lucid.utxosAt(COVER_SCRIPT.oracleAddress!);
      const built = await buildBuy(lucid, COVER_SCRIPT, {
        tranche: t,
        coverage: units,
        days: BigInt(days),
        // Placeholder until the Midnight registry step is wired into buying.
        midnightCommitment: placeholderCommitment(),
        now: Date.now(),
        feeds,
        maxPremium: q.premium,
      });
      setPhase({ kind: "signing" });
      const signed = await built.tx.sign.withWallet().complete();
      setPhase({ kind: "submitting" });
      const hash = await signed.submit();
      setPhase({ kind: "confirming", hash });
      await waitForTx(hash, ac.current.signal);
      setPhase({
        kind: "done",
        hash,
        summary: `Covered ${fmt(units)} ${a.ticker} for ${days} days. Premium paid: ${fmt(built.premium, 6)} ${a.ticker}. Cover starts ${new Date(Number(built.policy.start)).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })}.`,
      });
      void chain.refresh();
      void w.refresh();
    } catch (e) {
      const { txError } = await import("@/lib/tx/browser");
      setPhase({ kind: "error", message: txError(e) });
    }
  }

  const status: Partial<Record<Phase["kind"], string>> = {
    building: "Reading the pool and oracle feeds, building your transaction…",
    signing: "Approve the transaction in your wallet.",
    submitting: "Submitting to Cardano Preview…",
    confirming: "Submitted. Waiting for it to land in a block (usually under a minute)…",
  };
  const reset = () => (phase.kind === "done" || phase.kind === "error" ? setPhase({ kind: "idle" }) : undefined);
  const termChips = [14, 30, 90, 180, 365].filter((d) => d >= MIN_DAYS && d <= MAX_DAYS);

  return (
    <section aria-labelledby="buy-title" className="glass-panel relative p-5 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="cardano">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--cardano)]" aria-hidden />
              Live on Cardano Preview
            </Badge>
            <Badge>{chain.source === "live" ? `Priced from chain via ${CHAIN_API === "blockfrost" ? "Blockfrost" : "Koios"}` : "Build snapshot"}</Badge>
          </div>
          <h2 id="buy-title" className="mt-3 text-xl font-semibold tracking-tight text-text sm:text-2xl">
            Buy USDM depeg cover
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">
            Pays out the full coverage if a quorum of oracle feeds sees USDM below $0.95 for 24 hours during your term.
            Signed in your wallet and checked by the validator. Testnet funds only.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <ChoiceGroup<"0" | "1">
            name="buy-currency"
            legend="Pay premium and get paid in"
            value={tranche}
            onChange={(v) => (setTranche(v), setPhase({ kind: "idle" }))}
            className="grid-cols-2"
            options={PREVIEW_ASSETS.map((x, i) => ({
              value: String(i) as "0" | "1",
              label: x.symbol,
              hint: `${x.ticker} tranche · ${chain.pool ? fmt(chain.pool.tranches[i].capital, 0) : "—"} capital`,
              icon: <CurrencyMark currency={x.symbol} />,
            }))}
          />
          <AmountField
            id="buy-coverage"
            label={`Coverage (${a.ticker})`}
            raw={raw}
            onRaw={(s) => (setRaw(s), reset())}
            suffix={a.ticker}
            error={fieldError}
            hint={`Max per policy right now: ${fmt(cap, 0)} ${a.ticker}${connected ? ` · Wallet: ${fmt(held)} ${a.ticker}` : ""}`}
            chips={(t === 0 ? [50, 100, 200] : [500, 2_500, 5_000]).map((v) => ({ label: v.toLocaleString("en-US"), value: v })).concat(cap > 0n ? [{ label: "Max", value: Number(cap / 1_000_000n) }] : [])}
          />
          <fieldset className="min-w-0">
            <legend className="sr-only">Term</legend>
            <label className="flex justify-between text-sm text-text-muted" htmlFor="buy-term">
              <span>Term</span>
              <span className="font-mono text-text">{days} days</span>
            </label>
            <input
              id="buy-term"
              type="range"
              min={MIN_DAYS}
              max={MAX_DAYS}
              value={days}
              onChange={(e) => (setDays(Number(e.target.value)), reset())}
              aria-valuetext={`${days} days`}
              className="mt-2 w-full accent-[var(--accent)]"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {termChips.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={d === days}
                  onClick={() => (setDays(d), reset())}
                  className={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    d === days ? "border-accent text-text" : "border-border text-text-muted hover:border-border-strong hover:text-text"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </fieldset>
          <OracleStatus sale={sale} now={now} error={chain.feedError} />
        </div>

        <div className="flex flex-col rounded-[1.2rem] border border-border bg-white/[0.02] p-5 sm:p-6">
          <div aria-live="polite">
            <p className="font-mono-label text-[10px] text-text-dim">Premium the validator requires</p>
            {q?.ok && !fieldError ? (
              <>
                <p className="mt-2 font-display text-4xl tracking-tight text-text sm:text-5xl">
                  {fmt(q.premium, 6)} <span className="text-lg text-text-muted">{a.ticker}</span>
                </p>
                <p className="mt-1 text-sm text-text-muted">
                  {q.premium === P.assets[t].minPremium
                    ? `Minimum premium for any policy · ${days}-day term`
                    : `${annual !== null ? `${(annual * 100).toFixed(2)}% annualized · ` : ""}${days}-day term`}
                </p>
              </>
            ) : (
              <p className="mt-2 font-display text-4xl text-text-dim">—</p>
            )}
          </div>
          <dl className="mt-5 space-y-2.5 border-t border-border pt-5 text-sm">
            {[
              ["Payout if triggered", units !== null && q?.ok ? `${fmt(units)} ${a.ticker}` : "—"],
              ["Cover starts", `~${WAIT_MIN + BUY_WINDOW_MS / 60_000} min after you sign`],
              ["Policy deposit", `${fmt(POLICY_REF_LOVELACE, 1)} tADA, refunded at expiry`],
              ["Tranche utilization", live && q?.ok ? `${(Number(live.utilizationBps) / 100).toFixed(2)}% → ${((Number(q.pool.activeCover) / Number(q.pool.capital)) * 100).toFixed(2)}%` : "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-text-dim">{k}</dt>
                <dd className="text-right font-mono text-text">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {!connected ? (
              <WalletButton />
            ) : wrongNetwork ? (
              <p className="text-sm text-[var(--danger)]">Switch your wallet to the Preview testnet to buy cover.</p>
            ) : (
              <Button onClick={() => void buy()} disabled={!canBuy} className="w-full sm:w-auto">
                {busy ? "Working…" : q?.ok && !fieldError ? `Buy cover · ${fmt(q.premium, 2)} ${a.ticker}` : "Buy cover"}
              </Button>
            )}
            {connected && !wrongNetwork && ada === 0n && (
              <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="text-xs text-text-muted underline underline-offset-4 hover:text-text">
                Get test ada from the faucet ↗
              </a>
            )}
          </div>
          {fundsError && <p className="mt-3 text-xs text-[var(--danger)]">{fundsError}</p>}
          {connected && t === 1 && held === 0n && (
            <p className="mt-2 text-xs text-text-dim">tUSDCx is PlutusShield&apos;s Preview-only mock USDC; it isn&apos;t on public faucets yet, so ADA cover is the easy path to try.</p>
          )}
          {connected && !wrongNetwork && sale && !sale.ok && (
            <p className="mt-2 text-xs text-[var(--gold)]">Sales are paused until every oracle feed has a fresh healthy reading (see Oracle check).</p>
          )}
          {CHAIN_API === "koios" && (
            <p className="mt-2 text-xs text-text-dim">This build has no Blockfrost id, so it talks to public Koios; some browsers block that cross-site request.</p>
          )}

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
              <div className="rounded-xl border border-[color-mix(in_srgb,var(--success)_30%,var(--border))] bg-[color-mix(in_srgb,var(--success)_6%,transparent)] p-3">
                <p className="text-[var(--accent)]">{phase.summary}</p>
                <p className="mt-1.5 break-all font-mono text-[11px] text-text-muted">
                  Tx{" "}
                  <a href={explorerTx(phase.hash)} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-text">
                    {phase.hash} ↗
                  </a>
                </p>
                <p className="mt-1 text-[11px] text-text-dim">
                  Your claim token is in your wallet. See it under <a href="#my-policies" className="underline underline-offset-4">My policies</a>.
                </p>
              </div>
            )}
            {phase.kind === "error" && <p className="text-[var(--danger)]">{phase.message}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

const feedCopy = (f: FeedState, now: number, maxAgeH: number) => {
  if (f.state === "missing") return "no reading published";
  const old = age(now - Number(f.reading.windowEnd));
  const price = `$${(Number(f.reading.priceBps) / 10_000).toFixed(4)}`;
  if (f.state === "depeg") return `${price}, below the $0.95 trigger`;
  if (f.state === "stale") return `${price}, ${old} old (max ${maxAgeH} h)`;
  return `${price}, ${old} old`;
};

function OracleStatus({ sale, now, error }: { sale: ReturnType<typeof saleCheck> | null; now: number | null; error: string | null }) {
  const tone = !sale ? "default" : sale.ok ? "ok" : "blocked";
  return (
    <div
      className={`rounded-xl border p-4 text-sm ${
        tone === "ok"
          ? "border-[color-mix(in_srgb,var(--success)_30%,var(--border))] bg-[color-mix(in_srgb,var(--success)_5%,transparent)]"
          : tone === "blocked"
            ? "border-[color-mix(in_srgb,var(--gold)_35%,var(--border))] bg-[var(--gold-soft)]"
            : "border-border bg-bg-muted"
      }`}
      role="status"
    >
      <p className="font-mono-label text-[10px] text-text-dim">Oracle check (sale circuit-breaker)</p>
      {!sale || now === null ? (
        <p className="mt-1.5 text-text-muted">{error ? `Couldn't read the oracle feeds: ${error}.` : "Reading the oracle feeds…"}</p>
      ) : (
        <>
          <p className={`mt-1.5 ${sale.ok ? "text-text" : "text-[var(--gold)]"}`}>
            {sale.ok
              ? `Open: all ${sale.feeds.length} feeds report a healthy peg. Fresh for another ${age(sale.freshUntil! - (now + BUY_WINDOW_MS))}.`
              : sale.feeds.some((f) => f.state === "depeg")
                ? "Paused: a feed reports USDM below its peg, so nobody can buy into a known loss."
                : `Paused: the oracle readings are older than ${MAX_AGE_H} h. The Preview test oracle is refreshed by its operator; a browser can't publish feeds. Check back soon.`}
          </p>
          <ul className="mt-2.5 grid gap-1 text-xs">
            {sale.feeds.map((f) => (
              <li key={f.feed} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-mono text-text-muted">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${f.state === "ok" ? "bg-success" : f.state === "depeg" ? "bg-[var(--danger)]" : "bg-gold"}`}
                    aria-hidden
                  />
                  {f.feed}
                </span>
                <span className="text-right text-text-dim">
                  <span className="sr-only">{f.state === "ok" ? "healthy" : f.state}: </span>
                  {feedCopy(f, now, MAX_AGE_H)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
