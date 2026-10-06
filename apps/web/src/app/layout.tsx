import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.NEXT_PUBLIC_BASE_PATH
    ? `https://kshot3000.github.io${process.env.NEXT_PUBLIC_BASE_PATH}`
    : "http://localhost:3000");

export const viewport: Viewport = {
  themeColor: "#05060b",
  colorScheme: "dark",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "PlutusShield — DeFi insurance for Cardano & Midnight",
    template: "%s · PlutusShield",
  },
  description:
    "DeFi and smart-contract insurance for Cardano and Midnight. Settlement you can audit, privacy where it matters. Design preview — no live cover yet.",
  openGraph: {
    title: "PlutusShield — DeFi insurance for Cardano & Midnight",
    description:
      "Protection you can verify on-chain, with privacy where it actually matters.",
    type: "website",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${instrumentSans.variable} ${instrumentSerif.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body className="relative flex min-h-full flex-col bg-bg text-text">
        <div className="noise pointer-events-none fixed inset-0 z-[60]" aria-hidden="true" />
        <a
          href="#main"
          className="sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:m-0 focus:inline-flex focus:h-auto focus:w-auto focus:overflow-visible focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:text-[var(--text-inverse)] focus:[clip:auto]"
        >
          Skip to content
        </a>
        <Header />
        <main id="main" className="flex flex-1 flex-col">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
