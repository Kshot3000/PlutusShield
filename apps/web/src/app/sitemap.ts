import type { MetadataRoute } from "next";
import { DOC_PAGES } from "@/components/docs/nav";

export const dynamic = "force-static";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.NEXT_PUBLIC_BASE_PATH
    ? `https://kshot3000.github.io${process.env.NEXT_PUBLIC_BASE_PATH}`
    : "http://localhost:3000");

const ROUTES = ["", "app", "cover", "pool", "claim", "claim/evidence", "docs"];

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [...ROUTES, ...DOC_PAGES.map((p) => `docs/${p.slug}`)];
  return paths.map((path) => ({
    url: path ? `${siteUrl}/${path}/` : `${siteUrl}/`,
  }));
}
