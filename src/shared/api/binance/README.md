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
- `demoTrading.ts` — справочник символов, цены, балансы, ордера Spot/OCO, Futures + algo TP/SL, позиции,
  `fetchDemoOpenSymbols` — символы с открытой позицией или ордерами. История: `fetchDemoTradedSymbols` —
  снимок `DemoTradeSnapshot` (символы + позиции futures + баланс spot одним заходом), `fetchDemoFills`
  (myTrades / userTrades), `fetchDemoSymbolOrders` (сеть) → разбор в чистом `demoOrders.ts`
  (`toFuturesSymbolOrders` / `toSpotSymbolOrders`: чем исполнился выход — algo TP/SL у futures по
  `actualOrderId`, ликвидация по `clientOrderId` `autoclose-…`, тип ордера OCO у spot; активные стопы
  со стороной). Тесты разбора — `demoOrders.test.ts`.
- `*Schemas.ts` — Zod-схемы ответов. Числа Binance приходят строками → `z.coerce.number()`.

## Подводные камни
- **Только демо-хосты для ордеров.** Live-торговли нет намеренно; не добавлять реальные торговые хосты.
- Демо-фьючерсы иногда не присылают `avgPrice`/`executedQty` — схемы терпят это (`.catch(0)`).
- `exchangeInfo` демо-фьючерсов ~900 КБ — кэшируется на 10 минут, при сбое используется старая копия.
- Лимиты веса Binance: не делать запросов в цикле по сотням символов; кэшировать справочники.
- Ошибки `-1121` (Invalid symbol) и `-4046` (margin type уже установлен) — ожидаемые, обрабатываются явно.
- `-4067` на `/fapi/v1/marginType` — по символу есть открытые ордера (даже если маржа уже изолированная);
  `placeTrade` не доходит до этого вызова, если символ уже в сделке.
- Тесты схем — `demoSchemas.test.ts`; сетевые функции не тестируются (нет моков сети).
- `fetchFundingRates` — `/fapi/v1/premiumIndex` одним запросом по всем фьючерсам (без ключа): ставки
  funding для движка лаборатории (F14). У поставочных контрактов ставки нет — они пропускаются.
