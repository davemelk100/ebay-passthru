import type { MetadataRoute } from "next";

// Block every well-behaved crawler. The route also returns an
// X-Robots-Tag header (see next.config.ts) for link-preview bots.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
