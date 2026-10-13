import Link from "next/link";
import { HashCell } from "@/components/assessors/HashCell";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CurrencyMark } from "@/components/ui/ChoiceGroup";
import { CATALOG_STATS as S, PRODUCTS_CATALOG, type CatalogEntry } from "@/lib/productsCatalog";
import { explorerAddress } from "@/lib/preview";

const statusVariant = { live: "gold", priced: "accent", planned: "default" } as const;

const linkCls = "font-medium underline-offset-4 hover:underline";

function Fact({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-white/[0.02] px-4 py-3">
      <dt className="font-mono-label text-[9.5px] text-text-dim">{k}</dt>
      <dd className={`mt-1 text-[13px] leading-snug text-text ${mono ? "font-mono" : ""}`}>{v}</dd>
    </div>
  );
}

function Currencies({ entry }: { entry: CatalogEntry }) {
  const { premiumCurrencies, plannedCurrencies } = entry.product;
  if (!premiumCurrencies.length) {
    return (
      <div>
        <p className="font-mono-label text-[9.5px] text-text-dim">Premium currencies</p>
        <p className="mt-2 text-[13px] text-text-muted">
          None yet: not for sale. Designed for {plannedCurrencies.join(" or ")} once an uptime oracle and pool exist.
        </p>
      </div>
    );
  }
  return (
    <div>
      <p className="font-mono-label text-[9.5px] text-text-dim">Pay premium and get paid in</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {premiumCurrencies.map((c) => (
          <li
            key={c}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-white/[0.03] px-3 py-1.5 text-[12.5px] text-text"
          >
            <CurrencyMark currency={c} />
            {c === "ADA" ? "tADA" : "tUSDCx"}
          </li>
        ))}
        <li className="inline-flex items-center rounded-full border border-dashed border-border px-3 py-1.5 text-[11.5px] text-text-dim">
          NIGHT premiums: not supported
        </li>
      </ul>
    </div>
  );
}

function PayoutSteps({ entry }: { entry: CatalogEntry }) {
  const { product: p, deployed: d } = entry;
  const steps =
    p.id === "depeg"
      ? [
          ["Buy", `Every allowlisted feed must show a healthy, fresh USDM reading; cover starts ${d?.waitingMinutes ?? "—"} min after the sale.`],
          ["Trigger", "2 of 3 authenticated feeds report the 24h TWAP below 0.95 inside your cover period."],
          ["Payout", "Your wallet signs Settle and receives the full coverage from the pool in the same Cardano tx. Nobody approves it."],
        ]
      : p.id === "exploit"
        ? [
            ["Buy", `No price trigger, so no peg guard; cover starts ${d?.waitingMinutes ?? "—"} min after the sale.`],
            ["File", "Seal your evidence in the browser; only its commitment is filed on Midnight with fileClaim."],
            ["Decide", "Three committee seats vote privately on Midnight; two approvals mark the claim PAID."],
            ["Payout", "The Cardano Settle needs 2 of 3 assessor signatures; one key alone is refused."],
          ]
        : [
            ["Missing", "An authenticated uptime oracle. Without it there is nothing honest to settle against."],
            ["Then", "An SLA pool parameterised like depeg cover, with uptime readings in place of prices."],
            ["Today", "Price it in the quote calculator only. There is no buy button, on purpose."],
          ];
  return (
    <ol className={`grid gap-3 sm:grid-cols-2 ${steps.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
      {steps.map(([k, v], i) => (
        <li key={k} className="rounded-xl border border-border bg-bg-muted/40 p-4">
          <p className="font-mono-label text-[9.5px] text-text-dim">
            {String(i + 1).padStart(2, "0")} · {k}
          </p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-text-muted">{v}</p>
        </li>
      ))}
    </ol>
  );
}

function ProductCard({ entry }: { entry: CatalogEntry }) {
  const { product: p, deployed: d } = entry;
  const midnightTone = p.chain === "Cardano + Midnight";
  return (
    <article id={p.id} className="glass-panel relative scroll-mt-24 rounded-[1.6rem] p-6 sm:p-8" aria-labelledby={`product-${p.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="flex flex-wrap gap-2">
            <Badge variant={statusVariant[p.status]}>
              {p.status === "live" ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)]" aria-hidden /> : null}
              {entry.statusLabel}
            </Badge>
            <Badge variant="cardano">{d ? d.network : "Cardano (planned)"}</Badge>
            {midnightTone || d?.midnight ? <Badge variant="midnight">{d?.midnight ?? "Midnight"}</Badge> : null}
            <Badge>{p.settlementModel === "parametric" ? "Parametric" : "Assessed"}</Badge>
          </div>
          <h2 id={`product-${p.id}`} className="mt-3 font-display text-[1.75rem] leading-tight text-text sm:text-[2rem]">
            {p.name}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">{p.tagline}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-2 text-[11.5px] sm:text-right">
          <div>
            <dt className="text-text-dim">Base rate (tier B)</dt>
            <dd className="font-mono text-text">{entry.baseRatePct.toFixed(2)}% / yr</dd>
          </div>
          <div>
            <dt className="text-text-dim">Term</dt>
            <dd className="font-mono text-text">
              {p.minDays}–{p.maxDays} days
            </dd>
          </div>
        </dl>
      </div>

      {p.blocker ? (
        <p className="mt-5 rounded-xl border border-[color-mix(in_srgb,var(--gold)_35%,transparent)] bg-[var(--gold-soft)] px-4 py-3 text-[13px] leading-relaxed text-text">
          <span className="font-semibold text-gold">Not buyable. </span>
          {p.blocker}
        </p>
      ) : null}

      <dl className="mt-6 grid gap-3 sm:grid-cols-2">
        <Fact k="Covers" v={p.covers} />
        <Fact k="Trigger" v={p.trigger} />
        <Fact k="Settlement" v={p.settlement} />
        <Fact k="Privacy" v={p.privacy} />
        <Fact k="Trigger source" v={p.source} />
        <Fact k="Sale guard" v={p.saleGuard} />
      </dl>

      <div className="mt-6">
        <Currencies entry={entry} />
      </div>

      <div className="mt-6">
        <p className="mb-3 font-mono-label text-[9.5px] text-text-dim">How a claim pays</p>
        <PayoutSteps entry={entry} />
        <p className="mt-3 text-[12.5px] leading-relaxed text-text-muted">{p.claimModel}</p>
      </div>

      {d ? (
        <div className="mt-6 rounded-xl border border-border bg-white/[0.02] p-4 sm:p-5">
          <p className="font-mono-label text-[9.5px] text-text-dim">Deployed parameters · from the public deployment record</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-[11.5px] sm:grid-cols-4">
            {[
              ["Waiting period", `${d.waitingMinutes} min`],
              ["Peg reading max age", d.maxPriceAgeMinutes === null ? "n/a (no price trigger)" : `${d.maxPriceAgeMinutes} min`],
              ["Claim grace", `${d.claimGraceDays} days after expiry`],
              ["Quorum", d.quorum],
              ...d.capital.map((c) => [`${c.ticker} capital (snapshot)`, `${c.amount} · ${c.free} free`]),
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-text-dim">{k}</dt>
                <dd className="mt-0.5 font-mono text-text">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4">
            <p className="font-mono-label text-[9.5px] text-text-dim">Pool address</p>
            <div className="mt-1">
              <HashCell value={d.address} href={explorerAddress(d.address)} tone="cardano" />
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {p.buy ? (
          <Button href={p.buy.href} size="sm">
            {p.buy.label} <span aria-hidden="true">→</span>
          </Button>
        ) : (
          <span className="inline-flex h-9 items-center rounded-full border border-dashed border-border px-4 text-[13px] text-text-dim">
            Not for sale yet
          </span>
        )}
        <Button href={p.quote.href} size="sm" variant="secondary">
          {p.quote.label}
        </Button>
        <span className="mx-1 hidden h-4 w-px bg-[var(--hairline)] sm:inline-block" aria-hidden />
        {p.related.map((l) => (
          <Link key={l.href} href={l.href} className={`${linkCls} text-[13px] text-text`}>
            {l.label}
          </Link>
        ))}
        {d ? (
          <Link href={`/book#book-${d.bookId}`} className={`${linkCls} text-[13px] text-text-muted`}>
            Pool in the book
          </Link>
        ) : null}
        {d?.recordHref ? (
          <a href={d.recordHref} target="_blank" rel="noopener noreferrer" className={`${linkCls} text-[13px] text-text-muted`}>
            Deploy record ↗
          </a>
        ) : null}
      </div>
    </article>
  );
}

export function ProductsCatalog() {
  return (
    <div className="space-y-6">
      <section className="card-surface p-6 sm:p-8" aria-labelledby="products-summary">
        <div className="flex flex-wrap gap-2">
          <Badge variant="gold">Cover catalog</Badge>
          <Badge variant="cardano">Cardano Preview</Badge>
          <Badge variant="midnight">Midnight Preprod</Badge>
          <Badge>Not audited</Badge>
        </div>
        <h2 id="products-summary" className="mt-4 font-display text-[1.6rem] leading-tight text-text">
          {S.live} products live on testnet · {S.priced} priced, not yet buyable
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-text-muted">
          Every product line PlutusShield prices, with what it covers, how a claim pays, which chain does what, and what
          you can pay in. The copy and status come from the SDK&apos;s <span className="font-mono text-text">PRODUCTS</span>,
          the same records the quote engine prices from; the deployed numbers come from the public Preview deployment
          records on every site build.
        </p>
        <nav aria-label="Products" className="mt-5 grid gap-3 sm:grid-cols-3">
          {PRODUCTS_CATALOG.map(({ product: p, statusLabel }) => (
            <a
              key={p.id}
              href={`#${p.id}`}
              className="group rounded-xl border border-border bg-white/[0.02] px-4 py-3 transition hover:bg-white/[0.05]"
            >
              <span className="font-mono-label text-[9.5px] text-text-dim">{statusLabel}</span>
              <span className="mt-1 block text-[14px] font-semibold text-text group-hover:text-cardano">{p.name}</span>
              <span className="mt-0.5 block text-[12px] text-text-muted">
                {p.chain} · {p.settlementModel}
              </span>
            </a>
          ))}
        </nav>
        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Live products", String(S.live)],
            ["Premiums", "ADA · USDC"],
            ["Max per policy", `${S.maxSinglePolicyPct}% of pool`],
            ["Utilization cap", `${S.maxUtilizationPct}%`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-border bg-white/[0.02] px-4 py-3">
              <dt className="font-mono-label text-[9.5px] text-text-dim">{k}</dt>
              <dd className="mt-1 font-mono text-lg text-text">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {PRODUCTS_CATALOG.map((entry) => (
        <ProductCard key={entry.product.id} entry={entry} />
      ))}
    </div>
  );
}
