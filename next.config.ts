import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Своя VM (spec 0017): server.js + только нужные node_modules — бандл собирается в CI (deploy.yml задаёт
  // BUILD_STANDALONE=1), на VM зависимости не ставим. Сборку Vercel не меняем, пока прод на нём.
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
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
  // better-sqlite3 — нативный модуль (.node): не бандлить, standalone-трассировка копирует пакет с бинарником (spec 0059).
  serverExternalPackages: ["better-sqlite3"],
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
