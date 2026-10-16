import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Своя VM (spec 0017): server.js + только нужные node_modules — бандл собирается в CI, на VM не ставим зависимости.
  output: "standalone",
  // Торговое ядро — TS-исходники workspace-пакета, Next их транспилирует.
  transpilePackages: ["@binance-dashboard/trading-core"],
  cacheComponents: true,
  // Версия сборки (spec 0036): Next ставит data-dpl-id на <html> и перезагружает страницу при навигации
  // после деплоя; по ней же вкладка со старой сборкой узнаёт о новой версии. NEXT_DEPLOYMENT_ID — первым:
  // если его задаёт хостинг, Next требует совпадения с deploymentId. Локально не задана — механизм выключен.
  // Сервер читает ту же версию — getDeploymentVersion (src/shared/config/env.server.ts).
  deploymentId:
    process.env.NEXT_DEPLOYMENT_ID ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    undefined,
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
