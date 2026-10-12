import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Native / Node-only packages must not be bundled.
  serverExternalPackages: ["pg-boss", "sharp", "@resvg/resvg-js", "archiver"],
  experimental: {
    serverActions: {
      // Product photo uploads go through a Server Action.
      bodySizeLimit: "25mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
