import type { NextConfig } from "next";

/**
 * Static export for GitHub Pages.
 *
 * Project pages are served from a sub-path (https://kshot3000.github.io/PlutusShield/),
 * so the production build needs a basePath. Set NEXT_PUBLIC_BASE_PATH="" (or unset)
 * for local dev / root-domain hosting; the Pages workflow sets it to "/PlutusShield".
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
  transpilePackages: ["@plutusshield/sdk"],
};

export default nextConfig;
