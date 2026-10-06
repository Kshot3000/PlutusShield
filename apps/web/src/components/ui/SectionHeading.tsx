import type { ReactNode } from "react";
import { Badge } from "./Badge";

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  badgeVariant = "accent",
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "center" | "left";
  badgeVariant?: "default" | "accent" | "gold" | "cardano" | "midnight";
}) {
  const alignCls = align === "center" ? "mx-auto text-center items-center" : "text-left items-start";
  return (
    <div className={`mb-12 flex max-w-2xl flex-col gap-4 ${alignCls}`}>
      {eyebrow ? <Badge variant={badgeVariant}>{eyebrow}</Badge> : null}
      <h2 className="font-display text-3xl tracking-tight text-text sm:text-4xl md:text-[2.75rem] md:leading-[1.15] text-balance">
        {title}
      </h2>
      {description ? (
        <p className="text-base leading-relaxed text-text-muted sm:text-lg text-balance">
          {description}
        </p>
      ) : null}
    </div>
  );
}
