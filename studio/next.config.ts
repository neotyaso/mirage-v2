import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/dance.html", destination: "/dance" }];
  },
};

export default nextConfig;
