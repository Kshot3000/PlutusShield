import type { Metadata } from "next";
import { EmbedQuote } from "@/components/embed/EmbedQuote";

export const metadata: Metadata = {
  title: "Cover quote widget",
  description: "Embeddable PlutusShield cover quote for partner dApps. Testnet only, not audited.",
  robots: { index: false, follow: true },
};

export default function EmbedQuotePage() {
  return <EmbedQuote />;
}
