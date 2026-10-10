# 003 · Лаборатория торговых экспериментов (эпик)

- **Тип:** feature (эпик, разбит на задачи ниже)
- **Статус:** in-progress
- **Раздел PRD:** §3.4 «Авто-бот» → «Лаборатория экспериментов»
- **Дата:** 2026-10-10

## Торговое ядро — отдельный пакет (решение пользователя 2026-10-10)
Логика стратегий автономна: `packages/trading-core` (без UI, Next, кода приложения). UI сущности — только
в `src/entities/experiment`, без связей с авторизацией и другими дашбордами. Движок (1d) импортирует ядро
из `@binance-dashboard/trading-core`.

## Задачи эпика (каждая — свой worktree, ветка, PR)
| # | Задача | Ветка | База | Статус |
|---|---|---|---|---|
| 1a | Индикаторы `shared/lib/ta.ts` + схемы `entities/experiment` | `feat/003a-ta-schema` | main | ✅ #7 |
| 1b | Стратегии входа `features/paper-engine/lib/strategies.ts` + тесты | `feat/003b-strategies` | 1a | ✅ #8 |
| 1c | Торговое ядро `packages/trading-core` (перенос индикаторов, схем, стратегий) + выходы, sizing 0,5%, исполнение + тесты | `feat/003c-exits-sizing` | 1b | ✅ #13 |
| 1d | Тик движка, кэш свечей, юниверс, каталог 40 экспериментов, интерфейс хранилища | `feat/003d-engine` | 1c + 2a | PR #20 |
| 2a | БД: Drizzle, PGlite локально / Postgres по `DATABASE_URL`, схема, миграции | `feat/004a-db` | 1a | ✅ #9 |
| 2b | Репозиторий, сид каталога, движок пишет в БД, старт в `instrumentation.ts` | `feat/004b-db-engine` | 1d | PR #21 (база 1d) |
| 3a | Хедер: тоггл «Автоторговля» + бюджеты Spot/Futures | `feat/005a-header` | 2b | PR #22 |
| 3b | `/experiments` и `/experiments/[id]`, агрегаты `entities/experiment/lib/stats.ts`, API `GET /api/experiments[/id]` | `feat/005b-experiments-page` | 2b | PR (см. ветку); скриншоты `003-experiments-lab/screens/3b-*.png` |
| 3c | `/stats` — разрезы эксперимент/рынок/монета/направление | `feat/005c-stats` | 2b | — |
| 3d | `/settings` — сброс тестовых капиталов (новая эпоха) | `feat/005d-settings` | 2b | — |
| 3e | Удаление старых автосделок spec 002 с `/signals` | `feat/005e-remove-auto-trade` | 3a | PR #23 |
| 4 | Вход через GitHub (Auth.js, allowlist), `CRON_SECRET` | `feat/006-auth` | main | ✅ #10 |
| 5 | Резерв: деплой на Oracle Cloud Always Free (UAE East, Dubai) | `feat/007-deploy` | main | ✅ #12 (VM не создана) |
| 5b | **Основной хостинг**: Supabase — `binance-ping`, `engine-tick`, pg_cron, Vault (spec 007b, AC1–AC4) | `feat/007b-supabase` | main (ping) / 2b (тик) | spec ✅ #14; БД `binance-lab` (Tokyo) создана, миграции применены; AC1 ⏳ #19 (функция в Tokyo, статусы Binance ждут publishable key) |
| 5c | **Основной хостинг**: Vercel (hnd1) + GitHub OAuth App под `*.vercel.app` (spec 007b, AC5–AC6) | `feat/007c-vercel` | main | ✅ #18 (код); ждёт проект и токен Vercel от пользователя |
| 6 | Demo-зеркало лучших экспериментов | `feat/008-demo-mirror` | 2b | — |

**Требования к движку (1d, 2b) из резервного хостинга (spec 007b):** тик — среда-независимая функция
с внедряемыми зависимостями (свечи, хранилище, часы), без `node:*`, `process.env`, `fs` и таймеров: её
вызывают и `instrumentation.ts` (VM), и Edge Function Supabase (Deno). `trading-core` зависит только от `zod`.
В `engine_state` ключ `runner` = `oracle` | `supabase` — тик чужого раннера ничего не делает (сделки не
открываются дважды).

Ниже — утверждённый пользователем план (2026-10-10).


## Context
Ночной прогон автосделок (spec 002) убыточен: с 9.10 13:27 по 10.10 06:22 UTC закрыто 19 сделок, из них 2 в плюсе и 17 в минусе. Реализованный PnL −$40, комиссии $2,2; открыто 11 позиций с uPnL около +$18. 17 входов из 20 — шорты фьючерсов «после пампа». Наш сканер (`features/scan-market/lib/detectSetup.ts`) торгует только контртренд: стоп 0,8–3 ATR за экстремумом, цель — возврат к EMA20. На альтах импульс продолжается, и стопы выбивает.

Пользователь хочет:
- десятки параллельных экспериментов (20 на рынок) с разными входами и SL/TP, в том числе по своим сигналам и с фильтром монет;
- учёт по каждому эксперименту: бюджет, история сделок, статистика по эксперименту, рынку, монете и направлению;
- риск 0,5% стартового бюджета на сделку и сброс тестовых капиталов;
- работу 24/7 без своего Mac: облачная БД, VM и вход только для владельца;
- разгрузить /signals: перенести тоггл и бюджеты в хедер, добавить новые страницы.

Решения пользователя (2026-10-10):
- исполнение — paper-симуляция, лучшие эксперименты дублируются в Binance Demo;
- хостинг — Oracle Cloud Always Free VM в ЕС;
- вход — GitHub OAuth только для `aleksabramov77`;
- размер — риск 0,5% стартового бюджета, объём не больше 10% бюджета.

## Ключевые решения по архитектуре
- **Paper-брокер на нашей стороне.** Цены — публичные свечи Binance: spot `api.binance.com`, futures `fapi.binance.com` (`shared/api/binance/market.ts` → `fetchKlines`).
  - Вход по close свечи сигнала (по факту — по текущей цене тика) со слиппеджем 0,05%.
  - Комиссия: spot 0,1%, futures 0,05% (taker).
  - Выход проверяется по 1m-свечам, прошедшим с прошлой проверки. Если SL и TP задеты одной свечой, засчитывается SL (консервативно).
  - Для фьючерсов учитывается funding — во второй итерации, пока в README.
- **Эксперимент = декларативный конфиг** (Zod), он же хранится в БД:
  - `entry` — тип сигнала и параметры;
  - `exit`: стоп ATR / % / swing; TP по R:R или без TP; трейлинг-чанделье; безубыток после +1R; тайм-стоп в барах; выход по противоположному сигналу;
  - `universe`: majors / top-N по объёму / movers; blacklist; минимальный объём;
  - `timeframe`, `directions`, `maxOpen`.
  - Код стратегий — чистые функции в `lib`, на них Vitest-тесты.
- **Рынки:** Spot (только long) и USDⓈ-M Futures (long/short), по 20 экспериментов на рынок. «Другие» рынки (COIN-M, Margin) пока вне scope: paper-движок рыночно-агностичен, рынок добавляется как третий `market` с базой URL.
- **Бюджет:** у каждого эксперимента свой стартовый капитал (по умолчанию $10 000). Equity = старт + реализованный PnL − комиссии. В хедере — сумма по рынку (Spot / Futures).
  Реализация 3a: `pnl` закрытой сделки уже за вычетом комиссий; в equity хедера добавлен нереализованный PnL
  открытых позиций по последней цене (`ticker/24hr`, кэш 20 с; нет цены хоть у одной позиции — не учитывается,
  подсказка это показывает). API `GET /api/experiments/budgets`, хук `useExperimentBudgets` (раз в 30 с),
  тумблер — `features/engine-toggle` (оптимистично + инвалидация). Скриншоты: `docs/specs/003-experiments-lab/screens/3a-header-*.png`.
  - Сброс — новая «эпоха» (`run_id`): старые сделки остаются в БД, статистика по умолчанию показывает текущую эпоху.
- **Движок:** тик раз в минуту.
  - Свечи сигналов (15m/1h/4h) кэшируются по (market, symbol, tf). Стратегии вызываются только при закрытии новой свечи своего TF.
  - Один фетч на символ и TF общий для всех экспериментов, чтобы уложиться в rate limit.
  - Запуск: in-process таймер через `instrumentation.ts`, как сейчас, плюс `POST /api/cron/tick` с `CRON_SECRET` на случай внешнего крона.
- **БД:** Postgres + Drizzle ORM (`drizzle-orm`, `postgres` — драйвер postgres.js).
  - Прод — Supabase Free (ЕС): пишем постоянно, так что free-проект не засыпает.
  - Локально и в тестах — PGlite (`@electric-sql/pglite`, встроенный Postgres), если `DATABASE_URL` не задан. Пока Supabase не заведён, всё работает локально без внешних сервисов.
  - Миграции — `drizzle-kit`.
- **Таблицы:**
  - `experiments`: id slug, market, name, hypothesis (суть), config jsonb, initial_budget, enabled, demo_mirror, created_at;
  - `runs`: id, started_at, note — эпохи сброса;
  - `paper_trades`:
    - id, run_id, experiment_id, market, symbol, direction;
    - opened_at, entry_price, qty, stop, take_profit, trail_state jsonb;
    - closed_at, exit_price, exit_reason (tp/sl/trail/time/signal/manual), fees, pnl, r_multiple;
    - demo_order_ref nullable, signal_meta jsonb;
  - `engine_state`: key/value — enabled, last_tick, кэш, ошибки.
  - Старый `data/auto-trade.json` и автосделки spec 002 выключаются и удаляются (эпик E3): их заменяет движок экспериментов.
- **Auth:** Auth.js v5 (`next-auth@5`), GitHub provider.
  - Allowlist `AUTH_ALLOWED_GITHUB_LOGINS=aleksabramov77`.
  - Защита — в `proxy.ts`/middleware Next 16: все страницы и `/api/*`, кроме `/api/auth/*` и `/api/cron/tick` (у него Bearer-секрет). Перед кодом проверить API Next 16 в `node_modules/next/dist/docs/`.
  - Локально без `AUTH_SECRET` auth выключен: dev без лишних шагов, в проде он обязателен (fail-closed при `NODE_ENV=production`).
- **Деплой (Oracle Always Free, Ampere A1, регион UAE East (Dubai) — не ЕС и не США (санкционный комплаенс Binance + 451)):**
  - `scripts/deploy/`: cloud-init/`setup.sh` ставит Node LTS, pnpm, Caddy (HTTPS на `<ip>.sslip.io`, домен не нужен) и systemd-юнит `binance-dashboard.service`.
  - GitHub Actions `deploy.yml` на push в main: ssh → `git pull` → `pnpm i` → `pnpm build` → `drizzle-kit migrate` → restart.
  - Секреты — в `.env` на VM, в репо их нет.
  - Первая проверка на VM — `curl` к `fapi.binance.com/fapi/v1/ping` и `api.binance.com/api/v3/ping` (риск 451). Если блок — запасной план: другой регион Oracle или Hetzner €4.

## Каталог экспериментов (40)
Префикс `S` — spot (только long), `F` — futures (long и short). Набор строится по best practices: контрольная группа (случайный вход и buy&hold), тренд-фолловинг с ATR-трейлингом, mean reversion только по тренду старшего TF, пробои с объёмом, вариации SL/TP на одном входе (A/B выхода), фильтры монет.

**Spot**
- S01 — baseline: текущий сканер «отскок», текущие SL/TP.
- S02 — S01 + фильтр тренда: цена выше EMA200 на 4h.
- S03 — S01 с TP 2R и безубытком после +1R.
- S04 — EMA 9/21 cross на 15m + EMA200 1h; стоп 1,5 ATR; TP 2R.
- S05 — то же, выход трейлингом 3 ATR вместо TP.
- S06 — EMA 20/50 cross на 1h; трейлинг 3 ATR.
- S07 — Donchian-20 breakout на 1h + объём > 1,5× среднего; трейлинг 2 ATR.
- S08 — Donchian-55 breakout на 4h (turtle); трейлинг 3 ATR.
- S09 — RSI(2) < 10 выше SMA200 (Connors); выход при close > SMA5 или по тайм-стопу 10 баров.
- S10 — Bollinger lower touch + RSI14 < 30 в аптренде; TP — средняя линия BB.
- S11 — BB squeeze breakout; трейлинг 2 ATR.
- S12 — MACD hist cross вверх + EMA200; TP 2R.
- S13 — Supertrend(10,3) flip long; выход по flip.
- S14 — объёмный спайк (≥ 3×) + close у high; TP 1,5R; тайм-стоп 12 баров.
- S15 — откат в тренде: цена у EMA20 при EMA20 > EMA50 > EMA200; TP 2R.
- S16 — только majors (BTC, ETH, SOL, BNB, XRP) + S06.
- S17 — только top-15 по объёму + S07.
- S18 — momentum: топ-3 по росту за 7 дней из top-30, ребаланс раз в сутки.
- S19 — контроль: случайный вход раз в N часов, стоп 2 ATR, TP 2R.
- S20 — контроль: buy & hold BTC.

**Futures**
- F01 — baseline: текущий сканер, оба направления, текущие SL/TP.
- F02 — F01 только шорты + фильтр: цена ниже EMA200 на 4h (шорт только по тренду).
- F03 — инверсия F01: после пампа — long-продолжение с трейлингом 2 ATR.
- F04 — EMA 9/21 cross на 15m, оба направления, фильтр EMA200 1h; TP 2R.
- F05 — F04 с трейлингом 3 ATR.
- F06 — Donchian-20 на 1h, оба направления; трейлинг 2 ATR.
- F07 — Donchian-55 на 4h, оба направления; трейлинг 3 ATR.
- F08 — Supertrend(10,3), всегда в рынке (flip); majors.
- F09 — RSI(2) mean reversion по тренду: long выше SMA200, short ниже; тайм-стоп.
- F10 — BB squeeze breakout, оба направления.
- F11 — MACD + ADX > 25 (только сильный тренд); TP 2R + безубыток.
- F12 — откат к EMA20 в тренде, оба направления; TP 2R.
- F13 — объёмный спайк, вход по направлению свечи; TP 1,5R; тайм-стоп.
- F14 — funding-контр: funding > 0,05% и цена < EMA50 → short; funding < −0,05% → long.
- F15 — only majors + F06.
- F16 — F06 с blacklist (исключены монеты с худшим PnL прошлой ночи: PIXEL, MAGIC, KAIA, BAT, Q, OP).
- F17 — фиксированные TP 1% и SL 1% (скальп) на EMA 9/21 cross, 5m.
- F18 — тайм-стоп 4 ч без TP: стоп 2 ATR, выход по времени.
- F19 — контроль: случайное направление и вход, стоп 2 ATR, TP 2R.
- F20 — контроль: long BTC 1× постоянно (бенчмарк).

## Эпики (каждый — своя ветка, PR и spec; порядок = зависимости)
1. **E1 · spec 003 «Движок экспериментов (paper)»** — без БД, in-memory/JSON; самый ценный, без внешних аккаунтов.
   - `shared/lib/indicators.ts`: EMA, SMA, RSI, ATR, BB, MACD, ADX, Supertrend, Donchian — чистые функции и тесты. Сейчас индикаторы живут в `features/scan-market/lib/computeIndicators.ts`; его частично перенести.
   - `entities/experiment`: Zod-схемы `ExperimentConfig`, `PaperTrade`, типы статистики.
   - `features/paper-engine`:
     - `lib/strategies/*` — сигналы;
     - `lib/exits.ts` — SL/TP/трейлинг/BE/тайм-стоп;
     - `lib/sizing.ts` — риск 0,5% стартового бюджета, объём ≤ 10%;
     - `lib/simulateFill.ts`;
     - `model/engine.ts` — тик;
     - `model/marketData.ts` — кэш свечей;
     - `config/catalog.ts` — 40 экспериментов.
   - Тесты: стратегии на синтетических свечах, проход выходов по 1m-свечам, sizing, P&L с комиссиями.
2. **E2 · spec 004 «Хранилище: Postgres/Drizzle»** — `shared/db` (клиент: PGlite локально, postgres.js по `DATABASE_URL`), схема, миграции, репозиторий в `entities/experiment/api`. Сид каталога в `experiments`. Движок пишет в БД.
3. **E3 · spec 005 «UI: хедер, страницы статистики, настройки»**
   - Хедер:
     - тоггл «Автоторговля» (движок вкл/выкл);
     - бюджеты Spot / Futures: equity, изменение от старта и цвет.
   - `/experiments`: таблица 40 экспериментов — рынок, суть, сделки, win rate, PnL, profit factor, max DD, equity; сортировка и фильтр по рынку в URL (nuqs).
   - `/experiments/[id]`: суть, конфиг, equity-кривая, сделки.
   - `/stats`: группировка по эксперименту, рынку, монете, направлению B/S; фильтры в URL. Отсюда видно, от каких монет отказаться.
   - `/settings`: «Сбросить тестовые капиталы» — диалог подтверждения и новая эпоха; стартовый бюджет; включение demo-зеркала у экспериментов.
   - /signals: убрать AutoTradePanel. Слайс `auto-trade` и `auto-trade-toggle` удалить, а `data/auto-trade.json` перестаёт использоваться.
4. **E4 · spec 006 «Вход через GitHub»** — Auth.js, allowlist, proxy или middleware, страница входа, кнопка выхода в хедере, `CRON_SECRET`.
5. **E5 · spec 007 «Деплой на Oracle Cloud»** — скрипты, systemd, Caddy, workflow deploy, `docs/ai/deploy.md` с пошаговыми действиями пользователя: аккаунт Oracle, Supabase, GitHub OAuth App, секреты Actions.
6. **E6 · spec 008 «Demo-зеркало»** — флаг `demo_mirror`: при paper-входе эксперимента тот же вход уходит в Binance Demo. Используется `placeTrade` из `features/execute-trade`, ключ сделки сохраняется в `paper_trades.demo_order_ref`. Только если символ не занят другим зеркалом.

Порядок выполнения: E1 → E2 → E3 → E4 → E5 → E6. Сейчас делаю E1–E4 подряд, у каждого PR и ревью. Разрешение мержить самому было дано только на прошлую задачу, поэтому PR оставляю на ваш `/merge`, если не скажете иначе. E5 требует от пользователя завести аккаунты Oracle, Supabase и GitHub OAuth App; скрипты и инструкцию готовлю заранее.

## Переиспользуем
- `fetchKlines`, `fetch24hTickers`, `fetchPerpetualSymbols` — `src/shared/api/binance/market.ts`.
- `getJsonWithRetry` — `shared/lib/fetchRetry.ts`.
- `log` — `shared/lib/logger.server.ts`; `withLogging` для роутов.
- Паттерн singleton-таймера в `globalThis` и lock — был в `features/auto-trade/model/autoTrader.ts` (удалён в 3e), перенесён в `src/app/server/experimentEngine.ts`.
- `instrumentation.ts`, `app/server/*` — композиция серверных зависимостей.
- `placeTrade` из `features/execute-trade` — demo-зеркало (E6).
- Индикаторы — `features/scan-market/lib/computeIndicators.ts`; детектор `detectSetup` — для baseline S01/F01.
- `summarizeTrades` (`widgets/trade-log/lib`) — образец агрегатов; общая статистика будет в `entities/experiment/lib/stats.ts`.

## Verification
- `pnpm check` (Biome, Steiger, typecheck, Vitest) и `pnpm build` зелёные на каждой ветке.
- Unit-тесты:
  - каждая стратегия на синтетических свечах;
  - выходы: SL раньше TP в одной свече, трейлинг, безубыток, тайм-стоп;
  - sizing 0,5%;
  - агрегаты статистики по 4 разрезам.
- Живой прогон локально (PGlite): движок 15+ минут на реальных свечах; в БД появляются сделки, `/experiments` и `/stats` их показывают, сброс создаёт новую эпоху и обнуляет equity.
- Скриншоты страниц через Playwright.
- Auth: в prod-режиме без cookie — редирект на вход, `/api/*` → 401, `/api/cron/tick` без секрета → 401.
- Деплой — после аккаунтов пользователя: `curl` к Binance с VM без 451, HTTPS-адрес открывается, вход через GitHub работает, тики идут в журнал.
