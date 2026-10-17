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
| Лаборатория экспериментов | ядро `packages/trading-core` (`@binance-dashboard/trading-core`: индикаторы, схемы, стратегии, выходы, sizing, исполнение), `entities/experiment` (фасад ядра, UI стратегий, бюджеты по рынкам (`computeMarketBudgets`, `useExperimentBudgets`), группы активов AG — `model/assetGroup.ts` (`spot` / `usdm` / `coinm`, вид группы `kind`, доступность демо-зеркала; spec 0023), демо-метрики — `computeDemoStats`), `features/paper-engine` (тик движка, юниверс, кэш свечей, каталог 40 экспериментов, интерфейс `ExperimentStore`; среда-независимый — Node и Deno, задача 1d), `features/engine-toggle` (тумблер «Автоторговля» в хедере и в `/settings` → Paper: подтверждение в модалке с числом открытых позиций — `readEngineExposure`, `GET /api/experiments/engine/exposure`; журнал `engine.toggle` с логином и Telegram — `src/app/server/engineToggleNotice.ts`, spec 0044), `features/experiment-toggle` (тумблер «вкл/выкл» эксперимента с окном выключения — причина, галочка для контрольного с включёнными вариантами; в `/settings`, в колонке «Вкл» таблицы `/experiments` и в шапке страницы эксперимента, spec 0046, 0050), `features/demo-mirror` (зеркало в Binance Demo, spec 008; переключатель «Выкл · Авто · Вкл» — `features/demo-mirror-toggle`; биржу и БД передаёт `src/app/server/demoMirror.ts`; резерв демо-кошелька — `MIRROR.minFreeUsd`, spec 0043), авто-зеркало (spec 0043: правило и тексты — чистые функции `entities/experiment/lib/{decideMirrorAuto,mirrorAutoMessages}.ts`, пороги — `entities/experiment/config/mirrorAuto.ts`, БД — `entities/experiment/api/mirrorAutoDb.ts`, композиция — `src/app/server/mirrorAuto.ts`), `pages/{experiments,experiment-detail,stats,settings}` (сброс эпохи и настройки — `entities/experiment/api/settingsDb.ts`, `features/paper-engine/model/planReset.ts`; сброс группы активов — `resetGroupRun` / `resetGroupCapital` / `resetGroupDemo`, карточка `/settings#groups`, spec 0038; агрегаты сделок — `entities/experiment/lib/stats.ts`, разрезы `/stats` — `entities/experiment/lib/slices.ts`; период страниц — текущая эпоха, прошлая или «Все эпохи» `?run=all` — `resolveScope`/`scopeTrades` в `entities/experiment/api/readModel.ts`, выбор — `ui/RunSelect`; варианты и контрольный — `lib/variants.ts`, сравнение настроек — `lib/configDiff.ts`, причина выключения — `model/disable.ts` + `ui/DisabledBadge`, spec 0046); запись приватных экспериментов в БД — `scripts/lab-private.ts` + `scripts/lib/labPrivate.ts` (`pnpm lab:private`, spec 0015); бэктест по истории — `scripts/lab-backtest.ts` + `scripts/lib/{labBacktest,labHistory}.ts` (`pnpm lab:backtest`, spec 0032; повтор `runTick`, дисковый кэш свечей вне git); реальный счёт (spec 0047) — `entities/live-account` (пульс воркера: схема, последний пульс в БД, состояние), карточка `pages/settings` → `LiveAccountCard`, воркер `scripts/live-worker.ts` + `scripts/lib/liveWorker.ts` (`pnpm live:worker`, бандл `pnpm live:build`), композиция `src/app/server/liveAccount.ts`; реальное зеркало (spec 0049) — лимиты, проверки входа (`createLiveGate`), PnL по исполнениям и тексты — `entities/live-account/{config,lib}`, хранилище — `entities/experiment/api/liveMirrorDb.ts`, Real-колонки `/experiments` (spec 0054) — метрики `computeLiveStats` (`entities/experiment/lib/liveStats.ts`) по строкам `liveSummaries` (`liveMirrorDb.ts`), поле `live` ответа `GET /api/experiments`, контракт воркер ↔ приложение — `entities/experiment/model/liveMirrorApi.ts`, переключатель, полоса и аварийный стоп — `widgets/live-trading`, прогон в воркере — `scripts/lib/liveMirrorRun.ts` (`runMirror` из `features/demo-mirror` + `features/execute-trade` на площадке Live), композиция — `src/app/server/liveMirror.ts` | `/api/experiments/*` (в т.ч. `/api/experiments/stats`, `/api/experiments/settings/mirror`, `/api/experiments/reset/group`), `/api/cron/tick`, `/api/cron/demo-mirror`, `/api/cron/mirror-auto`, `/api/live/heartbeat` (пульс воркера, Bearer `LIVE_WORKER_SECRET`), `/api/live/mirror/{state,claim,skip,open,claim-close,close,legs,close-all,reconcile}` (хранилище реального зеркала для воркера, тот же Bearer), `/api/live/status` (карточка и торговля), `/api/live/halt` (аварийный стоп), `/api/experiments/settings/live` (переключатель «Реальный счёт») | таблицы `experiments`, `runs`, `paper_trades` (с контекстом входа и MAE, spec 0030), `engine_state`, `demo_mirror_orders`, `skipped_signals` (отсечённые лимитом сигналы, spec 0030; объём ограничен движком), `live_worker_state` (последний пульс воркера реального счёта и состояние для уведомлений, spec 0047), `live_mirror_orders` (реальные сделки зеркала: свои ордера, объём, цены, комиссии и PnL по исполнениям; одна активная позиция на монету — уникальный индекс, spec 0049), `live_trading_halt` (аварийный стоп), `experiments.live_mirror` (+ кто и когда переключил) |
| ИИ-кредиты | `entities/ai-credits` | `/api/openrouter/*` | — |
| Платформа (не домен) | `app/*`, `src/app/server/*` (в т.ч. `auth.ts`, `accountBalances.ts`), `proxy.ts`, `widgets/app-header` (в т.ч. «Счета» — чипы групп Paper / Demo / Real, spec 0038; Real — торговый субсчёт по пульсу воркера, spec 0047), `entities/account-balance` (остатки Demo и Real по группам), `pages/{logs,login,help}`, `entities/log-entry` (таблицы `app_logs`, `alert_state`), `features/log-monitor` (монитор журнала → задача в GitHub → Telegram), `features/db-space` (свободное место в базе: пороги, тексты бота), `src/app/server/{logs,logMonitor,alertState,dbSpace,telegramBot}.ts`, `features/auth` (вход, `UserMenu`), `shared/lib/auth/*` (`accessPolicy`, `cronAuth.server`), `shared/api/github` (REST: issues, метки, комментарии), `.claude/routines/alert-triage.md` (routine разбора тревог), плашка новой версии (`widgets/app-header`: `NewVersionBanner`, `useNewVersionAvailable`; `shared/lib/client` — версия страницы и `reportClientError`, spec 0036), прочий `shared/*` | `/api/accounts/balances` (кэш 60 с), `/api/logs` (фильтры `level`/`event`/`experiment`/`days`), `/api/version`, `/api/cron/log-monitor`, `/api/telegram/webhook`, `/api/auth/*`, страница `/login`, страница `/help` (глоссарий из `docs/ai/glossary.md` через `pnpm glossary`) | таблицы `app_logs`, `alert_state`; локально ещё `data/logs`; подключение к БД |

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
  (`experimentEngine.ts`) и Edge Function `supabase/functions/engine-tick` (Deno): блокировка тика (с spec 0059 — в
  памяти процесса; Edge Function после переезда базы в SQLite не используется),
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
  `warn`; остальные группы торгуют.
- Демо-зеркало COIN-M (spec 0056) — на `demo-dapi.binance.com` (`DEMO_MIRROR_MARKETS` = spot, usdm, coinm; реальный счёт —
  свой `LIVE_MIRROR_MARKETS` = spot, usdm). Площадка демо знает рынок `coinm` (`shared/api/binance/venue.server.ts`): правила
  с размером контракта и монетой маржи, режим позиций — свой, стоп и тейк — условные ордера `/dapi/v1/order` (не algo, как у
  fapi; `coinmOrders.ts` приводит их к виду algo-ордера). Количество на бирже — контракты, сделка и строка зеркала — в монете
  (контракты × размер / вход, как paper); контракты и размер — в `protect_refs`. Резерв — $50 свободной маржи в монете
  контракта (`MIRROR.coinmMinFreeUsd`), а не $500 на кошелёк.

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
- Binance реальный счёт (торговый субсчёт, spec 0047) — ключ `BINANCE_TRADE_API_KEY/SECRET` только у воркера на VM,
  клиент `shared/api/binance/live.server.ts` с белым списком запросов (сейчас только чтение).
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
- Без сессии открыты только `/login`, `/api/auth/*`, `/api/cron/*`, `/api/telegram/*`, маршруты воркера реального
  зеркала `/api/live/mirror/*` (поштучно, тот же секрет, spec 0049) и точный путь
  `/api/live/heartbeat` (пульс воркера реального счёта: `Authorization: Bearer $LIVE_WORKER_SECRET`, проверка
  `checkCronAuth` — без секрета или с неверным 401, в production без `LIVE_WORKER_SECRET` 503). Cron защищён своим секретом:
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
  базы (`getDbUsage`, spec 0059: занято — файл SQLite с `-wal`, лимит — занято + свободное место на диске базы по
  `statfs`; топ таблиц с индексами — виртуальная таблица `dbstat`, нет её — без топа) и шлёт одно сообщение на каждый
  порог свободного места 50/40/30/20/10/5 %
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
- Авто-зеркало (spec 0043, `POST /api/cron/mirror-auto`, pg_cron `mirror-auto` в 07:00 UTC — ставит
  `pnpm mirror:supabase cron-install-auto`, ручной запуск — `pnpm mirror:supabase auto [--dry-run]`): положение
  `experiments.demo_mirror_mode` (`auto` / `on` / `off`), флаг `demo_mirror` по-прежнему читает зеркало. В «Авто» правило
  включает и выключает флаг, ручные положения не трогает — только подсказка (последняя — `demo_mirror_advice`, без
  повторов, пока условие держится). Каждое изменение — `info mirror.auto`, подсказка — `info mirror.advice` с
  `experimentId` и сообщение в Telegram (только `NODE_ENV=production`; локальный сервер и скрипты — только журнал).
  Перевод в «Авто» из UI или `lab:apply --mirror-auto` сразу решает по правилу для эксперимента.

## Реальное зеркало (spec 0049)
- Эксперимент с включённым «Реальным счётом» (переключатель в `/experiments`, режимы — spec 0053 ниже; «Вкл» — модалка со словом «РЕАЛ», только
  при ключе «✅», не COIN-M) повторяет свежие paper-входы на торговом субсчёте. Ордера отправляет только воркер; у него
  нет БД — кандидаты, захват, итоги входов и закрытий, лимиты и стоп идут через `/api/live/mirror/*`
  (`src/app/server/liveMirror.ts`, тела — Zod `liveMirrorApi.ts`).
- Прогон после принятого пульса: досылка неотправленных итогов прошлых прогонов (outbox) → сверка «потерянных» входов →
  «Закрыть всё» (если запрошено и Binance принимает ключ — даже при заблокированном
  ключе) → ключ не «годится» — дальше ничего → иначе `runMirror` (`features/demo-mirror`) с `LIVE_MIRROR_POLICY` (одна
  позиция на монету) и `gate` (`createLiveGate`): стоп входов, 5 позиций на субсчёт, дневной лимит −$15 **на
  эксперимент** (реализованный PnL за сутки UTC), режим фьючерсов One-way, объём $10 (до минимума биржи ≤ $50,
  `sizeEntry`, после подъёма для стопа спота — снова не больше $50), плечо `LIVE.leverage`, свободные USDT. Всё — до
  захвата и до биржи; не прочитали — кандидат ждёт (fail-closed).
- Захват (`/claim`) атомарен: строка `pending` с уникальным индексом по монете; стоп входов и «включён ли» эксперимент
  перечитываются в БД перед каждым входом. Пропуск — одна вставка `skipped` (`/skip`).
- Вход и защита — `placeTrade` с площадкой Live (спот OTOCO/OTO, фьючерсы плечо 1, изолированная маржа, algo TP/SL на
  свой объём), неизвестный исход — как у демо (`orderOutcome.ts`, перечитывание по `clientOrderId`). `clientOrderId`
  реальной сделки детерминированный: `bd<seed>-…`, seed — `liveOrderSeed(id paper-сделки)` (sha256, 24 символа;
  `placeTrade(req, ctx, { tradeId })`), у демо — по-прежнему случайный. Закрытие — `closeDemoPosition` с площадкой,
  сверка ног — `sweepTriggeredLegs`; цена выхода, комиссии и PnL — по исполнениям **своих** ордеров сделки (`fillsPnl` с
  `orderIds`: вход, свои TP/SL, своё закрытие — найдены по своим `clientOrderId`), чужие исполнения монеты не входят.
  Исполнения не прочитаны или свои ордера не найдены — PnL **оценка** по ценам входа и выхода с комиссией taker
  (spot 0,1%, USDⓈ-M 0,05%), `pnl_estimated`, «≈ … (оценка)» в Telegram: в дневной лимит идёт оценка, а не 0. Цена
  выхода неизвестна (биржа закрыла по TP/SL) — худший разумный случай: цена своего стопа (`stop_loss`, сохраняется при
  входе), иначе текущая цена символа.
- Итог не теряется: ордер на бирже прошёл, а `POST /api/live/mirror/{open,close,legs,reconcile}` не дошёл — ещё две
  попытки с паузой (1 и 3 с), потом итог в outbox в памяти воркера; следующий прогон досылает его первым, до новых
  решений.
- Сверка «потерянного» входа: строка `pending` дольше `LIVE_PENDING_STALE_S` (3 мин: воркер упал между ордером и
  итогом, outbox потерян с процессом) приходит в `stalePending` состояния; воркер ищет свои ордера по `clientOrderId`
  (`reconcileEntry`, `/reconcile`): вход и свой стоп стоят — позиция открыта (свой стоп или тейк уже сработал — тоже
  открыта: закрытие распознает «закрыта биржей», без ложной ⚠️); вход есть, стопа нет — «без защиты» (⚠️,
  очередь закрытия; стоп не перевыставляется — позиция закрывается); входа нет — пропуск с причиной; биржа не ответила —
  повтор следующим прогоном. Сверка — до «Закрыть всё», поэтому «Закрыть всё» захватывает найденные позиции в том же
  прогоне и не ждёт `pending` дольше ~3 мин.
- Итоги идемпотентны и по сообщениям: строка меняется только из ожидаемых статусов (вход — из `pending`), повтор того
  же итога (ответ потерялся, досылка outbox после сверки) не пишет журнал и не шлёт Telegram.
- Журнал `live.*` с `experimentId` (вход, выход, пропуск, лимит, стоп, ошибки); Telegram — вход, выход с PnL, «без
  защиты», дневной лимит (один раз за сутки на эксперимент), стоп и возобновление, итог «Закрыть всё» — только в
  production.
- Аварийный стоп (`live_trading_halt`): «Стоп входов» / «Возобновить», «Закрыть всё» — в карточке `/settings#live-stop` и
  в полосе над таблицей `/experiments`. «Возобновить», пока идёт «Закрыть всё», — 409, кнопка отключена. «Закрыть всё» держится, пока на субсчёте есть реальные позиции (итог прогона —
  `remaining`, `runs`), карточка и полоса показывают «закрытие идёт: осталось N».
- Закрытия повторяются сами: не закрылось (`close_failed`), позиция без защиты (`unprotected`) или «закрывается» дольше
  5 минут (прогон оборвался) — строка в очереди каждого прогона, не чаще раза в минуту (`LIVE_CLOSE_RETRY_PAUSE_S`); при
  429/418 запрос не уходит — пауза на хост общая. Порядок закрытия общий с демо: сначала снимаются свои TP/SL (на споте
  OCO держит монеты), потом выход по рынку; выход не прошёл после снятия — `protectionRemoved`, строка «без защиты»,
  ⚠️ в Telegram, повтор каждый прогон. Позиция, раз оставшаяся без защиты, помнит это (`no_protection`): повторная
  неудача не понижает её до `close_failed`. Telegram о неудаче — один раз на позицию, успех — «закрыта после N попыток».
- PnL — по проданной части; нераспроданный остаток спота (комиссия в монете и шаг) в PnL не входит: `leftover_qty`,
  `leftover_usd`, строка в `live.exit`, Telegram и «Последних закрытиях» карточки.
- Рукопожатие пульса — явное поле `handshake: true` (воркер ставит его только в ветке «ждём UID основного счёта»).

## Режимы реального счёта «Авто» и «Вкл + автовыкл» (spec 0053)
- Переключатель «Выкл · Авто · Вкл · Вкл + автовыкл» (`widgets/live-trading/ui/LiveMirrorToggle` + `LiveModeDialog`):
  положение — `experiments.live_mirror_mode`, флаг `live_mirror` по-прежнему читают воркер и захват. Всё, кроме «Выкл», —
  модалка со словом «РЕАЛ» при ключе «✅»; «Авто» и «Вкл + автовыкл» — с порогами (`live_loss_limit_usd`, по умолчанию
  $15, Zod 1–1000; `live_loss_streak`, 5, Zod 1–50; `entities/experiment/config/liveAuto.ts`). Активное «Авто» /
  «Вкл + автовыкл» — модалка только порогов (флаг и окно не меняются). API — `POST /api/experiments/settings/live`
  `{ id, mode, confirm?, thresholds? }` (`setLiveMode` в `src/app/server/liveMirror.ts`).
- Правило — чистые функции `entities/experiment/lib/liveAuto.ts`: R демо-сделки (`demoTradeR`: (выход − вход демо) ×
  знак ÷ |вход − исходный стоп| paper-сделки), пороги (`liveThresholdVerdict`: PnL с `live_mirror_since` ≤ −$ или N
  убыточных подряд; PnL неизвестен — убыток в серии, в сумме — по своему стопу `stop_loss`, иначе 0), «Авто» по демо
  (`liveDemoVerdict`: выключен — ≥ 30 демо-сделок окна со средним R > 0; включён — средний R последних 30 < 0) и план
  (`planLiveAuto`). Тексты — `entities/live-account/lib/liveAutoMessages.ts`.
- Окно демо: включение — после `demo_mirror_since`, `demo_reset_at` и начала эпохи; обратный порог — после сброса демо и
  начала эпохи (выключение демо-зеркала автоматом 0043 не прячет убыток от «Авто»). Выход демо — цена выхода демо,
  иначе paper (как сводка демо).
- Пороги — атомарно в сохранении закрытия (`closeLiveWithAuto`: закрытие строки, чтение эксперимента `for update`,
  решение и запись — одна транзакция; вызывают `saveLiveClose` и `saveLiveLegs`). «Авто» и «Вкл + автовыкл» → «Выкл»
  (`live_auto_off_at`, `live_auto_off_reason`, `live_mirror_by = автомат`), ручное «Вкл» — подсказка (`live_mirror_advice`,
  без повторов, пока условие держится). Открытые позиции доживают.
- «Авто» по демо — `runLiveAuto` (`src/app/server/liveAuto.ts`): раз в сутки вместе с авто-зеркалом
  (`/api/cron/mirror-auto`, таймер `mirror-auto` VM) и сразу при переводе в «Авто». Снимок решения —
  `live_mirror_auto` (подпись «Авто · ждёт: N из 30 демо-сделок», «Авто · демо R < 0»). «Выкл» (и после автовыключения)
  автомат не трогает; ручное «Вкл» не меняет никогда. Сбой по эксперименту — `warn live.auto`, ничего не меняется.
- «Стоп входов» и негодный ключ главнее режима: автомат переключает положения, но входов нет; автовключение при стопе
  помечено в Telegram. Журнал — `live.auto` (решение с числами), `live.advice` (подсказки, PnL неизвестен); Telegram —
  только production.
- Сверка «потерянного» входа передаёт цену своего стопа (`stopLoss` в `/reconcile`: `triggerPrice` algo-ордера,
  `stopPrice` спота); нет — приложение берёт исходный стоп paper-сделки.

## Воркер реального счёта (spec 0047)
- Отдельный Node-процесс `scripts/live-worker.ts`: единственный, у кого есть торговый ключ субсчёта. Входящих соединений
  не принимает, базу не открывает (только API приложения) и Telegram не знает; журнал — только stdout/stderr (`disableLogFiles()` в логгере: файлов
  `data/logs` нет, приёмник БД не подключён). Env: `BINANCE_TRADE_API_KEY`, `BINANCE_TRADE_API_SECRET`,
  `LIVE_WORKER_SECRET`, `LIVE_APP_URL`; локально подхватывает `.env.local` из текущего каталога.
- Цикл раз в минуту (`scripts/lib/liveWorker.ts`, `runCheck`): права ключа (`apiRestrictions`) при старте и каждые
  10 мин, пока ключ заблокирован — каждый цикл; при годном ключе — аккаунт Spot (UID, остатки, equity по публичным
  ценам), UID против основного счёта (UID основного присылает приложение в ответе на пульс, по read-only ключу), при
  `enableFutures` — аккаунт USDⓈ-M. Заблокирован — дальше проверки прав на биржу не ходит. Ошибка биржи — в поле
  `error` пульса, оценка не снимается.
- Пульс: `POST ${LIVE_APP_URL}/api/live/heartbeat` (схема `liveHeartbeatSchema`), ответ — `{ ok, verdict, mainAccount }`.
  Приложение хранит последний пульс в `live_worker_state`; смена оценки (годится ↔ заблокирован ↔ ключ не задан) — одна
  запись `live.status` и одно сообщение Telegram (только в production и не для фикстур). «Молчит» (нет пульса дольше
  `LIVE_SILENT_AFTER_SEC`, по умолчанию 5 мин) ловит монитор журнала: правило `live:silent` без напоминаний
  (`repeat: false`) + запись `live.status`; вернулся — запись «снова на связи», «Восстановлено» шлёт монитор. Пока пульса
  не было ни разу, правило не срабатывает.
- Команды: `pnpm live:worker` (цикл), `--once` (один пульс, код 1 — не принят), `--fixture ok|blocked|main-account`
  (готовый пульс без биржи; отказ, если задан торговый ключ или `LIVE_APP_URL` не localhost/127.0.0.1; production
  фикстуры не принимает), `--venue demo` (зеркало на демо-счёте для локальной проверки; отказ при `NODE_ENV=production`,
  при любом заданном `BINANCE_TRADE_*` и при `LIVE_APP_URL` не localhost/127.0.0.1 — защита не зависит от `NODE_ENV`;
  запросы помечены заголовком `x-live-venue`, production-приложение отвечает на него 400).
- Остановка: SIGTERM/SIGINT посреди цикла не обрывает его — новых входов нет (`stopRequested`), начатое доделывается,
  выход по концу цикла, но не позже `STOP_GRACE_MS` (90 с). Неотправленный outbox при выходе — ошибка в журнале
  (строки останутся `pending` и сверятся после перезапуска). `TimeoutStopSec` unit должен быть больше 90 с — 120.
- Бандл для VM: `pnpm live:build` → `dist/live-worker.mjs` (esbuild, ESM, target node22, все зависимости внутри,
  версия = версия пакета + коммит). `dist/` в `.gitignore`.
- Установка на VM (делает сессия «Migration to AWS», `scripts/server/add-project.sh binance-live --no-web`): пользователь
  и сервис `binance-live`, env — `/etc/binance-live/app.env` (640, только для пользователя воркера), исходящие —
  `api.binance.com`, `fapi.binance.com` и хост `LIVE_APP_URL`. Unit (примерно):
  ```ini
  [Unit]
  Description=Binance Dashboard — воркер реального счёта
  After=network-online.target
  Wants=network-online.target

  [Service]
  User=binance-live
  EnvironmentFile=/etc/binance-live/app.env
  WorkingDirectory=/opt/binance-live
  ExecStart=/usr/bin/node /opt/binance-live/live-worker.mjs
  Restart=always
  RestartSec=10
  # Воркер на SIGTERM доделывает текущий цикл (до 90 с, STOP_GRACE_MS) — systemd не должен убить его раньше.
  TimeoutStopSec=120
  KillSignal=SIGTERM

  [Install]
  WantedBy=multi-user.target
  ```
  Проверка после установки: `sudo -u binance-live node /opt/binance-live/live-worker.mjs --once` → «Пульс принят»;
  журнал — `journalctl -u binance-live`.

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
`data/` в `.gitignore`: `app.db` (локальная база SQLite, у каждого worktree своя; spec 0059), `prod.db` (снимок прода —
`pnpm db:pull`), `import.db` (перенос из Supabase — `pnpm db:import-pg`), `snapshots/` (снимки Earn), `logs/`.
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
  `name`, `hypothesis`, `config`; необязательные `initialBudget` (10 000), `enabled` (`true`), `demoMirror` (`false`; `true` — ручное «Вкл» демо-зеркала, иначе
  «Авто», spec 0043), `parentId` и `variantNote` — вариант контрольного эксперимента и что в нём изменено (spec 0046:
  один уровень; родитель — в файле, каталоге или БД и сам не вариант, иначе `lab:private` отклоняет файл до записи).
  id — `P` + буква группы + номер: `PS01` (spot), `PF01` (usdm), `PC01` (coinm, spec 0023; `demoMirror: true` — с spec 0056,
  как у остальных групп); с id каталога (`S..`, `F..`) не пересекается.
- `pnpm lab:private [--dry-run] [--file <path>]` (`scripts/lab-private.ts`, чистая логика и тесты —
  `scripts/lib/labPrivate.ts`): проверяет файл целиком (схема, лишние поля, префикс ↔ рынок, повторы, пересечение
  с каталогом) до подключения к БД, печатает базу (`SQLite <путь>`) и план («новый» / «обновится» / «без изменений»),
  затем пишет новые и изменённые эксперименты через `seedExperimentsSync` одной транзакцией SQLite. База — как у
  `pnpm db:migrate`: `DATABASE_PATH`, по умолчанию `data/app.db` (скрипт мигрирует её сам) — в worktree это база
  сервера `pnpm wt serve` (остановить сервер: `pnpm wt stop` → запись → `pnpm wt serve`). `parentId`, `variantNote`
  обновляются, как `name`/`config`; `enabled`, `demoMirror`, `initialBudget` пишутся только при вставке — тумблеры
  `/settings`, бюджеты и сделки повторный запуск не трогает.
- **Прод** (spec 0059): база прода — файл SQLite на VM, скрипт с ноутбука в неё не пишет: `--prod` отказывает с
  подсказкой (`PROD_WRITE_HINT`, до подключения к базе). Запись в прод-базу из скриптов лаборатории — отдельная задача
  в очереди PRD; до неё новые приватные эксперименты в прод не попадают, тумблеры — на `/experiments` и `/settings`.
- Дальше приватный эксперимент живёт только в таблице `experiments`: движок (VM и Edge Function), `/experiments`
  и `/experiments/[id]` (id вне каталога рендерятся по запросу) работают с ним как с экспериментом каталога. Сид
  каталога на тике делает upsert только своих id и приватные строки не трогает (тест в `engineTick.test.ts`).
  Vercel, CI и Edge Function файлы `private/` не нужны. Удаление из БД — вне scope: выключение тумблером.
- Параметры, гипотезы и результаты приватных экспериментов не пишутся в публичные файлы, spec, коммиты, описания
  PR и issue (правило — `conventions.md` → «Приватные эксперименты»).

## База данных (spec 003, задача 2a; SQLite — spec 0059)
- SQLite через Drizzle ORM (`better-sqlite3` + `drizzle-orm/better-sqlite3`). `src/shared/db/client.server.ts` —
  доменно-нейтральное подключение: `getDb`, `getDbPath`, `migrateDb`, `closeDb`, `openSqlite`, `migrateSqlite`,
  `createMemoryDb` (тесты: база в памяти). Только сервер. Схемы в клиент не передаются: запросы явно указывают таблицу
  (`db.select().from(experimentsTable)`).
- Таблицы живут в слайсах своих доменов — `src/entities/<сущность>/model/db.ts` (лаборатория:
  `experiments`, `runs` — эпохи сброса, `paper_trades`, `engine_state`, `skipped_signals`) и экспортируются через public API
  сущности. Внешние ключи и джойны — только внутри домена.
- Подключение: файл из `DATABASE_PATH` (на VM `/var/lib/binance/app.db`, локально по умолчанию `data/app.db`), одно на
  процесс; `journal_mode = WAL` (читатели не ждут писателя, `.backup` без остановки), `synchronous = FULL`,
  `busy_timeout = 5000`, `foreign_keys = ON`. На serverless (Vercel) приложение не стартует — файлу базы там негде жить.
  `DATABASE_URL` (Supabase) приложение не читает: он нужен только `pnpm db:import-pg` и `pnpm *:supabase`.
- Типы: время — целые миллисекунды UTC (`integer` `mode: "timestamp_ms"`, в коде `Date`; у журнала, снимков Earn и
  `alert_state` в коде ISO-строка — свой тип колонки `isoTimestamp`), деньги и цены — `real`, JSON — `text`
  `mode: "json"` (`->>` работает, слияние — `json_patch`), флаги — `integer` `mode: "boolean"`. В сыром SQL (шаблон `sql`) параметры
  не проходят через тип колонки: `Date` и `boolean` передавать числом (`getTime()`, 1/0) — better-sqlite3 их не
  принимает. Текущее время считает приложение (`new Date()`), не база.
- Транзакции синхронные (better-sqlite3): внутри `db.transaction((tx) => …)` — только `.all()/.get()/.run()`, без
  `await` и сети; асинхронный колбэк драйвер отклоняет. Атомарные шаги — сбросы капиталов (`settingsDb`), закрытие
  реальной сделки с автовыключением (`closeLiveWithAuto`) и `pnpm lab:private` — с `behavior: "immediate"` (блокировка
  записи сразу, вместо `SELECT … FOR UPDATE`).
- Блокировки тика (`withEngineTickLock`) и прогона демо-зеркала (`withMirrorRunLock`) — в памяти процесса
  (`entities/experiment/api/processLock.ts`, состояние в `globalThis`): база — файл одного процесса, второй вызов, пока
  идёт первый, получает `acquired: false`. Тик в одну транзакцию не завёрнут (в нём сеть): упал посередине — записанное
  остаётся, следующий тик продолжает с меток свечей. Воркер `binance-live` базу не открывает — ходит в API приложения.
- Перенос из Supabase — `pnpm db:import-pg --to <файл> [--force]` (`scripts/db-import-pg.ts`, логика —
  `scripts/lib/pgImport.ts`): 12 таблиц только чтением (READ ONLY, REPEATABLE READ — один снимок), новый файл с
  миграциями, все строки одной транзакцией, сверка числа строк и сумм PnL; расхождение — код 1, файл `.part` остаётся.
- Снимок прода для лаборатории — `pnpm db:pull [--out <файл>]` (`scripts/db-pull.ts`): по SSH на VM
  `sudo -u binance sqlite3 /var/lib/binance/app.db ".backup …"` → `data/prod.db`, `quick_check` до замены прежнего снимка.
  Адрес и ключ — `APPS_TOKYO_HOST`, `APPS_TOKYO_SSH_USER`, `APPS_TOKYO_SSH_KEY_FILE` (`.env.local`). `pnpm lab:report --prod`
  сначала скачивает снимок, затем строит отчёт по нему; без `--prod` — локальная база. `pnpm lab:apply` пишет только в
  локальную базу с `--local`, без него отказывает с подсказкой (прод — тумблеры на сайте).
- Движок лаборатории (задача 2b): хранилище — `createDbExperimentStore(db)` из `entities/experiment`
  (структурно = `ExperimentStore` движка), сид каталога (`seedExperiments`, upsert по id; `enabled`,
  `demo_mirror`, `initial_budget` пишутся только при вставке) и первая эпоха (`ensureRun`). Композиция —
  `src/app/server/experimentEngine.ts`: таймер раз в минуту (+5 с) из `instrumentation.ts` (singleton в
  `globalThis`, не в фазе build), блокировка тика общая с `POST /api/cron/tick`, кэш свечей в памяти
  процесса, публичные свечи/тикеры/funding (`premiumIndex`) без ключей. Роль раннера процесса —
  `ENGINE_RUNNER` (`oracle` по умолчанию); тумблер — `engine_state.enabled` (по умолчанию выкл),
  `GET/POST /api/experiments/engine {enabled}`.
- Хостинг прода (spec 0055): VM `apps-tokyo` — сайт, API, тик движка, фоновые задачи, бот Telegram, демо-зеркало;
  выкатка — `.github/workflows/deploy.yml` после зелёного CI на `main`. С spec 0059 база — файл SQLite на VM; Supabase
  (pg_cron и Edge Function `engine-tick` выключены) остаётся неделю для отката и отключается отдельной задачей (п. 24
  очереди PRD), Vercel — резерв без выкаток (с базой SQLite на нём не работает). Runbook переключения и отката —
  `docs/ai/deploy-lightsail.md`.
- Фоновые задачи (spec 0048) — кто и когда их запускает. При `engine_state.runner = supabase` (до переключения и при
  откате): pg_cron в Supabase вызывает роуты Vercel `/api/cron/{earn-snapshot,log-monitor,demo-mirror,mirror-auto}`
  (и тик — Edge Function). При `runner = oracle` (с переключения, spec 0055) их запускает своя VM таймерами процесса:
  `src/app/server/backgroundJobs.ts` из `instrumentation.ts`, только при `APP_HOST=vm` (на Mac и Vercel таймеров нет).
  Расписание UTC то же, что у pg_cron (`src/app/server/backgroundSchedule.ts`, тест сверяет с
  `supabase/migrations/*_cron.sql`): снимок Earn `0 3,15 * * *`, монитор журнала и места в базе `*/15 * * * *`,
  демо-зеркало `* * * * *` на 20-й секунде (после тика на 5-й), авто-зеркало `0 7 * * *`. Перед каждым запуском:
  не Vercel, `ENGINE_RUNNER` процесса = `engine_state.runner`, прошлый запуск этой задачи закончился — иначе
  пропуск без записей в БД; строка debug в консоли (journalctl) с причиной — только при смене состояния задачи
  (первый пропуск после старта или запуска, смена причины, «снова выполняется»). `engine_state.runner` не прочитан
  (БД недоступна) — пропуск «раннер неизвестен»: одна запись `warn` на серию, не `error` (spec 0055). Расписания
  разбираются один раз при старте (`scheduleJobs`). Сбой задачи — `log.error` с событием роута (`cron.earn`,
  `cron.monitor`, `cron.mirror`, `cron.mirror_auto`), процесс и другие задачи работают дальше. Логика общая с роутами;
  роуты остаются для pg_cron и ручного запуска. `engine_state.runner` не задан (новая пустая база при переключении на
  SQLite, spec 0059) — пропуск «runner не задан»: раннер по умолчанию совпал бы с ролью VM, и задачи заработали бы на
  пустых таблицах; runner приходит с переносом данных.
- Миграции — `drizzle/` (SQLite, заново с `0000_init.sql`; Postgres-миграции до spec 0059 — в истории git):
  `pnpm db:generate` собирает схемы из `src/entities/*/model/db.ts` (коммитятся).
  Применяются `pnpm db:migrate` и автоматически при старте сервера (`instrumentation.ts`); сбой БД
  пишется в журнал и не роняет дашборд.
