import type { ReactNode } from "react";

type Tone = "default" | "accent" | "gold" | "cardano" | "midnight";

const toneColor: Record<Tone, string> = {
  default: "text-text-muted",
  accent: "text-accent",
  gold: "text-gold",
  cardano: "text-cardano",
  midnight: "text-midnight",
};

export function SectionHeading({
  eyebrow,
  index,
  title,
  description,
  align = "center",
  badgeVariant = "accent",
  className = "",
}: {
  eyebrow?: string;
  index?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "center" | "left";
  badgeVariant?: Tone;
  className?: string;
}) {
  const alignCls =
    align === "center" ? "mx-auto text-center items-center" : "text-left items-start";
  return (
    <div className={`reveal mb-14 flex max-w-2xl flex-col gap-5 sm:mb-16 ${alignCls} ${className}`}>
      {eyebrow ? (
        <p className={`flex items-center gap-3 font-mono-label text-[10.5px] ${toneColor[badgeVariant]}`}>
          {index ? <span className="text-text-dim">{index}</span> : null}
          {index ? <span className="h-px w-6 bg-current opacity-40" aria-hidden="true" /> : null}
          {eyebrow}
        </p>
      ) : null}
      <h2 className="font-display text-[2.15rem] leading-[1.05] text-text sm:text-5xl md:text-[3.4rem] text-balance">
        {title}
      </h2>
      {description ? (
        <p className="max-w-xl text-[15px] leading-relaxed text-text-muted sm:text-[17px] text-pretty">
          {description}
        </p>
      ) : null}
    </div>
  );
}
