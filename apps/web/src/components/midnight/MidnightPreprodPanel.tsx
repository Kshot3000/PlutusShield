import { Button } from "@/components/ui/Button";
import { explorerTx } from "@/lib/preview";
import { MIDNIGHT_PREPROD as M, shortHash } from "@/lib/midnightPreprod";
import { ActivityFeed, LiveCounters, RelayStatus } from "./LiveContractActivity";

const rows: { step: string; what: string; hash: string; href?: string; block?: number }[] = [
  {
    step: "1 · Cardano Preview",
    what: `Buy ${M.firstPolicy.coverageAda} ADA cover. Only a commitment to the holder and amount goes in the datum.`,
    hash: M.firstPolicy.cardanoBuyTx,
    href: explorerTx(M.firstPolicy.cardanoBuyTx),
  },
  {
    step: "2 · registerPolicy",
    what: "The relay reads the datum from chain and mirrors the policy. The circuit re-checks the Cardano commitment.",
    hash: M.firstPolicy.registerPolicy.txHash,
    block: M.firstPolicy.registerPolicy.block,
  },
  {
    step: "3 · proveCover",
    what: `The holder proves at least ${M.firstPolicy.coverageAda} ADA of active cover with a zero-knowledge proof. No amount, no address.`,
    hash: M.firstPolicy.proveCover.txHash,
    block: M.firstPolicy.proveCover.block,
  },
];

/** Live Midnight Preprod proof that a Cardano policy has a private twin. Public data only; counters and the activity feed stream from the Preprod indexer. */
export function MidnightPreprodPanel() {
  return (
    <section aria-labelledby="midnight-preprod-title" className="glass-panel relative mt-6 overflow-hidden p-6 sm:p-8">
      <div
        className="pointer-events-none absolute -left-20 -bottom-24 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,var(--midnight-soft),transparent)] blur-2xl"
        aria-hidden="true"
      />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <p className="flex items-center gap-2 font-mono-label text-[10px] text-midnight">
            <span className="h-2 w-2 rounded-full bg-success animate-pulse-dot" aria-hidden="true" />
            Live on {M.network}
          </p>
          <h2 id="midnight-preprod-title" className="mt-2 font-display text-2xl leading-tight text-text sm:text-[1.75rem]">
            Your cover, <em className="text-midnight-grad">provable and private.</em>
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">
            The private policy registry is deployed on Midnight. Every Cardano Buy publishes a registration ticket, the relay
            mirrors the policy into the registry, and its holder proves cover on-chain without revealing who they are or how
            much they hold. Lenders and DEXs can ask for that proof and learn nothing else.
          </p>
        </div>
        <LiveCounters />
      </div>

      <ol className="relative mt-6 grid gap-3 md:grid-cols-3">
        {rows.map((r) => (
          <li key={r.step} className="rounded-2xl border border-[var(--hairline)] bg-white/[0.02] p-4">
            <p className="font-mono-label text-[9.5px] text-text-dim">{r.step}</p>
            <p className="mt-1.5 text-xs leading-relaxed text-text-muted">{r.what}</p>
            <p className="mt-3 font-mono text-[11px] text-text" title={r.hash}>
              {r.href ? (
                <a href={r.href} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-4 hover:text-accent-strong">
                  {shortHash(r.hash)} <span aria-hidden="true">↗</span>
                </a>
              ) : (
                <>
                  {shortHash(r.hash)}
                  {r.block ? <span className="text-text-dim"> · block {r.block.toLocaleString("en-US")}</span> : null}
                </>
              )}
            </p>
          </li>
        ))}
      </ol>

      <RelayStatus />

      <ActivityFeed />

      <div className="relative mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--hairline)] pt-4">
        <p className="min-w-0 font-mono text-[11px] text-text-dim">
          Contract <span className="break-all text-text-muted">{M.contractAddress}</span>
        </p>
        <div className="flex gap-2">
          <Button href={M.record} external variant="secondary" size="sm">
            Deployment record <span aria-hidden="true">↗</span>
          </Button>
          <Button href="/docs/privacy" variant="ghost" size="sm">
            How privacy works
          </Button>
        </div>
      </div>
    </section>
  );
}
