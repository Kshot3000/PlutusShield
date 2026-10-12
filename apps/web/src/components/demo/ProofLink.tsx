import { proofHref, type DemoProof } from "@/lib/demoWalkthrough";

const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;

/** One on-chain reference: label, network, short hash linking to the explorer. */
export function ProofLink({ proof }: { proof: DemoProof }) {
  const href = proofHref(proof);
  const isCardano = proof.chain === "cardano";
  const network = isCardano ? "Cardano Preview" : "Midnight Preprod";
  return (
    <li className="flex items-start gap-3 py-3">
      <span
        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${isCardano ? "bg-cardano" : "bg-midnight"}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] leading-snug text-text">{proof.label}</p>
        {proof.note ? <p className="mt-0.5 text-[12px] leading-snug text-text-dim">{proof.note}</p> : null}
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={proof.hash}
            className={`mt-1 inline-flex items-center gap-1.5 font-mono text-[11.5px] underline decoration-dotted underline-offset-4 ${
              isCardano ? "text-cardano hover:text-text" : "text-midnight hover:text-text"
            }`}
          >
            {short(proof.hash)}
            <span className="font-sans text-[10px] no-underline opacity-70" aria-hidden="true">↗</span>
            <span className="sr-only">
              {" "}
              ({proof.kind === "contract" ? "contract" : "transaction"} on {network} explorer, opens in a new tab)
            </span>
          </a>
        ) : (
          <code className="mt-1 block break-all font-mono text-[11.5px] text-text-muted">{proof.hash}</code>
        )}
      </div>
    </li>
  );
}
