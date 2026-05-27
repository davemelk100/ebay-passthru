import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // Belt-and-suspenders for crawlers that ignore meta tags or
        // robots.txt — and for link-unfurl bots that probe URLs directly
        // and only inspect headers.
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" },
        ],
      },
    ];
  },
};

export default nextConfig;
