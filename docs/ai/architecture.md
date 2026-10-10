# Архитектура

## Стек
Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict · TanStack Query (серверные данные) ·
Zustand (клиентское состояние, если понадобится) · nuqs (фильтры в URL) · Zod (схемы API, env, ответов
внешних сервисов) · Tailwind 4 + shadcn/ui (`src/shared/ui`) · Biome · Steiger · Vitest.

> Next.js этой версии отличается от того, что ты помнишь. Перед кодом, завязанным на API Next,
> читай `node_modules/next/dist/docs/`.

## Feature-Sliced Design
Роутинг Next — в корневом `app/` (тонкий: страницы реэкспортируют `src/pages/*`, API-роуты
вызывают фичи). Слои — в `src/`, сверху вниз:

| Слой | Что лежит | Примеры |
|---|---|---|
| `app` | провайдеры, глобальные стили | `providers/Providers.tsx`, `styles/globals.css` |
| `pages` | экраны целиком | `signals`, `portfolio`, `earn`, `logs` |
| `widgets` | крупные блоки страниц | `setup-cards`, `trade-log`, `holdings-table` |
| `features` | действия пользователя и серверные сценарии | `execute-trade`, `scan-market`, `trade-ticket` |
| `entities` | бизнес-сущности: схемы, типы, query-хуки, мелкий UI | `trade`, `market-signal`, `holding` |
| `shared` | без бизнес-логики: API-клиенты, конфиг, утилиты, UI-кит | `api/binance`, `lib`, `ui` |

Правила (проверяются линтерами):
- Импорт только **вниз** по слоям. Слайсы одного слоя друг друга не импортируют — композиция уровнем выше.
- Слайс отдаёт наружу только `index.ts`. Deep imports в `pages/widgets/features/entities` запрещены
  (Biome `noRestrictedImports`). Внутри слайса — относительные импорты.
- Сегменты слайса: `ui`, `model`, `api`, `lib`, `config`. Query-хуки и fetch-функции — в `api`,
  чистые функции — в `lib` (их и тестируем), сценарии — в `model`.
- Steiger: `pnpm lint:fsd`; отключённые правила и причины — в `steiger.config.mjs`.

## Торговое ядро `packages/trading-core`
Workspace-пакет `@binance-dashboard/trading-core` (spec 003): индикаторы, схемы экспериментов, стратегии,
выходы, размер позиции, исполнение paper-сделок. Только чистые функции и Zod — без React, Next, `@/…`,
сети, БД и env (Biome `overrides`). Приложение импортирует пакет (`transpilePackages` в `next.config.ts`);
UI сущности — в `src/entities/experiment`. Подробно — `packages/trading-core/README.md`.

## Сервер и клиент
- Всё, что использует секреты, `node:crypto` или `node:fs` (логгер), — **только сервер**.
  Такие модули называются `*.server.ts` (`shared/api/binance/demo.server.ts`, `shared/lib/logger.server.ts`,
  `shared/config/env.server.ts`) или это серверные слайсы фич (комментарий в их `index.ts`).
- Клиентский `@/shared/api/binance` (`index.ts`) экспортирует только типы и чистые функции.
- Поток данных: компонент → query-хук в `entities/*/api` → `fetch('/api/...')` → `app/api/*/route.ts`
  (обёрнут `withLogging`) → фича `model/*` → `shared/api/*` → внешний сервис. Ответ валидируется Zod
  на обеих сторонах.
- Env читается через Zod в `shared/config/env.server.ts`; отсутствие ключа → `null` и понятное
  сообщение в UI, а не падение.

## Внешние сервисы
- Binance публичное API (рынок, Earn) — без ключа.
- Binance read-only ключ — портфель (`BINANCE_API_KEY/SECRET`).
- Binance Demo Trading — сделки на виртуальные деньги (`BINANCE_DEMO_API_KEY/SECRET`).
- OpenRouter — «Разбор от ИИ» (`OPENROUTER_API_KEY`).
Сетевые повторы — `shared/lib/fetchRetry.ts`; подписанные запросы — `shared/api/binance/signed.ts`.

## Логирование и ошибки
- `log.debug|info|warn|error(event, message, data?, error?)` из `shared/lib/logger.server.ts`:
  JSON-строки в `data/logs/app-YYYY-MM-DD.jsonl` + строка в консоль. Секреты маскируются.
- Каждый API-роут обёрнут `withLogging` (`shared/lib/route.server.ts`): непредвиденная ошибка →
  JSON `{ error }` (502 — сбой внешнего сервиса, 500 — наш), стек в журнале.
- Ошибки браузера уходят в `POST /api/logs`. Страница `/logs` показывает журнал.

## Данные на диске
`data/` в `.gitignore`: `snapshots/` (снимки Earn), `logs/`, `pglite/` (локальная БД).

## База данных (spec 003, задача 2a)
- Postgres через Drizzle ORM. `src/shared/db/client.server.ts` — доменно-нейтральное подключение:
  `getDb`, `migrateDb`, `closeDb`, `createMemoryDb` (тесты). Только сервер. Схемы в клиент не
  передаются: запросы явно указывают таблицу (`db.select().from(experimentsTable)`).
- Таблицы живут в слайсах своих доменов — `src/entities/<сущность>/model/db.ts` (лаборатория:
  `experiments`, `runs` — эпохи сброса, `paper_trades`, `engine_state`) и экспортируются через public API
  сущности. Внешние ключи и джойны — только внутри домена.
- Подключение: `DATABASE_URL` → postgres.js (прод — Supabase, пулер в режиме transaction, `prepare: false`);
  без неё — встроенный PGlite в `PGLITE_DIR` (по умолчанию `data/pglite`), внешние сервисы не нужны.
- Миграции — `drizzle/`: `pnpm db:generate` собирает схемы из `src/entities/*/model/db.ts` (коммитятся).
  Применяются `pnpm db:migrate` и автоматически при старте сервера (`instrumentation.ts`); сбой БД
  пишется в журнал и не роняет дашборд.
