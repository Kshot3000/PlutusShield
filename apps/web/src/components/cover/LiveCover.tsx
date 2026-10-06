"use client";

import { BuyCover } from "./BuyCover";
import { MyPolicies } from "./MyPolicies";
import { useCoverChain } from "@/lib/useCoverChain";

/** /cover live section: buy on Preview, then the wallet's policies, sharing one chain read. */
export function LiveCover() {
  const chain = useCoverChain();
  return (
    <div className="mb-12">
      <BuyCover chain={chain} />
      <MyPolicies chain={chain} />
    </div>
  );
}
