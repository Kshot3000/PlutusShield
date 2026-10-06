"use client";

import { useEffect, useState } from "react";

/**
 * Wall-clock ms, ticking every `everyMs`; null during prerender and the first
 * client render, so static HTML hydrates without time-dependent mismatches.
 */
export function useNow(everyMs = 30_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => (clearTimeout(first), clearInterval(id));
  }, [everyMs]);
  return now;
}
