import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { PolicyTracker } from "@/components/policy/PolicyTracker";

export const metadata: Metadata = {
  title: "Policy tracker",
  description:
    "Follow one PlutusShield policy end to end: the Cardano Preview Buy, its Midnight registration ticket, the private Preprod registry, zero-knowledge cover proofs, claim votes, and the Cardano payout or release.",
  openGraph: {
    title: "Policy tracker · PlutusShield",
    description: "One timeline per policy: Cardano buy → Midnight registration → ZK cover proof → committee votes → payout.",
    url: "https://kshot3000.github.io/PlutusShield/policy/",
    type: "website",
    images: [{ url: "https://kshot3000.github.io/PlutusShield/og/og-policy.png", width: 1200, height: 630, alt: "Policy tracker · PlutusShield" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Policy tracker · PlutusShield",
    description: "One timeline per policy: Cardano buy → Midnight registration → ZK cover proof → committee votes → payout.",
    images: ["https://kshot3000.github.io/PlutusShield/og/og-policy.png"],
  },
};

export default function PolicyPage() {
  return (
    <AppShell
      active="cover"
      title="Policy tracker"
      description="One policy, both chains, one timeline: bought on Cardano Preview, mirrored privately on Midnight Preprod, claimed, voted, and settled. Every step links to its transaction."
    >
      <Suspense fallback={<p className="text-sm text-text-muted">Loading the tracker…</p>}>
        <PolicyTracker />
      </Suspense>
    </AppShell>
  );
}
