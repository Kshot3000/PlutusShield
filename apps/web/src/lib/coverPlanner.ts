/**
 * Live tranches for the cover planner on /plan, baked at compile time from the
 * same public pool snapshots as /book and /products (no keys, no live reads).
 * Each product draws on its own Preview pool; each currency is its own tranche.
 */
import type { PoolState } from "@plutusshield/sdk";
import { UNDERWRITING_BOOK, type BookEntry } from "@/lib/underwritingBook";

export type PlannerCurrency = "ADA" | "USDC";

const toWhole = (raw: string, decimals: number) => Number(BigInt(raw)) / 10 ** decimals;

function trancheOf(id: BookEntry["id"], symbol: PlannerCurrency): PoolState | null {
  const t = UNDERWRITING_BOOK.entries.find((e) => e.id === id)?.tranches.find((x) => x.symbol === symbol);
  if (!t) return null;
  return { capital: toWhole(t.capital, t.decimals), activeCover: toWhole(t.activeCover, t.decimals) };
}

export const PLANNER_POOLS: Record<PlannerCurrency, { depeg: PoolState | null; exploit: PoolState | null }> = {
  ADA: { depeg: trancheOf("usdm-depeg", "ADA"), exploit: trancheOf("exploit-v2", "ADA") },
  USDC: { depeg: trancheOf("usdm-depeg", "USDC"), exploit: trancheOf("exploit-v2", "USDC") },
};

export const PLANNER_SNAPSHOT_AT =
  UNDERWRITING_BOOK.entries.find((e) => e.id === "usdm-depeg")?.snapshotTakenAt ?? null;
