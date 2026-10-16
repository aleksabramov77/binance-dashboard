// Steiger — официальный линтер Feature-Sliced Design. Запуск: `pnpm lint:fsd`.
// .mjs, а не .ts: на Node 20 Steiger не умеет грузить TS-конфиг.
import fsd from "@feature-sliced/steiger-plugin";
import { defineConfig } from "steiger";

export default defineConfig([
  ...fsd.configs.recommended,
  {
    rules: {
      // Фичи вызываются из Next route handlers в корневом `app/api/*` — вне `src`,
      // Steiger их не видит и считает слайсы «без ссылок». Мелкие слайсы допустимы.
      "fsd/insignificant-slice": "off",
      // Shared намеренно разделён на клиентский `index.ts` и серверные `*.server.ts`
      // (иначе node:crypto/fs попадают в клиентский бандл) — см. docs/ai/architecture.md.
      // Запрет deep imports в слайсы (entities…pages) проверяет Biome: noRestrictedImports.
      "fsd/no-public-api-sidestep": "off",
      // `entities/ai-credits` — название понятия (баланс кредитов), не множественное число.
      "fsd/inconsistent-naming": "off",
    },
  },
  {
    // `/**` обязателен: без него правило для слоя не выключается.
    files: ["./src/features/**"],
    rules: {
      // Слайсы делятся по доменам (docs/ai/architecture.md → «Домены и изоляция»), а не группами папок: в features
      // их больше 20 (spec 0050). Группировка по доменам — отдельной задачей, если понадобится.
      "fsd/excessive-slicing": "off",
    },
  },
  {
    files: ["./src/shared/**"],
    rules: {
      // Сегменты shared/api и shared/ui отдают модули по отдельности (binance, openrouter, button…).
      "fsd/public-api": "off",
    },
  },
  {
    files: ["./src/app/**"],
    rules: {
      // `app/providers` — каноническое имя из документации FSD.
      "fsd/segments-by-purpose": "off",
    },
  },
]);
