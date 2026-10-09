# features/auto-trade

Серверный слайс: фоновая автоторговля в **Binance Demo** — вход по каждому сетапу сканера, чтобы набрать
статистику правил. Spec: `docs/specs/002-auto-trade.md`. Из клиентских компонентов не импортировать;
UI — `features/auto-trade-toggle`.

## Публичный API
- `startAutoTrader(deps)` — запускает таймер (один на процесс). Вызывается из `instrumentation.ts`
  через `src/app/server/autoTrade.ts`, где фича получает `scan`/`recheck`/`place`/`overview` других фич.
- `setAutoTradeEnabled(enabled, deps)` — переключатель (`POST /api/auto-trade`); включили — цикл сразу.
- `getAutoTradeState()` — состояние для `GET /api/auto-trade`.
- `AUTO_TRADE` — все параметры (интервал, риск, объём, плечо, пауза, лимиты).

## Цикл (`model/runCycle.ts`)
1. Обзор демо-счёта (балансы, открытые символы) и скан (кэш сканера 60 с).
2. `lib/planEntries.ts` — отбор: статус ready/watch, есть в демо, символ не в сделке, пауза 2 ч по
   `SYMBOL:direction`, ≤ 5 входов за цикл, ≤ 20 символов в сделке.
3. На каждый: `recheckSetup` (stale → пропуск, иначе свежие уровни) → `lib/sizeAutoTrade.ts` →
   `placeTrade` (TP1 + SL, `setupId: auto:…`). Отметка паузы — если позиция могла открыться (не rejected).
4. Решения — в `state.actions` (одинаковые пропуски подряд не дублируются) и в журнал `auto.*`.

## Подводные камни
- Таймер и состояние — в `globalThis` и `data/auto-trade.json`: в dev instrumentation и роуты собираются
  разными бандлами, переменная модуля у них разная. Флаг включения читается из файла каждый цикл.
- Битый файл состояния → автоторговля выключена (не наоборот).
- Сервер выключен/спит → циклов нет, но открытые позиции защищены TP/SL на бирже.
- Путь файла можно переопределить `AUTO_TRADE_STATE_FILE`.

## Тесты
`lib/planEntries.test.ts`, `lib/sizeAutoTrade.test.ts`, `model/runCycle.test.ts` (фейковые зависимости).
