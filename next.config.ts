import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
