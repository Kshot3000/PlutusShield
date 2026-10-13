import Link from "next/link";
import { MidnightHash } from "@/components/midnight/MidnightHash";
import { Badge } from "@/components/ui/Badge";
import { CLAIMS_REGISTER as R, type ClaimRow, type RegisterStep } from "@/lib/claimsRegister";
import { adaOf } from "@/lib/exploitPreview";
import { shortHash } from "@/lib/midnightPreprod";
import { explorerTx } from "@/lib/preview";

const fmt = (ms: number | null | undefined) =>
  ms == null
    ? null
    : new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";

const pct = (bps: number | null) => (bps == null ? "—" : `${(bps / 100).toFixed(2)}%`);

const OUTCOME: Record<ClaimRow["outcome"], { label: string; cls: string }> = {
  paid: { label: "Paid on Cardano", cls: "border-success/30 bg-success/[0.08] text-success" },
  approved: { label: "Approved on Midnight", cls: "border-midnight/30 bg-midnight/[0.08] text-midnight" },
  denied: { label: "Denied", cls: "border-[var(--hairline)] bg-white/[0.03] text-text-muted" },
};

function Step({ s }: { s: RegisterStep }) {
  const when = fmt(s.at);
  return (
    <li className="relative pl-5">
      <span
        className={`absolute left-0 top-[0.4rem] h-2 w-2 rounded-full ${s.chain === "Cardano" ? "bg-cardano" : "bg-midnight"}`}
        aria-hidden="true"
      />
      <span className="text-[11.5px] text-text">
        <span className={s.chain === "Cardano" ? "text-cardano" : "text-midnight"}>{s.chain}</span> · {s.label}
        {s.note ? <span className="text-text-dim"> ({s.note})</span> : null}
      </span>
      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-text-dim">
        {s.chain === "Cardano" ? (
          <a
            href={explorerTx(s.txHash)}
            target="_blank"
            rel="noreferrer"
            title={s.txHash}
            className="font-mono text-[11px] text-text underline decoration-dotted underline-offset-4 hover:text-cardano"
          >
            {shortHash(s.txHash)} ↗
          </a>
        ) : (
          <MidnightHash h={s.txHash} />
        )}
        {s.block != null ? <span>block {s.block.toLocaleString("en-US")}</span> : null}
        {when ? <span>{when}</span> : null}
      </span>
    </li>
  );
}

function Row({ r }: { r: ClaimRow }) {
  const o = OUTCOME[r.outcome];
  return (
    <article className="card-surface p-5 sm:p-6" aria-label={`Claim on policy ${shortHash(r.policyId)}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono-label text-[9.5px] text-text-dim">
            {r.product === "exploit" ? "Smart-contract exploit cover" : "USDM depeg cover · registry drill"}
          </p>
          <p className="mt-1 font-mono text-[12px] text-text" title={r.policyId}>
            Policy {shortHash(r.policyId, 10)}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] ${o.cls}`}>
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
          {o.label}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-[11.5px] sm:grid-cols-4">
        <div>
          <dt className="text-text-dim">Decided by</dt>
          <dd className="mt-0.5 text-text">{r.decidedBy}</dd>
        </div>
        <div>
          <dt className="text-text-dim">Filed by</dt>
          <dd className="mt-0.5 text-text">{r.filedBy === "holder" ? "The holder (claim kit)" : "Operator relay"}</dd>
        </div>
        <div>
          <dt className="text-text-dim">Cover</dt>
          <dd className="mt-0.5 text-text">{r.coverageLovelace ? adaOf(r.coverageLovelace) : "Test policy"}</dd>
        </div>
        <div>
          <dt className="text-text-dim">Paid out</dt>
          <dd className="mt-0.5 text-text">
            {r.payoutLovelace ? `${adaOf(r.payoutLovelace)}${r.settleQuorum ? ` · ${r.settleQuorum} signed` : ""}` : "Nothing on Cardano"}
          </dd>
        </div>
      </dl>

      {r.votes.length ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px]" aria-label="Committee votes">
          <span className="text-text-dim">Committee votes</span>
          {r.votes.map((v) => (
            <span
              key={v.seat}
              className={`rounded-full border px-2 py-0.5 ${v.approved ? "border-success/30 text-success" : "border-danger/30 text-danger"}`}
            >
              Seat {v.seat} {v.approved ? "approved" : "rejected"}
            </span>
          ))}
        </div>
      ) : null}

      <ol className="mt-4 grid gap-2.5 border-l border-[var(--hairline)] pl-3">
        {r.steps.map((s) => (
          <Step key={`${s.label}-${s.txHash}`} s={s} />
        ))}
      </ol>
      <p className="mt-4 text-[11.5px] leading-relaxed text-text-muted">{r.note}</p>
    </article>
  );
}

export function ClaimsRegister() {
  const s = R.stats;
  const tiles = [
    { k: "Claims decided", v: String(s.decided), sub: `${s.approved} approved · ${s.denied} denied` },
    { k: "Paid on Cardano", v: adaOf(s.paidLovelace), sub: `${s.paidOnCardano} exploit-cover payouts` },
    { k: "Filed by the holder", v: String(s.holderFiled), sub: "policy key never left the claim kit" },
    { k: "Under-quorum payouts refused", v: String(s.refusedSettles), sub: "validator rejected 1-of-3 Settle" },
  ];
  return (
    <div className="grid gap-6">
      <section aria-label="Register totals" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.k} className="glass-panel rounded-[1.4rem] p-5">
            <p className="font-mono-label text-[9.5px] text-text-dim">{t.k}</p>
            <p className="mt-2 font-display text-[1.7rem] leading-none text-text">{t.v}</p>
            <p className="mt-2 text-[11.5px] text-text-muted">{t.sub}</p>
          </div>
        ))}
      </section>

      <section className="card-surface p-5 sm:p-6" aria-labelledby="register-depeg">
        <div className="flex flex-wrap gap-2">
          <Badge variant="cardano">Depeg cover</Badge>
          <Badge>{R.oracle.everTriggered ? "Trigger crossed" : "Trigger never crossed"}</Badge>
        </div>
        <h2 id="register-depeg" className="mt-3 text-base font-semibold text-text">
          {R.oracle.everTriggered ? "The depeg trigger has been crossed" : "No depeg claim has paid, because USDM never broke its peg"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">
          Depeg cover is parametric: it pays only when a quorum of oracle feeds attests a 24-hour average below{" "}
          {pct(R.oracle.triggerBps)}. Across {R.oracle.livePublishes} live publishes on Cardano Preview, the lowest was{" "}
          {pct(R.oracle.lowestBps)}
          {R.oracle.lowestAt ? ` on ${fmt(Date.parse(R.oracle.lowestAt))}` : ""}
          {R.oracle.lowestTx ? (
            <>
              {" "}
              (
              <a
                href={explorerTx(R.oracle.lowestTx)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[12px] text-text underline decoration-dotted underline-offset-4 hover:text-cardano"
              >
                {shortHash(R.oracle.lowestTx)} ↗
              </a>
              )
            </>
          ) : null}
          . The depeg rows below are Midnight registry drills on depeg test policies; nothing pays on Cardano for them.{" "}
          <Link href="/oracle" className="text-text underline underline-offset-4 hover:text-cardano">
            See every publish
          </Link>
          .
        </p>
      </section>

      {R.refused.length ? (
        <section className="card-surface p-5 sm:p-6" aria-labelledby="register-refused">
          <div className="flex flex-wrap gap-2">
            <Badge variant="gold">Refused by the validator</Badge>
          </div>
          <h2 id="register-refused" className="mt-3 text-base font-semibold text-text">
            Payouts the contract would not release
          </h2>
          <ul className="mt-3 grid gap-3">
            {R.refused.map((x) => (
              <li key={`${x.policyId}-${x.at}`} className="text-sm leading-relaxed text-text-muted">
                <span className="font-mono text-[12px] text-text">{shortHash(x.policyId, 10)}</span> on {fmt(x.at)}: Settle with{" "}
                {x.signatures} of the committee&apos;s signatures (it needs {x.threshold}) failed script evaluation in{" "}
                {x.evaluators.join(" and ")}, so no transaction could be built or submitted.
                {R.rows.some((r) => r.policyId === x.policyId && r.outcome === "paid")
                  ? ` The same policy paid later, once ${x.threshold} committee members had signed.`
                  : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="register-rows">
        <h2 id="register-rows" className="sr-only">
          Every decided claim, newest first
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {R.rows.map((r) => (
            <Row key={r.policyId} r={r} />
          ))}
        </div>
      </section>
    </div>
  );
}
