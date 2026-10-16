# shared/api/binance

Клиенты Binance. Четыре независимых «мира» с разными хостами и ключами — не путать.

| Мир | Хосты | Ключ | Точка входа |
|---|---|---|---|
| Публичное API (рынок, Earn) | `api.binance.com`, `fapi.binance.com`, `dapi.binance.com` (COIN-M), `www.binance.com/bapi` | не нужен | `public.server.ts` |
| Аккаунт (read-only) | `api.binance.com` (`/sapi`, `/api/v3/account`) | `BINANCE_API_KEY/SECRET` | `account.server.ts` |
| Demo Trading (сделки) | `demo-api.binance.com`, `demo-fapi.binance.com`; `demo-dapi.binance.com` (COIN-M) — только чтение баланса | `BINANCE_DEMO_API_KEY/SECRET` | `demo.server.ts` |
| Live — реальный счёт (торговый субсчёт, spec 0047) | `api.binance.com` (`/sapi`, `/api/v3`), `fapi.binance.com` — только пути белого списка | `BINANCE_TRADE_API_KEY/SECRET` — **только у воркера на VM** (`scripts/live-worker.ts`), у веб-приложения его нет | `live.server.ts` |

## Публичный API модуля
- `index.ts` — **клиент-безопасный**: только типы и чистые функции (`resolveUsdPrice`). Его можно
  импортировать из UI.
- `*.server.ts` — сетевые функции, только сервер (логгер на `node:fs`, подпись на `node:crypto`).
  Импорт из клиентского компонента утянет `node:*` в браузерный бандл и сломает сборку.

## Live: реальный счёт (spec 0047)
- `liveAllowlist.ts` — белый список «метод + хост + путь» клиента реального счёта (`LIVE_ALLOWLIST`) и проверка
  `assertLiveAllowed` до подписи и сети. Сейчас в списке только чтение: `GET /sapi/v1/account/apiRestrictions`,
  `GET /api/v3/account`, `GET fapi /fapi/v3/account`. Пути со словами движения денег (`withdraw`, `transfer`, `capital`,
  `sub-account`, `loan`, `borrow`, `repay`, `universal`) отвергаются всегда, даже если их добавят в список. Ордера
  добавит задача «Реальное зеркало» — новыми строками списка и тестом.
- `live.server.ts` — `liveSignedRequest` (единственный путь подписанных запросов с ключом `BINANCE_TRADE_*`: список →
  `signedRequest`), `fetchLiveApiRestrictions` (ответ как есть), `fetchLiveSpotAccount` (`uid`, остатки,
  `omitZeroBalances`), `fetchLiveFuturesAccount` (итоги `totalWalletBalance`, `availableBalance`,
  `totalUnrealizedProfit`). Импортирует только воркер.
- `liveRestrictions.ts` (клиент-безопасно) — оценка прав ключа `evaluateRestrictions`: годится, если `ipRestrict`,
  `enableReading`, `enableSpotAndMarginTrading` включены, а `enableWithdrawals`, `enableInternalTransfer`,
  `permitsUniversalTransfer`, `enableMargin` выключены; `enableFutures = false` — только предупреждение. Причина
  блокировки — по каждому пункту, с английским названием переключателя Binance. Неизвестные поля не мешают,
  отсутствие нужного — блокировка «неизвестный ответ». `isKeyRejected` — 401, `-2015`, `-2014`, `-1022` → «Binance не
  принял ключ: проверьте ключ и IP-whitelist». `checkAccountUid` — UID субсчёта против UID основного счёта
  (`fetchAccountUid` read-only ключом в приложении): совпал — блокировка, нет read-only ключа — пропуск с пометкой.
- Форматы сверены с документацией Binance 2026-10-16: `apiRestrictions` — вес 1 (IP), поля — булевы (`ipRestrict`,
  `enableReading`, `enableWithdrawals`, `enableInternalTransfer`, `enableMargin`, `enableFutures`,
  `permitsUniversalTransfer`, `enableSpotAndMarginTrading`, ещё `createTime`, `enableVanillaOptions`, `enableFix*`,
  `enablePortfolioMarginTrading`); `/api/v3/account` — вес 20, есть `uid`; `/fapi/v3/account` — вес 5, итоги в USDT
  (одноактивный режим) или USD (мультиактивный).
- Пауза после 429/418 и повторы чтения — общие (`signedRequest`, `fetchRetry`): на паузе воркер шлёт пульс с ошибкой,
  прежняя оценка ключа не снимается.

## Внутри
- `signed.ts` — `signedRequest(baseUrl, creds, method, path, schema, params)`: HMAC SHA256, новый
  `timestamp` и подпись на каждую попытку, повторы при сетевых сбоях, валидация ответа Zod.
  Ошибка биржи → `BinanceApiError` (с `code`, повторять бессмысленно); 2xx с неожиданным телом →
  `ResponseFormatError` (для ордеров значит «скорее всего исполнен»).
- `markets.ts` — имена рынков (spec 0023): `BinanceMarket` = `spot` / `usdm` (USDⓈ-M, fapi) / `coinm` (COIN-M, dapi),
  `FuturesMarket`, `Market` = `spot` / `usdm` — рынки ручных сделок и Binance Demo; `tradeMarketSchema` читает старое
  `futures` как `usdm` (сетапы и сделки от старого клиента), `withLegacyMarketField` — то же для объектов с полем market;
  сама нормализация — одна, в `trading-core` (`normalizeMarket`).
- `marketApi.ts` — **среда-независимые** публичные рыночные запросы (`createMarketApi(getJson)`): тикеры
  (`fetch24hTickers` — Spot/USDⓈ-M, `fetchCoinmTickers` — COIN-M: оборот в контрактах), свечи по любому рынку,
  бессрочные контракты `fetchPerpetuals(market, { cryptoOnly })` (символ → размер контракта COIN-M; у dapi статус —
  `contractStatus`; `cryptoOnly` — только `underlyingType = COIN`, поле есть у fapi и dapi, spec 0029),
  funding `fetchFundingRates(market)`. Без `@/…` и `node:*` — его импортирует и Edge Function Supabase
  `engine-tick` (Deno, spec 007b). Транспорт (повторы, журнал) передаётся аргументом.
- `market.ts` — `createMarketApi` поверх `getJsonWithRetry` (`shared/lib/fetchRetry.ts`) для Node;
  `client.ts` — Earn и цены через тот же `getJsonWithRetry`.
- `accountClient.ts` — Spot, Funding, Simple Earn (read-only): позиции и история начислений (см. «Earn: история
  начислений» ниже).
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
- `walletEquity.ts` — оценка кошельков в $ (spec 0038, клиент-безопасно): `sumUsd(rows, price)` — сумма остатков × цена,
  активы без цены — в `unpriced`; `walletsByMarket(wallets)` — кошельки `/sapi/v1/asset/wallet/balance` по рынкам
  (`WALLET_MARKET`: «Spot», «USDⓈ-M Futures», «COIN-M Futures» — имена сверены пробой 2026-10-16). Сеть —
  `fetchDemoEquity(creds, price)` в `demoTrading.ts`: equity демо-счёта по кошелькам, как на demo.binance.com — Spot
  `/api/v3/account` (free + locked), USDⓈ-M `/fapi/v3/account` (walletBalance + unrealizedProfit: у `/fapi/v3/balance`
  PnL только кросс-позиций, а зеркало открывает изолированные), COIN-M `demo-dapi` `/dapi/v1/balance` (balance +
  crossUnPnl); кошельки независимы — ошибка одного не мешает другим (`WalletEquityResult`). Кэш 60 с — у вызывающего
  (`src/app/server/accountBalances.ts`).
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
- `positionMode.ts` — режим позиций фьючерсов (spec 0012, PR 2c): `FuturesSide` (режим + сторона) и параметры
  ордеров — вход (`entryParams`: Hedge — `positionSide`), закрытие (`reduceParams`: One-way — `reduceOnly`, Hedge —
  `positionSide`, reduceOnly там не передаётся), защита на свой объём (`protectParams`: `quantity`, без
  `closePosition`). Сеть: `fetchDemoPositionMode` (GET `/fapi/v1/positionSide/dual`, кэш 30 с), `demoEnableHedgeMode`
  (только на пустом счёте; `-4059` — уже включён), `fetchDemoFuturesAccountBusy`, `fetchDemoFuturesSymbolState`
  (позиции по сторонам, открытые обычные и algo-ордера), `demoFuturesPositions`, `demoFuturesCancelOrder`,
  `fetchDemoSpotOpenOrders` / `demoSpotCancelOrder`. `demoFuturesMarketOrder`, `demoFuturesProtect` (бывший
  `demoFuturesCloseAt`), `demoFuturesReduceMarket` принимают `FuturesSide`. `demoFuturesPrepare`: `-4047/-4048`
  (ордера/позиция по символу) — тип маржи не меняется, не ошибка.
- `protectRefs.ts` — `demoProtectRefsSchema` (клиент-безопасно): ссылки на свои стоп/тейк сделки (spec 0012, PR 2b).
  Свои ордера: `fetchDemoAlgoOrder` / `demoCancelAlgoOrder` (по algoId или clientAlgoId; нет — `-2013`/`-2011`), `demoSpotCancelByClientId`,
  `fetchDemoFuturesOrder` (по orderId или clientOrderId; null — `-2013`); свои id принимают `demoFuturesMarketOrder`,
  `demoFuturesProtect` (`clientAlgoId`), `demoSpotOcoSell`, `demoSpotStopLossSell`. `fetchDemoOpenAlgoOrders` —
  открытые algo-ордера всего счёта одним запросом (сверка своих ног зеркал за прогон).
- Таймаут каждого запроса — `REQUEST_TIMEOUT_MS` (15 с, `shared/lib/fetchRetry.ts`, `AbortSignal.timeout`): больше 10 с,
  за которые Binance сам отвечает -1007. Сработал — сетевая ошибка: чтение после таймаута повторяется не больше
  `TIMEOUT_RETRIES` (1) раза, у ордера исход неизвестен. `actualOrderId` 0 / "" / не положительный — не срабатывал.
- `*Schemas.ts` — Zod-схемы ответов. Числа Binance приходят строками → `z.coerce.number()`.

## Подводные камни
- **Только демо-хосты для ордеров.** Реальный счёт (Live) пока только читает: подписанные запросы с его ключом — только
  через `live.server.ts` и его белый список; в обход списка реальные хосты с торговым ключом не вызывать.
- Демо-фьючерсы иногда не присылают `avgPrice`/`executedQty` — схемы терпят это (`.catch(0)`).
- `exchangeInfo` демо-фьючерсов ~900 КБ — кэшируется на 10 минут, при сбое используется старая копия.
- Лимиты веса Binance: не делать запросов в цикле по сотням символов; кэшировать справочники. Лимит — 6000 веса
  в минуту **на IP**, а исходящий IP Vercel общий с чужими приложениями. Для одной цены — `fetchTickerPrices(market)`
  (`ticker/price`, вес 4/2), а не `ticker/24hr` без символа (вес 80/40).
- После 429/418 ставится пауза на хост: срок берётся из `Retry-After` или «banned until» (по умолчанию 60 с). Во время
  паузы запрос сразу бросает `CooldownError` (`HttpError`) без похода в сеть, потому что повтор во время бана удлиняет бан.
  Пауза общая для публичных (`getJsonWithRetry`) и подписанных (`signedRequest`, с spec 0022) запросов: функции
  `assertNoCooldown` / `recordCooldown` в `src/shared/lib/fetchRetry.ts`. Ордер на паузе не отправлен —
  `orderErrorOutcome` считает его отказом. Пауза одна на процесс (на Vercel — на экземпляр функции), в журнале —
  `binance.cooldown`.
- Ошибки `-1121` (Invalid symbol) и `-4046` (margin type уже установлен) — ожидаемые, обрабатываются явно.
- `-4067` на `/fapi/v1/marginType` — по символу есть открытые ордера (даже если маржа уже изолированная);
  `placeTrade` не доходит до этого вызова, если символ уже в сделке.
- Тесты схем — `demoSchemas.test.ts`; сетевые функции не тестируются (нет моков сети).
- `fetchFundingRates(market)` — `/fapi/v1/premiumIndex` или `/dapi/v1/premiumIndex` одним запросом по всем фьючерсам
  рынка (без ключа): ставки funding для движка лаборатории (F14 и его копии в COIN-M). У поставочных контрактов ставки нет — они пропускаются.

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

## Earn: история начислений (spec 0022, проба 2026-10-15)
Колонка «Вчера» в таблице портфеля. Обе ручки — подписанные GET (USER_DATA, read-only ключ), вес 150 (IP), окно
`startTime`/`endTime` не больше 30 дней (`endTime` включительно), страницы по 100 (`fetchAllPages`).

| Функция | Ручка | Параметры | Поля, которые используем |
|---|---|---|---|
| `fetchFlexibleRewards` | `GET /sapi/v1/simple-earn/flexible/history/rewardsRecord` | `type` **обязателен** (без него `-1102`): `BONUS`, `REALTIME`, `REWARDS`, `ALL`; `startTime`, `endTime` | `rows[] {asset, rewards, productId, type, time}` — в документации `projectId`, в ответе `productId` (схема берёт любое) |
| `fetchLockedRewards` | `GET /sapi/v1/simple-earn/locked/history/rewardsRecord` | `startTime`, `endTime` | `rows[] {positionId, asset, amount, time, type}` — по документации (на аккаунте пробы Locked-позиций нет) |

- `REALTIME` — начисление по базовой ставке, одна строка на продукт за сутки (`time` — 23:59:59 UTC); `BONUS` —
  бонусная ступень (`tierAnnualPercentageRate`), приходит в течение суток. Они не пересекаются: `REALTIME` совпадает
  с `yesterdayRealTimeRewards` позиции, `BONUS` — ровно ступень (500 USDT × 4 % / 365).
- `ALL` отдаёт ровно объединение `BONUS` + `REALTIME` без повторов — загрузчик портфеля делает один запрос вместо
  трёх. `REWARDS` («старая история») за 30 дней пуст; суммируются только `BONUS` и `REALTIME`
  (`features/load-portfolio/model/yesterdayRewards.ts`).
- `rewards`/`amount` — в монете `asset` (монета награды); в USD — по цене этой монеты.
