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

## Домены и изоляция
Приложение будет большим дашбордом из независимых разделов. FSD запрещает импорты между слайсами
одного слоя, но не запрещает, например, фиче экспериментов взять сущность Earn с нижнего слоя. Поэтому
поверх FSD действует правило **доменов**: каждый слайс принадлежит ровно одному домену, домены
друг о друге не знают.

| Домен | Слайсы (сейчас и планируемые) | API-роуты | Данные |
|---|---|---|---|
| Earn | `pages/earn`, `widgets/{best-offers,changes-feed,offers-table}`, `features/{collect-snapshot,refresh-snapshot,offer-filters}`, `entities/earn-offer` | `/api/earn/*` | `data/snapshots` |
| Портфель | `pages/portfolio`, `widgets/{holdings-table,portfolio-summary,rebalance-plan}`, `features/{load-portfolio,portfolio-advice}`, `entities/holding` | `/api/portfolio` | — |
| Сигналы и демо-сделки | `pages/signals`, `widgets/{market-movers,setup-cards,signals-help,trade-log}`, `features/{scan-market,analyze-setup,setup-review,trade-ticket,execute-trade,position-sizing,auto-trade*}`, `entities/{market-signal,trade}` | `/api/signals/*`, `/api/trade/*`, `/api/analysis` | — |
| Лаборатория экспериментов | ядро `packages/trading-core` (`@binance-dashboard/trading-core`: индикаторы, схемы, стратегии, выходы, sizing, исполнение), `entities/experiment` (фасад ядра + UI стратегий), `features/paper-engine` (тик движка, юниверс, кэш свечей, каталог 40 экспериментов, интерфейс `ExperimentStore`; среда-независимый — Node и Deno, задача 1d), `pages/{experiments,stats,settings}` | `/api/experiments/*`, `/api/cron/tick` | таблицы `experiments`, `runs`, `paper_trades`, `engine_state` |
| ИИ-кредиты | `entities/ai-credits` | `/api/openrouter/*` | — |
| Платформа (не домен) | `app/*`, `src/app/server/*` (в т.ч. `auth.ts`), `proxy.ts`, `widgets/app-header`, `pages/{logs,login}`, `entities/log-entry`, `features/auth` (вход, `UserMenu`), `shared/lib/auth/*` (`accessPolicy`, `cronAuth.server`), прочий `shared/*` | `/api/logs`, `/api/auth/*`, страница `/login` | `data/logs`, подключение к БД |

Правила:
- **Нет импортов между доменами** ни на каком слое. Фича лаборатории не импортирует `entities/trade`,
  `entities/earn-offer` и т.п., даже если это «вниз» по FSD. Нужна общая вещь — она без бизнес-смысла
  переезжает в `shared` (индикатор, формат денег, клиент Binance), а не берётся из чужого домена.
- **`shared` не знает о доменах:** в нём нет слов «эксперимент», «earn», «сетап», «портфель». Исключение —
  клиенты внешних сервисов (`shared/api/binance`), они общие для всех.
- **Авторизация — сквозная и только в платформе:** `proxy.ts`, `shared/lib/auth`, `features/auth`,
  `src/app/server/auth.ts`. В production при неполной настройке proxy отвечает 503 на всё, включая
  `/api/cron/*` (fail-closed). `/api/cron/tick` закрыт Bearer `CRON_SECRET`, а тик в нём — код Лаборатории. Код доменов не
  проверяет сессию, не импортирует Auth.js и не знает о пользователе; защита включается централизованно.
- **Склейка доменов — только в платформе:** хедер (`widgets/app-header`) и серверная композиция
  (`src/app/server/*`, `instrumentation.ts`) собирают домены через их public API (`index.ts`).
  Домен не вызывает другой домен напрямую; если нужно (демо-зеркало лаборатории → сделка в демо),
  зависимость внедряется функцией из `src/app/server/*`, как `AutoTradeDeps`.
- **Свои данные:** у домена свои таблицы (без внешних ключей в чужие таблицы и без джойнов между
  доменами), свои файлы в `data/`, свой префикс API-роутов, свой `config`. Чужие данные — только через
  public API другого домена в слое композиции.
- **Проверка удалением:** домен можно удалить (его слайсы, роуты, таблицы, строку в хедере) — и остальные
  собираются и проходят тесты без правок. Если нет — граница нарушена.
- **Ядро домена может быть отдельным workspace-пакетом** (`packages/*`), как `trading-core`: чистый TypeScript
  без `@/**`, Next, React, TanStack и `node:*` (запрет — Biome override). Приложение подключает его через
  `transpilePackages`; слайсы домена импортируют ядро по имени пакета.
- Движок `features/paper-engine` тоже среда-независимый (его тик исполняет и Edge Function Supabase на
  Deno, spec 007b): только `trading-core`, `zod` и свои модули, без `@/**` и `node:*` (Biome override).
  Сеть, БД и время внедряются через `TickDeps`; композиция — в `src/app/server/*`.
- **Общая композиция тика** `src/app/server/engineTick.ts` (`runEngineTick`) — одна для VM
  (`experimentEngine.ts`) и Edge Function `supabase/functions/engine-tick` (Deno): advisory lock в БД,
  проверка раннера, хранилище Drizzle, `TickDeps`. Её и всё, что Deno грузит исходниками
  (`trading-core`, `paper-engine`, `entities/experiment`, `shared/api/binance/marketApi.ts`), пишется без
  `node:*`, Next и `*.server`, с явными расширениями `.ts` в относительных импортах (бандлер Supabase
  не угадывает расширения) — оба правила проверяет Biome; `pnpm check:edge` — `deno check` функций.
- Исключение: `@/shared/lib` реэкспортирует индикаторы (ema/rsi/atr и ta-серии) из `trading-core`, чтобы
  сканер Сигналов не дублировал математику. Индикаторы доменно-нейтральны; если ядро начнут использовать
  другие домены шире индикаторов — вынести индикаторы в свой пакет.
- Новый слайс — сразу в таблицу выше, в свой домен. Новый домен — новая строка.

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
- Движок лаборатории (задача 2b): хранилище — `createDbExperimentStore(db)` из `entities/experiment`
  (структурно = `ExperimentStore` движка), сид каталога (`seedExperiments`, upsert по id; `enabled`,
  `demo_mirror`, `initial_budget` пишутся только при вставке) и первая эпоха (`ensureRun`). Композиция —
  `src/app/server/experimentEngine.ts`: таймер раз в минуту (+5 с) из `instrumentation.ts` (singleton в
  `globalThis`, не в фазе build), блокировка тика общая с `POST /api/cron/tick`, кэш свечей в памяти
  процесса, публичные свечи/тикеры/funding (`premiumIndex`) без ключей. Роль раннера процесса —
  `ENGINE_RUNNER` (`oracle` по умолчанию); тумблер — `engine_state.enabled` (по умолчанию выкл),
  `GET/POST /api/experiments/engine {enabled}`.
- Миграции — `drizzle/`: `pnpm db:generate` собирает схемы из `src/entities/*/model/db.ts` (коммитятся).
  Применяются `pnpm db:migrate` и автоматически при старте сервера (`instrumentation.ts`); сбой БД
  пишется в журнал и не роняет дашборд.
