import { shortHash } from "@/lib/midnightPreprod";

/** A public hash / key hash: short on small screens, full on wide ones, always the full value in the tooltip. */
export function HashCell({ value, href, tone = "text" }: { value: string; href?: string | null; tone?: "text" | "cardano" | "midnight" }) {
  const color = tone === "cardano" ? "hover:text-cardano" : tone === "midnight" ? "hover:text-midnight" : "hover:text-accent";
  const inner = (
    <>
      <span className="xl:hidden">{shortHash(value, 10)}</span>
      <span className="hidden break-all xl:inline">{value}</span>
    </>
  );
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={value}
      className={`font-mono text-[11.5px] text-text underline decoration-dotted underline-offset-4 ${color}`}
    >
      {inner}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  ) : (
    <code title={value} className="font-mono text-[11.5px] text-text">
      {inner}
    </code>
  );
}
