# shared/api/binance

Клиенты Binance. Три независимых «мира» с разными хостами и ключами — не путать.

| Мир | Хосты | Ключ | Точка входа |
|---|---|---|---|
| Публичное API (рынок, Earn) | `api.binance.com`, `fapi.binance.com`, `www.binance.com/bapi` | не нужен | `public.server.ts` |
| Аккаунт (read-only) | `api.binance.com` (`/sapi`, `/api/v3/account`) | `BINANCE_API_KEY/SECRET` | `account.server.ts` |
| Demo Trading (сделки) | `demo-api.binance.com`, `demo-fapi.binance.com` | `BINANCE_DEMO_API_KEY/SECRET` | `demo.server.ts` |

## Публичный API модуля
- `index.ts` — **клиент-безопасный**: только типы и чистые функции (`resolveUsdPrice`). Его можно
  импортировать из UI.
- `*.server.ts` — сетевые функции, только сервер (логгер на `node:fs`, подпись на `node:crypto`).
  Импорт из клиентского компонента утянет `node:*` в браузерный бандл и сломает сборку.

## Внутри
- `signed.ts` — `signedRequest(baseUrl, creds, method, path, schema, params)`: HMAC SHA256, новый
  `timestamp` и подпись на каждую попытку, повторы при сетевых сбоях, валидация ответа Zod.
  Ошибка биржи → `BinanceApiError` (с `code`, повторять бессмысленно); 2xx с неожиданным телом →
  `ResponseFormatError` (для ордеров значит «скорее всего исполнен»).
- `marketApi.ts` — **среда-независимые** публичные рыночные запросы (`createMarketApi(getJson)`): тикеры,
  свечи, бессрочные фьючерсы, funding. Без `@/…` и `node:*` — его импортирует и Edge Function Supabase
  `engine-tick` (Deno, spec 007b). Транспорт (повторы, журнал) передаётся аргументом.
- `market.ts` — `createMarketApi` поверх `getJsonWithRetry` (`shared/lib/fetchRetry.ts`) для Node;
  `client.ts` — Earn и цены через тот же `getJsonWithRetry`.
- `accountClient.ts` — Spot, Funding, Simple Earn (read-only).
- `earnAccountClient.ts` + `earnAccountSchemas.ts` — каталоги сложных продуктов Earn (spec 0019), только подписанные
  GET (USER_DATA, read-only ключ). Экспорт — через `account.server.ts`, типы — через `index.ts`. См. «Earn: сложные
  продукты» ниже.
- `client.ts` → `fetchEarnOverview()` — публичная сводка Earn (`bapi/earn/v1/friendly/finance-earn/homepage/overview`,
  без ключа, `code === "000000"`): ~12 топ-активов, у каждого `productSummary[] {productType, maxApr, minApr,
  duration ["FLEXIBLE"|"FIXED"], lowRisk, soldOut}`; APR — доли. Схема мягкая: пустые поля → `null`.
- `demoTrading.ts` — справочник символов, цены, балансы, ордера Spot/OCO, Futures + algo TP/SL, позиции,
  `fetchDemoOpenSymbols` — символы с открытой позицией или ордерами. История: `fetchDemoTradedSymbols` —
  снимок `DemoTradeSnapshot` (символы + позиции futures + баланс spot одним заходом), `fetchDemoFills`
  (myTrades / userTrades), `fetchDemoSymbolOrders` (сеть) → разбор в чистом `demoOrders.ts`
  (`toFuturesSymbolOrders` / `toSpotSymbolOrders`: чем исполнился выход — algo TP/SL у futures по
  `actualOrderId`, ликвидация по `clientOrderId` `autoclose-…`, тип ордера OCO у spot; активные стопы
  со стороной). Тесты разбора — `demoOrders.test.ts`.
- `demoRules.ts` — чистый разбор фильтров exchangeInfo в `SymbolRules`: шаги, минимумы, коридор цены
  `priceBand` (спот: `PERCENT_PRICE_BY_SIDE` или `PERCENT_PRICE`; у фьючерсов null — algo-триггеры фильтр не
  ограничивает), `otoAllowed`/`ocoAllowed`. Тесты — `demoRules.test.ts`.
- `demoOrderLists.ts` — спот-вход одной заявкой (spec 0012): параметры OTOCO/OTO (`spotEntryListRequest`,
  рабочий `LIMIT BUY FOK`) и разбор ответа (`summarizeSpotEntryList`); сеть — `demoSpotBuyProtected`,
  статус отложенного ордера — `fetchDemoSpotOrderStatus`. Тесты — `demoOrderLists.test.ts`.
- `orderOutcome.ts` — `orderErrorOutcome(error)`: ошибка ордера — `rejected` (биржа точно отказала) или `unknown`
  (`-1006`/`-1007` «execution status unknown», HTTP 5xx, сеть, нераспознанный ответ — ордер мог исполниться).
  Список кодов — `UNKNOWN_OUTCOME_CODES`, по документации Binance (Spot и USDⓈ-M Futures, 2026-10-15).
  `ORDER_RECV_WINDOW_MS` (5 с) — `recvWindow` ордеров входа (у остальных запросов 10 с); `unknownOutcomeDeadline`
  и `nextRecheckDelay` — сколько перечитывать заявку с неизвестным исходом, прежде чем сказать «её нет».
  Перечитать ордер спота по своему id — `fetchDemoSpotOrderByClientId` (null — `-2013`, ордера нет);
  `clientOrderId` задают `demoSpotMarketOrder` и `spotEntryListRequest` (`clientIds`).
- `protectRefs.ts` — `demoProtectRefsSchema` (клиент-безопасно): ссылки на свои стоп/тейк сделки (spec 0012, PR 2b).
  Свои ордера: `fetchDemoAlgoOrder` / `demoCancelAlgoOrder` (по algoId или clientAlgoId; нет — `-2013`/`-2011`), `demoSpotCancelByClientId`,
  `fetchDemoFuturesOrder` (по orderId или clientOrderId; null — `-2013`); свои id принимают `demoFuturesMarketOrder`,
  `demoFuturesCloseAt` (`clientAlgoId`), `demoSpotOcoSell`, `demoSpotStopLossSell`.
- Таймаут каждого запроса — `REQUEST_TIMEOUT_MS` (15 с, `shared/lib/fetchRetry.ts`, `AbortSignal.timeout`): больше 10 с,
  за которые Binance сам отвечает -1007. Сработал — сетевая ошибка: чтение после таймаута повторяется не больше
  `TIMEOUT_RETRIES` (1) раза, у ордера исход неизвестен. `actualOrderId` 0 / "" / не положительный — не срабатывал.
- `*Schemas.ts` — Zod-схемы ответов. Числа Binance приходят строками → `z.coerce.number()`.

## Подводные камни
- **Только демо-хосты для ордеров.** Live-торговли нет намеренно; не добавлять реальные торговые хосты.
- Демо-фьючерсы иногда не присылают `avgPrice`/`executedQty` — схемы терпят это (`.catch(0)`).
- `exchangeInfo` демо-фьючерсов ~900 КБ — кэшируется на 10 минут, при сбое используется старая копия.
- Лимиты веса Binance: не делать запросов в цикле по сотням символов; кэшировать справочники. Лимит — 6000 веса
  в минуту **на IP**, а исходящий IP Vercel общий с чужими приложениями. Для одной цены — `fetchTickerPrices(market)`
  (`ticker/price`, вес 4/2), а не `ticker/24hr` без символа (вес 80/40).
- После 429/418 `getJsonWithRetry` (`src/shared/lib/fetchRetry.ts`) ставит паузу на хост: срок берётся из `Retry-After`
  или «banned until» (по умолчанию 60 с). Во время паузы запрос сразу бросает `HttpError` без похода в сеть, потому что
  повтор во время бана удлиняет бан. Пауза одна на процесс (на Vercel — на экземпляр функции), в журнале — `binance.cooldown`.
- Ошибки `-1121` (Invalid symbol) и `-4046` (margin type уже установлен) — ожидаемые, обрабатываются явно.
- `-4067` на `/fapi/v1/marginType` — по символу есть открытые ордера (даже если маржа уже изолированная);
  `placeTrade` не доходит до этого вызова, если символ уже в сделке.
- Тесты схем — `demoSchemas.test.ts`; сетевые функции не тестируются (нет моков сети).
- `fetchFundingRates` — `/fapi/v1/premiumIndex` одним запросом по всем фьючерсам (без ключа): ставки
  funding для движка лаборатории (F14). У поставочных контрактов ставки нет — они пропускаются.

## Earn: сложные продукты (spec 0019, проба полей 2026-10-15)
Все ответы сверены пробой на живом read-only ключе. Числа — строками (`z.coerce.number()`), время — мс, `duration` —
дни, **APR — доли везде** (у Dual `"2.5608"` = 256 % годовых: короткие сроки у страйка, сводка даёт тот же порядок).

| Функция | Ручка | Параметры | Поля, которые используем |
|---|---|---|---|
| `fetchDualProducts` | `GET /sapi/v1/dci/product/list` | `optionType CALL\|PUT`, `investCoin`, `exercisedCoin`, `pageSize` ≤ 100 (500 → `-1102`), `pageIndex` | `total`, `list[] {id, investCoin, exercisedCoin, strikePrice, duration, settleDate, purchaseEndTime, canPurchase, apr, minAmount, maxAmount, optionType}` |
| `fetchOnchainYieldsProducts` | `GET /sapi/v1/onchain-yields/locked/list` | `size` | `rows[] {projectId, detail {asset, rewardAsset, duration, isSoldOut, apr, status "PURCHASING", canRedeemToFlex}, quota {totalPersonalQuota, minimum}}` |
| `fetchStakingQuota("eth"\|"sol")` | `GET /sapi/v1/eth-staking/eth/quota`, `/sapi/v1/sol-staking/sol/quota` | — | `leftStakingPersonalQuota, minStakeAmount, redeemPeriod` (дни), `stakeable`, `soldOut` (у SOL), `commissionFee` |
| `fetchStableYieldQuota("rwusd"\|"bfusd")` | `GET /sapi/v1/rwusd/quota`, `/sapi/v1/bfusd/quota` | — | `subscribeEnable` (только RWUSD), `subscriptionQuota {leftQuota, minimum}`, `standardRedemptionQuota {redeemPeriod, fee}`, `fastRedemptionQuota` |
| `fetchLatestRate(...)` | `…/history/rateHistory` у ETH/SOL staking, RWUSD, BFUSD | `size=1` | `rows[0] {annualPercentageRate, time}` — APR последнего дня (в quota/account ставки нет) |
| `fetchSoftStakingList` | `GET /sapi/v1/soft-staking/list` | `size` | `rows[] {asset, apr, minAmount, maxCap}` |

- **Семантика Dual** (сверено по ответу): у CALL `investCoin` — монета, страйки выше цены → «Sell High»; у PUT
  `investCoin` — стейбл, страйки ниже цены → «Buy Low». Список отсортирован от ближнего к цене страйка к дальнему; у
  BTC/ETH ~5–7 страниц по 100 на пару. `fetchDualProducts` читает до 10 страниц.
- Каталог целиком (16 пар Dual + 6 групп) — ~70 запросов веса 1, ~4–5 с; кэш 5 мин в `features/load-earn-catalog`.
  `rateHistory` у Binance тяжелее обычных ручек — дёргается только на холодный кэш (4 запроса).
- Ручки `…/account` (балансы позиций) не используются: «Мои позиции» — вне scope 0019.
- Нет аккаунта RWUSD/BFUSD или другая ошибка группы → группа уходит в `warnings` загрузчика, остальные видны.
