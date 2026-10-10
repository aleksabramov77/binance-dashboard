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

## Доступ (вход через GitHub)
- `proxy.ts` (корень; в Next 16 так называется бывший middleware, Node runtime) закрывает все страницы
  и `/api/*`. Решение принимает чистая функция `decideAccess` (`shared/lib/auth/accessPolicy.ts`):
  нет сессии → страницы редиректят на `/login?callbackUrl=…`, API → 401.
- Auth.js v5 (`src/app/server/auth.ts`): провайдер GitHub, JWT-сессия на 30 дней, пускает только логины
  из `AUTH_ALLOWED_GITHUB_LOGINS` (проверка при входе и в proxy на каждый запрос).
- Режим — `getAuthConfig()` (`shared/config/env.server.ts`): без `AUTH_SECRET` вне production — защита
  выключена (локальная разработка, `/api/auth/*` → 404); в production без полного набора `AUTH_*` или при
  частичной настройке — **закрыто всё** (503, fail-closed).
- Без сессии открыты только `/login`, `/api/auth/*` и `/api/cron/*`. Cron защищён своим секретом:
  `Authorization: Bearer $CRON_SECRET` (`shared/lib/auth/cronAuth.server.ts`, сравнение за постоянное время).
- UI: `features/auth` — кнопка «Войти через GitHub», меню пользователя в хедере (аватар, логин, «Выйти»).

| Переменная | Назначение |
|---|---|
| `AUTH_SECRET` | ключ подписи сессий (`openssl rand -base64 32`) |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | GitHub OAuth App |
| `AUTH_ALLOWED_GITHUB_LOGINS` | кому можно войти, через запятую |
| `CRON_SECRET` | Bearer-секрет для `POST /api/cron/tick` |

## Логирование и ошибки
- `log.debug|info|warn|error(event, message, data?, error?)` из `shared/lib/logger.server.ts`:
  JSON-строки в `data/logs/app-YYYY-MM-DD.jsonl` + строка в консоль. Секреты маскируются.
- Каждый API-роут обёрнут `withLogging` (`shared/lib/route.server.ts`): непредвиденная ошибка →
  JSON `{ error }` (502 — сбой внешнего сервиса, 500 — наш), стек в журнале.
- Ошибки браузера уходят в `POST /api/logs`. Страница `/logs` показывает журнал.

## Данные на диске
`data/` в `.gitignore`: `snapshots/` (снимки Earn), `logs/`. БД нет.
