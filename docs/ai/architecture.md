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
| Earn | `pages/earn` (вкладки Simple / Dual / Стейкинг и DeFi / Гид), `widgets/{best-offers,changes-feed,offers-table,dual-offers-table,yield-products-table,kind-summary,earn-guide,allocation-plan}`, `features/{collect-snapshot,refresh-snapshot,offer-filters,load-earn-catalog,allocation-advice}`, `entities/{earn-offer,earn-product}` (сложные продукты, гид — spec 0019) | `/api/earn/*` (в т.ч. `/api/earn/summary` — публичная сводка, `/api/earn/advanced` — каталоги по ключу), `/api/cron/earn-snapshot` | таблица `earn_snapshots` (`entities/earn-offer/model/db.ts`); каталоги сложных продуктов — только кэш в памяти 5 мин |
| Портфель | `pages/portfolio`, `widgets/{holdings-table,portfolio-summary,rebalance-plan}`, `features/{load-portfolio,portfolio-advice}`, `entities/holding` | `/api/portfolio` | — |
| Сигналы и демо-сделки | `pages/signals`, `widgets/{market-movers,setup-cards,signals-help,trade-log}`, `features/{scan-market,analyze-setup,setup-review,trade-ticket,execute-trade,position-sizing}`, `entities/{market-signal,trade}` | `/api/signals/*`, `/api/trade/*`, `/api/analysis` | — |
| Лаборатория экспериментов | ядро `packages/trading-core` (`@binance-dashboard/trading-core`: индикаторы, схемы, стратегии, выходы, sizing, исполнение), `entities/experiment` (фасад ядра, UI стратегий, бюджеты по рынкам `MarketBudgets`, группы активов AG — `model/assetGroup.ts` (`spot` / `usdm` / `coinm`, вид группы `kind`, доступность демо-зеркала; spec 0023), демо-метрики — `computeDemoStats`), `features/paper-engine` (тик движка, юниверс, кэш свечей, каталог 40 экспериментов, интерфейс `ExperimentStore`; среда-независимый — Node и Deno, задача 1d), `features/engine-toggle` (тумблер «Автоторговля» в хедере), `features/demo-mirror` (зеркало в Binance Demo, spec 008; включение с подтверждением — `features/demo-mirror-toggle`; биржу и БД передаёт `src/app/server/demoMirror.ts`), `pages/{experiments,experiment-detail,stats,settings}` (сброс эпохи и настройки — `entities/experiment/api/settingsDb.ts`, `features/paper-engine/model/planReset.ts`; агрегаты сделок — `entities/experiment/lib/stats.ts`, разрезы `/stats` — `entities/experiment/lib/slices.ts`); запись приватных экспериментов в БД — `scripts/lab-private.ts` + `scripts/lib/labPrivate.ts` (`pnpm lab:private`, spec 0015); бэктест по истории — `scripts/lab-backtest.ts` + `scripts/lib/{labBacktest,labHistory}.ts` (`pnpm lab:backtest`, spec 0032; повтор `runTick`, дисковый кэш свечей вне git) | `/api/experiments/*` (в т.ч. `/api/experiments/stats`, `/api/experiments/settings/mirror`), `/api/cron/tick`, `/api/cron/demo-mirror` | таблицы `experiments`, `runs`, `paper_trades` (с контекстом входа и MAE, spec 0030), `engine_state`, `demo_mirror_orders`, `skipped_signals` (отсечённые лимитом сигналы, spec 0030; объём ограничен движком) |
| ИИ-кредиты | `entities/ai-credits` | `/api/openrouter/*` | — |
| Платформа (не домен) | `app/*`, `src/app/server/*` (в т.ч. `auth.ts`), `proxy.ts`, `widgets/app-header`, `pages/{logs,login,help}`, `entities/log-entry` (таблицы `app_logs`, `alert_state`), `features/log-monitor` (монитор журнала → задача в GitHub → Telegram), `features/db-space` (свободное место в базе: пороги, тексты бота), `src/app/server/{logs,logMonitor,alertState,dbSpace,telegramBot}.ts`, `features/auth` (вход, `UserMenu`), `shared/lib/auth/*` (`accessPolicy`, `cronAuth.server`), `shared/api/github` (REST: issues, метки, комментарии), `.claude/routines/alert-triage.md` (routine разбора тревог), плашка новой версии (`widgets/app-header`: `NewVersionBanner`, `useNewVersionAvailable`; `shared/lib/client` — версия страницы и `reportClientError`, spec 0036), прочий `shared/*` | `/api/logs` (фильтры `level`/`event`/`experiment`/`days`), `/api/version`, `/api/cron/log-monitor`, `/api/telegram/webhook`, `/api/auth/*`, страница `/login`, страница `/help` (глоссарий из `docs/ai/glossary.md` через `pnpm glossary`) | таблицы `app_logs`, `alert_state`; локально ещё `data/logs`; подключение к БД |

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
  зависимость внедряется функцией из `src/app/server/*` (как `experimentEngine.ts` внедряет в движок свечи и хранилище).
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
  сканер Сигналов не дублировал математику; так же `shared/api/binance/markets.ts` берёт из ядра чтение старого имени
  рынка `futures` (`normalizeMarket`, `withLegacyMarketField`, spec 0023) — одна реализация на всё приложение. Индикаторы доменно-нейтральны; если ядро начнут использовать
  другие домены шире индикаторов — вынести индикаторы в свой пакет.
- Новый слайс — сразу в таблицу выше, в свой домен. Новый домен — новая строка.

## Торговое ядро `packages/trading-core`
Workspace-пакет `@binance-dashboard/trading-core` (spec 003): индикаторы, схемы экспериментов, стратегии,
выходы, размер позиции, исполнение paper-сделок. Только чистые функции и Zod — без React, Next, `@/…`,
сети, БД и env (Biome `overrides`). Приложение импортирует пакет (`transpilePackages` в `next.config.ts`);
UI сущности — в `src/entities/experiment`. Подробно — `packages/trading-core/README.md`.

## Группы активов (AG, spec 0016, 0023)
- Значения `market` в коде, БД и URL — `spot`, `usdm` (USDⓈ-M, `fapi`), `coinm` (COIN-M, `dapi`); коды для людей —
  `SPOT`, `FT:USDM`, `FT:COINM` (`entities/experiment/model/assetGroup.ts` → `ASSET_GROUPS`, порядок ключей — порядок в
  шапке и фильтрах). Схема — одна, `marketSchema` из `trading-core`; «это фьючерс» — признак `MARKET_KIND` / `isFuturesMarket`
  (шорт, плечо, funding), а не сравнение со строкой. Старое имя `futures` (до spec 0023) читают `legacyMarketSchema`
  (ядро: журнал, `?market=futures`), `parseMarketParam` (фильтры nuqs) и `tradeMarketSchema` (`shared/api/binance`:
  сетапы и сделки Сигналов, у них только `spot` / `usdm`). Данные в БД переведены миграцией `drizzle/0007_futures_to_usdm.sql`.
- COIN-M в движке: юниверс — бессрочные `…USD_PERP` со статусом TRADING (`fetchPerpetuals("coinm")`, размер контракта),
  оборот в $ = контракты × размер (`coinmTicker`), сделка — целые контракты (`sizePosition({ contractSizeUsd })`), PnL и
  комиссии в $ по формулам USDⓈ-M. Рынок без тикеров (dapi недоступен) — его эксперименты ждут следующего тика, одна запись
  `warn`; остальные группы торгуют. Демо-зеркало COIN-M — позже: `DEMO_MIRROR_MARKETS`, галочка выключена, API — 400.

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
- Без сессии открыты только `/login`, `/api/auth/*`, `/api/cron/*` и `/api/telegram/*`. Cron защищён своим секретом:
  `Authorization: Bearer $CRON_SECRET` (`shared/lib/auth/cronAuth.server.ts`, сравнение за постоянное время);
  webhook Telegram — заголовком `X-Telegram-Bot-Api-Secret-Token` = `TELEGRAM_WEBHOOK_SECRET` (`checkSecretHeader`, без секрета — 503).
- UI: `features/auth` — кнопка «Войти через GitHub», меню пользователя в хедере (аватар, логин, «Выйти»).

| Переменная | Назначение |
|---|---|
| `AUTH_SECRET` | ключ подписи сессий (`openssl rand -base64 32`) |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | GitHub OAuth App |
| `AUTH_ALLOWED_GITHUB_LOGINS` | кому можно войти, через запятую |
| `CRON_SECRET` | Bearer-секрет для `POST /api/cron/tick` |

## Логирование и ошибки
- `log.debug|info|warn|error(event, message, data?, error?)` из `shared/lib/logger.server.ts`: строка в консоль,
  записи info+ пачками в таблицу `app_logs` (приёмник подключает `instrumentation.ts`; на Vercel запись после
  ответа через `after()` в `withLogging`), локально ещё `data/logs/app-YYYY-MM-DD.jsonl` с debug. Секреты маскируются.
- Монитор журнала (`features/log-monitor`, `POST /api/cron/log-monitor`, pg_cron каждые 15 мин): всплески ошибок,
  5xx по ручкам, движок не тикает, упавший cron, старый Earn → разбор ИИ (`LOG_ANALYSIS_MODEL`) → Telegram;
  повтор не чаще 2 ч, «восстановлено» один раз. Журнал хранится 14 дней.
- Задачи по тревогам (spec 0037, `features/log-monitor/model/trackAlertIssues.ts`, клиент `shared/api/github`): задан
  `GITHUB_ALERTS_TOKEN` — новая тревога до отправки в Telegram заводит issue в `GITHUB_ALERTS_REPO` (по умолчанию
  приватный `aleksabramov77/binance-dashboard-private`) с маркером `<!-- alert:<ключ> -->`, деталями, ИИ-разбором и
  записями журнала; метка `alert` запускает облачную routine Claude (`.claude/routines/alert-triage.md`: разбор без кода
  или draft PR). Сверх `ALERT_AUTOFIX_PER_DAY` (3) issue с `alert` за 24 ч — метка `alert-queued`, без автозапуска.
  Напоминание о той же тревоге — комментарий «повтор: …» в открытый issue с маркером (ищется среди открытых issue с
  `alert` или `alert-queued`, все страницы, до 1000); закрытый issue заново не заводится. Метки
  `alert`, `alert-queued`, `alert-no-code`, `alert-pr` код создаёт при первом issue. Ссылка на issue — строкой под
  тревогой в Telegram. Сбой GitHub не мешает уведомлению и `alert_state` — `warn monitor.github` (текст записи —
  `githubWarnings`). GitHub недоступен в момент новой тревоги — issue по ней не появится до её следующего возникновения
  (после «восстановлено»): напоминания issue не заводят. Без токена
  монитор работает как раньше.
- Свободное место в базе (spec 0021, `features/db-space`, `src/app/server/dbSpace.ts`): тот же cron замеряет размер
  базы (`getDbUsage`: `pg_database_size` и топ таблиц по `pg_total_relation_size`; на этапе 3 миграции меняется только
  она) относительно `DB_SIZE_LIMIT_MB` (500) и шлёт одно сообщение на каждый порог свободного места 50/40/30/20/10/5 %
  (за прогон — о самом низком); свободно больше «порог + 2 п.п.» — порог перезаряжается. Состояние — `alert_state`
  (`db.space.<N>`, статусы `sent`/`cleared`; общий модуль `src/app/server/alertState.ts`), сбой замера не ломает
  монитор (`dbSpace: { error }`).
- Бот `@binance_dashboard_gold_bot` отвечает владельцу (`TELEGRAM_CHAT_ID`) на `/db` (место в базе) и `/start`, `/help`
  (список команд): `POST /api/telegram/webhook` → `src/app/server/telegramBot.ts`; чужие чаты — без ответа, warn
  `telegram.foreign`. Webhook и меню команд — `pnpm telegram:setup` (`--delete` — снять; пока webhook включён,
  `getUpdates`/`pnpm monitor:supabase chat-id` не работают).
- Каждый API-роут обёрнут `withLogging` (`shared/lib/route.server.ts`): непредвиденная ошибка →
  JSON `{ error }` (502 — сбой внешнего сервиса, 500 — наш), стек в журнале.
- Ошибки браузера уходят в `POST /api/logs`. Страница `/logs` показывает журнал; фильтры — в URL и в
  `GET /api/logs`: `level`, `event` (список через запятую), `experiment` (`data->>'experimentId'`), `days` (1…14)
  — `entities/log-entry/model/filters.ts`. Демо-зеркало пишет каждый отказ/пропуск отдельной записью
  `mirror.rejected` / `mirror.skipped` с `experimentId` (spec 0016).

## Рассинхрон версий клиента (spec 0036)
- Версия сборки — `deploymentId` в `next.config.ts`: `NEXT_DEPLOYMENT_ID`, иначе `VERCEL_DEPLOYMENT_ID` (id деплоя, задаёт
  Vercel); локально не задана — механизм выключен. Next ставит `data-dpl-id` на `<html>` и при навигации после деплоя сам
  делает полную перезагрузку. Но вкладка, которую не трогают, продолжает опрашивать API старым JS: новый контракт (как
  `futures` → `usdm` в spec 0023) валит её Zod-схемы.
- Версии: сервер — `getDeploymentVersion()` (`shared/config/env.server.ts`), страница — `getPageVersion()`
  (`shared/lib/client`; Next снимает `data-dpl-id` сразу при загрузке и подставляет значение вместо
  `process.env.NEXT_DEPLOYMENT_ID`), сравнение — `isStaleVersion` (обе заданы и различаются).
- `GET /api/version` → `{ version }`; `useNewVersionAvailable` (`widgets/app-header`) опрашивает раз в 5 мин и при возврате на
  вкладку, только если версия страницы задана. Новая версия — плашка «Вышла новая версия — Обновить» в шапке; сама страница
  не перезагружается (не теряется ввод), «Обновить» — `window.location.reload()`.
- `reportClientError` шлёт `version`; `POST /api/logs` пишет ошибку вкладки со старой сборкой как `warn client.stale`
  (`clientVersion`, `serverVersion`) — монитор журнала считает всплески только по `level=error`, тревоги нет. Ошибки клиента
  текущей версии и без версии — `error client`, как раньше.
- Проверять механизм — прод-сборкой (`VERCEL_DEPLOYMENT_ID=… pnpm build && pnpm start`): в `next dev` с заданной версией
  бывают ложные перезагрузки из-за перекомпиляции.

## Данные на диске
`data/` в `.gitignore`: `snapshots/` (снимки Earn), `logs/`, `pglite/` (локальная БД).
Кэш истории Binance для бэктеста (`pnpm lab:backtest`, spec 0032) — вне репозитория: `~/.cache/binance-dashboard`
(свечи и funding по месяцам, общий для всех worktree; `--cache <каталог>` — другой). В БД свечи не хранятся.
`private/` в `.gitignore` — клон приватного репозитория (см. «Приватные эксперименты»).

## Приватные эксперименты (spec 0015)
Репозиторий публичный. Принцип: **движок и строительные блоки стратегий — публичные (`trading-core`, движок,
экраны), «рецепты» и результаты — приватные.**
- Приватные данные — в отдельном приватном репозитории `aleksabramov77/binance-dashboard-private`, клон — в
  игнорируемой папке `private/` основного checkout
  (`git clone git@github-personal:aleksabramov77/binance-dashboard-private.git private`). Worktree получает на неё
  ссылку (`pnpm wt new` / `pnpm wt link`, список `.claude/worktree-links.json`). Содержимое: `experiments.json`
  (эксперименты), `lab/` (анализы `/flow lab`), `README.md`.
- `private/experiments.json` — массив в формате каталога (`experimentSchema` из `trading-core`): `id`, `market`,
  `name`, `hypothesis`, `config`; необязательные `initialBudget` (10 000), `enabled` (`true`), `demoMirror` (`false`).
  id — `P` + буква группы + номер: `PS01` (spot), `PF01` (usdm), `PC01` (coinm, spec 0023; `demoMirror: true` для него —
  ошибка: демо-зеркало COIN-M позже); с id каталога (`S..`, `F..`) не пересекается.
- `pnpm lab:private [--dry-run] [--prod] [--file <path>]` (`scripts/lab-private.ts`, чистая логика и тесты —
  `scripts/lib/labPrivate.ts`): проверяет файл целиком (схема, лишние поля, префикс ↔ рынок, повторы, пересечение
  с каталогом) до подключения к БД, печатает цель (хост Postgres без пароля или «локальная PGlite») и план
  («новый» / «обновится» / «без изменений»), затем пишет новые и изменённые эксперименты через `seedExperiments`
  в одной транзакции. БД — как у `pnpm db:migrate`: `DATABASE_URL` из `.env.local`, без неё — PGlite (её скрипт
  мигрирует сам; прод мигрирует деплой). `enabled`, `demoMirror`, `initialBudget` пишутся только при вставке —
  тумблеры `/settings`, бюджеты и сделки повторный запуск не трогает.
- **Защита прода:** цель Postgres (задан `DATABASE_URL`) — это прод; запись туда только с явным `--prod`
  (`pnpm lab:private --prod`). Без него скрипт печатает цель и план, объясняет, как писать, и выходит с ошибкой —
  в БД ничего не пишется (`decideLabPrivateWrite`). `--dry-run` работает без `--prod`, для PGlite `--prod` не нужен.
  В worktree `.env.local` — ссылка на основной checkout с прод-`DATABASE_URL`, а локальный сервер worktree работает
  на `data/pglite`: чтобы эксперимент появился на нём — `pnpm wt stop` → `DATABASE_URL= pnpm lab:private` →
  `pnpm wt serve`.
- Дальше приватный эксперимент живёт только в таблице `experiments`: движок (VM и Edge Function), `/experiments`
  и `/experiments/[id]` (id вне каталога рендерятся по запросу) работают с ним как с экспериментом каталога. Сид
  каталога на тике делает upsert только своих id и приватные строки не трогает (тест в `engineTick.test.ts`).
  Vercel, CI и Edge Function файлы `private/` не нужны. Удаление из БД — вне scope: выключение тумблером.
- Параметры, гипотезы и результаты приватных экспериментов не пишутся в публичные файлы, spec, коммиты, описания
  PR и issue (правило — `conventions.md` → «Приватные эксперименты»).

## База данных (spec 003, задача 2a)
- Postgres через Drizzle ORM. `src/shared/db/client.server.ts` — доменно-нейтральное подключение:
  `getDb`, `migrateDb`, `closeDb`, `createMemoryDb` (тесты). Только сервер. Схемы в клиент не
  передаются: запросы явно указывают таблицу (`db.select().from(experimentsTable)`).
- Таблицы живут в слайсах своих доменов — `src/entities/<сущность>/model/db.ts` (лаборатория:
  `experiments`, `runs` — эпохи сброса, `paper_trades`, `engine_state`, `skipped_signals`) и экспортируются через public API
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
