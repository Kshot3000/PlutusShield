"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Site chrome (header, footer, grain) that the bare /embed widgets must not carry. */
export function NotInEmbed({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  if (pathname.startsWith("/embed")) return null;
  return <>{children}</>;
}
