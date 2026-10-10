import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Торговое ядро — TS-исходники workspace-пакета, Next их транспилирует.
  transpilePackages: ["@binance-dashboard/trading-core"],
  cacheComponents: true,
  partialPrefetching: true,
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
