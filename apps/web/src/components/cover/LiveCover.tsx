"use client";

import { BuyCover } from "./BuyCover";
import { BuyExploitCover } from "./BuyExploitCover";
import { MyPolicies } from "./MyPolicies";
import { useCoverChain } from "@/lib/useCoverChain";
import { useExploitCoverChain } from "@/lib/useExploitCoverChain";

/**
 * /cover live section: buy depeg cover, buy exploit cover, then the wallet's
 * policies across both Preview pools. One chain read per pool, shared, so a
 * Buy in either panel shows up in My policies on the same refresh.
 */
export function LiveCover() {
  const chain = useCoverChain();
  const exploit = useExploitCoverChain();
  return (
    <div className="mb-12">
      <BuyCover chain={chain} />
      <BuyExploitCover chain={exploit} />
      <MyPolicies chain={chain} exploit={exploit} />
    </div>
  );
}
