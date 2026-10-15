# 0023 · Группа активов COIN-M в paper-лаборатории и шапке; `futures` → `usdm`

- **Тип:** feature (задача D из плана [spec 0016](0016-glossary-ag-demo-columns.md), часть 1 — paper; демо-зеркало COIN-M — отдельная задача)
- **Статус:** in-progress
- **Раздел PRD:** §3.4 Авто-бот → «Счета и группы активов»
- **Дата:** 2026-10-15

## Цель
В шапке и в лаборатории видны только две группы активов из трёх: Spot и USDⓈ-M. Третьей — COIN-M (фьючерсы с маржой
в монете) — нет в движке, поэтому по ней нечего ни торговать, ни показывать. Задача добавляет COIN-M в paper-движок,
шапку, фильтры и статистику, а внутреннее имя группы USDⓈ-M приводит к глоссарию (`futures` → `usdm`).

## Решения пользователя (2026-10-15)
- Порядок задач плана 0016: D, затем B (остатки Paper | Demo | Real в шапке).
- Бюджет и PnL COIN-M — **в долларах**, как у остальных групп ($10 000 на эксперимент).
- Эксперименты COIN-M — **копии всех 20 экспериментов USDⓈ-M** с теми же параметрами; заводятся в приватном
  `private/experiments.json` (правило spec 0015), в публичный каталог и этот spec параметры не попадают.
- Демо-зеркало COIN-M (`demo-dapi.binance.com`) — отдельной задачей после мержа ветки 0012 (hedge mode), которая
  переписывает тот же фьючерсный путь ордеров (выбор по умолчанию: пользователь не выбрал вариант).
- Переименование `futures` → `usdm` — в этой задаче. Пользователь предложил префикс `fm_usdm` и согласился обойтись
  без него при доводах — они ниже, в «Именах групп».

## Имена групп
Внутренние значения `market`: **`spot`**, **`usdm`**, **`coinm`**; коды в UI и глоссарии — `SPOT`, `FT:USDM`, `FT:COINM`.
Почему без префикса `fm_`/`ft_`:
- `usdm` и `coinm` — собственные имена Binance для двух фьючерсных продуктов (USDⓈ-M Futures на `fapi`, COIN-M Futures
  на `dapi`); других продуктов с такими именами нет, путаницы без префикса не возникает. Если появятся опционы или
  маржа, им нужны свои имена (`options`, `margin`), и префикс их тоже не различил бы.
- «Это фьючерс» в коде выражается не строкой, а признаком группы (`ASSET_GROUPS[market].kind`), которым пользуются
  ветвления (шорт, плечо, funding); префикс дублировал бы его и удлинял каждое сравнение.
- Внутреннее значение — ключ в БД и URL, код в UI — подпись; одна карта `ASSET_GROUPS` связывает их. Регистр и
  двоеточие (`FT:USDM`) уместны в подписи, но в ключе БД/URL неудобны (`%3A` в адресе). Поэтому разделение «ключ
  в нижнем регистре ↔ код для людей» оставляем, как решено в 0016.

## Сценарии
1. Пользователь открывает любую страницу → в шапке три группы: `Spot · USDⓈ-M · COIN-M`, у каждой equity и изменение
   от старта эпохи; подсказка COIN-M — как у остальных.
2. `/experiments` → у копий колонка AG показывает `FT:COINM`; фильтр групп над таблицей предлагает COIN-M.
3. Движок включён → эксперименты COIN-M открывают и закрывают paper-сделки на символах вида `BTCUSD_PERP` по ценам
   COIN-M, с funding и комиссиями; по сделкам видны PnL и метрики, как у USDⓈ-M.
4. `/stats` → фильтр группы включает COIN-M.
5. Старые ссылки `?market=futures` открывают группу USDⓈ-M.

## Критерии приёмки
- [ ] AC1. В шапке три группы в порядке Spot, USDⓈ-M, COIN-M; COIN-M без экспериментов — `0 $` и `0,00%`, а не пропуск.
- [ ] AC2. Значения `market` в коде — `spot` / `usdm` / `coinm`; литералов `"futures"` для группы не осталось (одна
  схема `marketSchema`, отдельные копии enum заменены ею). Миграция Drizzle переводит `futures` → `usdm` в
  `experiments`, `paper_trades`, `demo_mirror_orders` и в jsonb `demo_mirror_orders.protect_refs`; после неё на
  локальной БД с данными прод-формата страницы `/experiments`, `/stats`, `/settings` открываются без ошибок.
- [ ] AC3. Записи журнала со старым `market: "futures"` (история демо-сделок, отказы зеркала) читаются как USDⓈ-M;
  ссылки `?market=futures` на `/experiments` и `/stats` показывают USDⓈ-M.
- [ ] AC4. Paper-движок торгует COIN-M: юниверс — бессрочные контракты COIN-M (`…USD_PERP`, статус TRADING) с
  оборотом в $ (контракты × размер контракта); `majors` для COIN-M — `BTC/ETH/SOL/BNB/XRP USD_PERP`; свечи, тикеры,
  цены и funding — с `dapi.binance.com`; шорт и плечо — как у USDⓈ-M.
- [ ] AC5. Размер paper-сделки COIN-M — целое число контрактов: `floor(50 $ / размер контракта)`, минимум 1 контракт
  (BTC — $100, остальные — $10); количество в монете = контракты × размер / цена входа; PnL, комиссии (0,05 %) и
  funding в $ — по тем же формулам, что USDⓈ-M (юнит-тесты на размер и PnL инверсного контракта).
- [ ] AC6. `/experiments`: колонка AG — `FT:COINM` у экспериментов COIN-M; фильтр групп — Spot / USDⓈ-M / COIN-M.
  `/stats` — тот же фильтр. Глоссарий: строки USDⓈ-M и COIN-M без «В коде — `futures`» и «пока не торгуется», `pnpm glossary` пересобран.
- [ ] AC7. Демо-зеркало у экспериментов COIN-M недоступно: галочка на `/experiments` и `/settings` выключена, в
  подсказке — «Демо-зеркало COIN-M — позже»; API включения зеркала для COIN-M отвечает 400 с тем же текстом.
- [ ] AC8. `pnpm lab:private` принимает id `PC..` (COIN-M) наряду с `PS..`/`PF..`; `pnpm lab:report` показывает
  COIN-M отдельной группой.
- [ ] AC9. Ошибки: `dapi` недоступен → тик пропускает только COIN-M (запись `warn` в журнале), Spot и USDⓈ-M
  торгуют; нет цены COIN-M → в шапке без нереализованного PnL, как сейчас у других групп.
- [ ] AC10. Supabase-функция `engine-tick` (Deno) собирается и тикает с COIN-M (общий `marketApi.ts`).

## Вне scope
- Демо-зеркало COIN-M на `demo-dapi.binance.com` — отдельная задача после мержа 0012.
- Остатки Paper | Demo | Real в шапке и сбросы по группе — задача B (0024); статистика по счетам — задача C.
- Сигналы, сканер и ручные демо-сделки на COIN-M (`/signals`, тикет сделки) — без изменений.
- Учёт маржи в монете (курсовая переоценка залога) — бюджет в $ по решению пользователя.

## Технические заметки
- **Схема:** `packages/trading-core/src/experiment.ts` — `MARKETS = ["spot","usdm","coinm"]`; `fills.ts`
  `FEE_RATE` — `coinm: 0.0005`. Копии `z.enum(["spot","futures"])` (≈15 мест: `shared/api/binance/marketApi.ts`,
  `protectRefs.ts`, `entities/trade`, `entities/market-signal`, `entities/experiment/model/mirror.ts`, `mirrorDb.ts`,
  `features/demo-mirror/*`, `execute-trade/*`, `shared/config/demoLinks.ts`) переходят на общую схему или на
  `usdm`. Чтение старых значений — `z.preprocess` (`futures` → `usdm`) в схемах журнала и nuqs-парсерах фильтров.
- **Группа:** `entities/experiment/model/assetGroup.ts` — `coinm: {code:"FT:COINM", label:"COIN-M", …}` и признак
  `kind: "spot" | "futures"`; ветвления движка (`runTick.ts` funding/плечо/шорт, `engineTick.ts`) — по признаку.
- **Данные COIN-M:** `shared/api/binance/marketApi.ts` — `BASE.coinm = dapi/v1` (`klines`, `ticker/24hr`,
  `premiumIndex`, `exchangeInfo`: `contractType=PERPETUAL`, `contractSize`); `client.ts` `TICKER_PRICE_URL.coinm`.
  `paper-engine/lib/universe.ts` — шаблон символа по группе, оборот COIN-M = `volume × contractSize`.
- **Размер:** `trading-core/sizing.ts` — опция `contractSizeUsd` (COIN-M), округление до целых контрактов; формулы
  `settle`/`unrealizedPnl` не меняются (PnL инверсного контракта в $ по цене выхода = линейному при qty = N·C/entry).
- **Миграция:** ручная SQL-миграция по образцу `drizzle/0005_*.sql` (`UPDATE … SET market='usdm'`, `jsonb_set` для
  `protect_refs`) + запись в `drizzle/meta/_journal.json`; логи не мигрируются (хранятся 14 дней, читаются preprocess).
- **Приватные:** `scripts/lib/labPrivate.ts` — `PRIVATE_ID_PATTERN = /^P([SFC])\d{2,}$/`, `C → coinm`, `F → usdm`.
  Копии 20 экспериментов USDⓈ-M с юниверсами `…USD_PERP` — коммит в приватный репозиторий, в прод — `pnpm lab:private --prod`
  после выкатки.
- **Выкатка:** миграция меняет значения, которые читает уже задеплоенный код (Vercel и Supabase `engine-tick`).
  Порядок: выключить автоторговлю → деплой Vercel (миграция при старте) и `engine-tick` → `lab:private --prod` →
  включить автоторговлю.
- **Риски:** ветка `feature/0012-mirror-hedge-mode` правит `demoTrading.ts`, `placeTrade.ts`, `closeDemoPosition.ts` —
  кто вливается вторым, переносит переименование; ветка 0017 (переезд на SQLite) должна перенести уже новые значения.
  Обороты COIN-M меньше USDⓈ-M — `top`-юниверсы будут уже (ожидаемо).
- Документация: `docs/ai/glossary.md`, `docs/ai/architecture.md` (группы), `packages/trading-core/README.md`,
  `src/shared/api/binance/README.md`, PRD §3.4.

## Журнал
| Дата | Событие |
|---|---|
| 2026-10-15 | ТЗ написано, решения пользователя зафиксированы |
| 2026-10-15 | ТЗ утверждено |
| 2026-10-15 | Разработка начата: ветка `feature/0023-coinm-asset-group` |
| 2026-10-15 | Реализовано (Developer): ядро — `MARKETS` spot/usdm/coinm, `MARKET_KIND`, `legacyMarketSchema`, комиссия и размер сделки COIN-M целыми контрактами; `marketApi` — dapi (тикеры, свечи, funding, бессрочные с размером контракта); движок — юниверс `…USD_PERP`, ветвления по виду группы, недоступный рынок пропускается одной записью `warn`; миграция `0007_futures_to_usdm`; шапка, фильтры `/experiments` и `/stats` с COIN-M и чтением `?market=futures`; демо-зеркало COIN-M недоступно (галочка, API 400, `lab:private`); `lab:private` — `PC..`, `lab:report` — COIN-M отдельной группой; глоссарий, архитектура, README. `pnpm check`, `pnpm build`, `pnpm check:edge` зелёные |
