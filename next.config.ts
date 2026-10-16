import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Своя VM (spec 0017): server.js + только нужные node_modules — бандл собирается в CI, на VM не ставим зависимости.
  output: "standalone",
  // Торговое ядро — TS-исходники workspace-пакета, Next их транспилирует.
  transpilePackages: ["@binance-dashboard/trading-core"],
  cacheComponents: true,
  // PGlite грузит WASM и данные по путям пакета, postgres.js — нативный node-клиент: не бандлить.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
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
