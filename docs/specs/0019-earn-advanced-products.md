# 0019 · Earn: сложные продукты (Dual, DeFi, стейкинг, RWUSD/BFUSD), гид по рискам и диверсификации

- **Тип:** feature
- **Статус:** approved
- **Раздел PRD:** §3.1 Earn → «Сложные продукты и гид»
- **Дата:** 2026-10-15

## Цель
Раздел `/earn` показывает только Simple Earn. Пользователь хочет видеть, какие ещё виды инвестиций есть в Binance Earn
(бивалютные Dual Investment, DeFi On-chain Yields, стейкинг ETH/SOL, RWUSD/BFUSD и др.), получать по ним аналитику
«простыми словами» и понятные правила диверсификации, чтобы вкладывать максимально безопасно. Пользователь в этих
продуктах не разбирается — объяснения и оценка риска важнее плотных таблиц.

## Решения пользователя (2026-10-15)
- Продукты с данными: **Dual Investment**, **On-chain Yields (DeFi) + ETH/SOL staking**, **RWUSD/BFUSD**.
  Smart Arbitrage, Auto-Invest, Launchpool/Megadrop/HODLer airdrops — только описание в гиде (публичного API нет).
- **Гид + калькулятор**: карточка каждого вида (как работает, что можно потерять, кому подходит, риск 1–5) и
  рекомендуемое распределение суммы по профилю риска (консервативный / умеренный / агрессивный) с пояснениями.
- Размещение: **вкладки внутри `/earn`**: «Simple Earn» · «Dual Investment» · «Стейкинг и DeFi» · «Гид и
  диверсификация». Активная вкладка и сумма — в URL.
- Данные: read-only ключ локально (как у Портфеля); для облака — публичная сводка без ключа.
- Вне scope (отдельные задачи): позиции пользователя в сложных продуктах, снимки и лента изменений для Dual, расчёт
  калькулятора от баланса Портфеля.

## Сценарии
1. Пользователь открывает `/earn` → видит прежний экран Simple Earn на первой вкладке и ещё три вкладки.
2. Открывает «Dual Investment» (локально с ключом) → таблица предложений BTC/ETH/BNB/SOL × USDT/USDC в обе стороны:
   страйк, расстояние до него в %, срок, APR, доход за срок на его сумму, сравнение с Flexible той же монеты.
   Кликает строку → карточка с двумя исходами простыми словами («если BTC на дату расчёта ≥ 72 000 — получите
   7 230 USDT; если ниже — останетесь с 0,1005 BTC»).
3. Открывает «Стейкинг и DeFi» → таблица On-chain Yields, ETH/SOL staking, RWUSD, BFUSD: APR, срок/ликвидность,
   риск 1–5, защита капитала, квота.
4. Без ключа (облако или локально без `BINANCE_API_KEY`) на вкладках Dual и Стейкинг видит карточки «ставки
   сейчас» из публичной сводки Binance (диапазон APR по активу) и пояснение, как получить полный каталог.
5. Открывает «Гид и диверсификация» → 12 карточек видов с риском и живыми ставками; вводит сумму и профиль →
   план: доли по видам, суммы, конкретные продукты, ожидаемый доход, правила диверсификации, дисклеймер.

## Критерии приёмки
- [ ] AC1. На `/earn` четыре вкладки; без `?tab` открыта «Simple Earn» с прежним содержимым (фильтры, топ-3,
      таблица, лента «Что изменилось», кнопка «Обновить сейчас») и прежними URL-параметрами фильтров.
- [ ] AC2. Выбор вкладки пишет `?tab=dual|staking|guide`; `/earn?tab=guide` после перезагрузки открывает гид;
      возврат на Simple убирает параметр.
- [ ] AC3. Локально с ключом вкладка «Dual Investment» показывает таблицу: монета, направление Buy Low / Sell High,
      страйк, дата расчёта, текущая цена, расстояние до страйка в %, APR, срок, доход за срок на сумму из поля
      «Сумма», «vs Flexible» той же монеты в п.п.
- [ ] AC4. Фильтры Dual (монета, направление, макс. дней, мин. расстояние до страйка) меняют строки и хранятся в URL;
      поле «Сумма» общее для всех вкладок (изменение на Simple меняет расчёт на Dual и в калькуляторе).
- [ ] AC5. Клик по строке Dual открывает карточку с двумя исходами простыми словами (что и сколько получу при
      исполнении и без) и эффективной ценой покупки/продажи.
- [ ] AC6. Локально с ключом вкладка «Стейкинг и DeFi» показывает продукты On-chain Yields, ETH staking, SOL staking,
      RWUSD, BFUSD: APR, срок/ликвидность, доход в год на сумму, риск 1–5, защита капитала, остаток квоты.
      Группы, которые не загрузились, перечислены предупреждением, остальные видны.
- [ ] AC7. Без ключа (локально и в облаке `VERCEL=1`) вкладки Dual и Стейкинг показывают карточки «ставки сейчас»
      из публичной сводки (диапазон APR по активу, бейджи «низкий риск»/«распродано») и пояснение: полный каталог —
      только с ключом (локально — как включить; в облаке — «только на компьютере с ключом»). Ошибок в консоли нет.
- [ ] AC8. Ошибка подписанного запроса (например, невалидный ключ) → красное сообщение с текстом ошибки Binance,
      сводка и гид при этом работают. Пустой каталог → «Сейчас предложений нет», а не пустая таблица.
- [ ] AC9. Гид содержит карточку для каждого из 12 видов (Simple Flexible, Simple Locked, Soft Staking, ETH staking,
      SOL staking, RWUSD, BFUSD, Dual, On-chain Yields, Smart Arbitrage, Auto-Invest, Launchpool/Megadrop/airdrops):
      уровень риска 1–5, ликвидность, «капитал защищён / не защищён», разделы «Как работает / Что можно потерять /
      Кому подходит»; живой диапазон APR там, где он есть в сводке; у видов с данными — ссылка на вкладку.
- [ ] AC10. Калькулятор: сумма + профиль (`?profile=conservative|moderate|aggressive`, по умолчанию умеренный) →
      доли по видам, суммы в $, пояснение по каждой корзине, ожидаемый доход в год; сумма долей = 100 %;
      консервативный профиль — 0 % в Dual и DeFi; ликвидный резерв ≥ 10 %.
- [ ] AC11. При наличии снимка Simple Earn корзины Simple заполнены конкретными продуктами (≤ 25 % на один продукт,
      Locked — лестницей сроков); с ключом корзины Dual / стейкинг / DeFi заполнены из каталога; без ключа —
      пометка «нужен ключ» и сумма в «не размещено».
- [ ] AC12. Блок «Правила диверсификации» (≥ 5 правил) в гиде; под калькулятором — дисклеймер «не финансовый совет,
      ставки меняются».
- [ ] AC13. Сортировка новых таблиц работает по всем колонкам и запоминается; имена таблиц `earn:dual` и
      `earn:yield` уникальны (тест).
- [ ] AC14. `pnpm check` и `pnpm build` зелёные; чистые функции (аналитика Dual, ранжирование, калькулятор,
      нормализация, статус-модель загрузчика) покрыты тестами.

## Вне scope
- Позиции пользователя в Dual / стейкинге / DeFi («Мои позиции») — отдельная задача.
- Снимки каталогов Dual/DeFi и лента изменений по ним.
- Подписка на продукты из приложения (никаких ордеров и подписок через API).
- Расчёт калькулятора от баланса Портфеля (другой домен; возможно только через композицию в платформе).
- Smart Arbitrage, Auto-Invest, Launchpool — только описание, без данных.

## Технические заметки

### Источники данных (проверено 2026-10-15)
- Публичного каталога без ключа для Dual / On-chain / стейкинга / RWUSD **нет** (`bapi/…/friendly/finance-earn/
  {dual,dci,onchain,staking,rwusd}/…` → 404; Binance не рекомендует bapi).
- **Публичная сводка** `GET https://www.binance.com/bapi/earn/v1/friendly/finance-earn/homepage/overview` (та же
  семья, что `simpleEarnProducts` в `src/shared/api/binance/client.ts`, `code === "000000"`): ~12 топ-активов,
  `productSummary[] {productType, maxApr, minApr, duration[], lowRisk, soldOut, productId, aprDetailSummary}`.
  `productType`: `SIMPLE_EARN`, `DUAL_CURRENCY` (USDT, USDC, BTC, ETH, BNB, SOL), `ON_CHAIN_YIELDS` (USDT, BTC,
  BNB), `RWUSD` (USDT, USDC), `BFUSD` (USDT, lowRisk), `ARBITRAGE_BOT` (USDT), `ETH_TWO` (ETH staking, lowRisk),
  `BN_SOL_STAKING` (SOL, lowRisk). APR — доли (0.0361 = 3,61 %). Неизвестный `productType` пропускать, не падать.
- Подписанные GET (USER_DATA, read-only ключ, вес 1): Dual `/sapi/v1/dci/product/list` (обязательные `optionType
  CALL|PUT`, `exercisedCoin`, `investCoin`; поля `id, investCoin, exercisedCoin, strikePrice, duration, settleDate,
  purchaseDecimal, purchaseEndTime, canPurchase, apr, orderId, minAmount, maxAmount, createTimestamp, optionType`);
  On-chain `/sapi/v1/onchain-yields/locked/list`; ETH `/sapi/v2/eth-staking/account`, `/sapi/v1/eth-staking/eth/
  quota`; SOL `/sapi/v1/sol-staking/account`, `/sol/quota`; Soft `/sapi/v1/soft-staking/list`; RWUSD
  `/sapi/v1/rwusd/account|quota|history/rateHistory`; BFUSD — то же с `bfusd`. Каталог Dual = [BTC, ETH, BNB, SOL] ×
  [USDT, USDC] × {CALL, PUT} = 16 запросов → серверный кэш 5 мин. `rateHistory` может весить ~150 UID — только при
  холодном кэше или не использовать.
- **Шаг 0 developer (обязательный):** временный `scripts/probe-earn-advanced.ts` (не коммитить) печатает сырые ответы
  всех подписанных ручек; проверить: `settleDate`/`purchaseEndTime` в мс, `apr` — доля или проценты, `duration` — дни,
  семантика CALL ↔ Sell High и PUT ↔ Buy Low против экрана binance.com на одной паре. Итог — сюда и в README клиента.

### Семантика Dual Investment
CALL = «Sell High»: вкладываешь монету, страйк выше цены; если фиксинг-цена на дату расчёта ≥ страйка — монета
продана по страйку + доход (в стейбле); иначе — монета + доход. PUT = «Buy Low»: вкладываешь стейбл, страйк ниже
цены; если цена ≤ страйка — купил монету по страйку + доход; иначе — стейбл + доход. APR платят в любом случае,
**капитал не защищён** (можно остаться не в той валюте). Доход за срок `r = apr × days / 365`; эффективная цена
продажи `strike × (1 + r)`, покупки `strike / (1 + r)`; расстояние `(strike − price) / price`.

### Архитектура (домен Earn, FSD)
- `shared/api/binance`: `fetchEarnOverview()` в `client.ts` + схема; новые `earnAccountSchemas.ts` и
  `earnAccountClient.ts` (`fetchDualProducts`, `fetchOnchainYieldsProducts`, `fetchEthStaking*`, `fetchSolStaking*`,
  `fetchRwusd*`, `fetchBfusd*`, `fetchSoftStakingList`), все числа `z.coerce.number()`, второстепенные поля
  `.optional()`; экспорт через `account.server.ts`, типы через `index.ts`; README — ручки, веса, итог probe.
- `entities/earn-product` (новая): `EARN_KINDS` (12 видов), `dualOfferSchema`, `yieldProductSchema`,
  `kindSummarySchema`/`earnSummarySchema`, `advancedCatalogSchema` (`not-configured {hosting} | error {message} |
  ok {fetchedAt, dual[], yields[], warnings[]}`), `model/normalize.ts`, `lib/dual.ts` (`distanceToStrike`,
  `dualReturn`, `evaluateDual`, `dualScenarios`), `config/kinds.ts` (`EARN_KIND_INFO`: тексты гида, риск,
  ликвидность, защита капитала, `hasData`), хуки `useEarnSummary` (staleTime 10 мин) и `useAdvancedCatalog`
  (5 мин, без refetch на фокус, только с вкладок Dual/Стейкинг/Гид), UI `RiskDots`, `KindBadge`, `DualOfferName`.
- `features/load-earn-catalog` (серверная, по образцу `features/load-portfolio`): `loadEarnSummary`,
  `loadAdvancedCatalog(deps)` — без ключа `not-configured {hosting}`, с ключом `Promise.allSettled` по группам,
  упавшие → `warnings`; кэш в памяти 5 мин; `config/dualUniverse.ts`.
- `features/offer-filters` (расширить): `useDualFilters` (`dcoin`, `side`, `maxDays`, `minDist`),
  `rankDualOffers` (фильтры + лучший Flexible той же монеты через `evaluateOffer` → `edgePp`), `DualFiltersBar`.
- `features/allocation-advice` (новая): `config/profiles.ts` (доли по профилям), `config/rules.ts`
  (`MIN_LIQUID_RESERVE 0.10`, `MAX_SHARE_PER_PRODUCT 0.25`, `MAX_SHARE_PER_PROTOCOL 0.10`, `LOCK_LADDER [30,60,90]`,
  `DUAL_MIN_DISTANCE`, `DUAL_MAX_DAYS`, `DIVERSIFICATION_RULES`), `buildAllocation(amountUsd, profile)`,
  `fillAllocation(buckets, {simpleOffers, catalog, summary}, profile, now)`, `useRiskProfile` (nuqs `amount`,
  `profile`), `RiskProfileForm`.
- Виджеты: `dual-offers-table` (`defineSortTable("earn:dual")`, `HELP`, диалог сценариев), `yield-products-table`
  (`earn:yield`), `kind-summary` (карточки «ставки сейчас»), `earn-guide`, `allocation-plan`.
- `pages/earn`: `model/useEarnView.ts` (nuqs `tab`, default `simple`, `clearOnDefault`), `EarnPage` = шапка +
  `Tabs`; `SimpleEarnTab` (прежний `EarnDashboard` без изменений логики), `DualTab`, `StakingTab`, `GuideTab`,
  `AdvancedAccessNotice`. Роуты `app/api/earn/summary/route.ts`, `app/api/earn/advanced/route.ts`.
- Общий `amount` в URL: один ключ, `parseAsFloat.withDefault(1000)`, объявлен одинаково в трёх фичах (nuqs
  синхронизирует одинаковые ключи; фичи друг друга не импортируют) — зафиксировать комментарием.
- Без миграций и новых env. `docs/ai/architecture.md` — строка домена Earn; PRD §3.1 и §4.

### Стартовые константы (пользователь уточняет при приёмке)
Риск: simple-flexible 1, simple-locked 2, soft-staking 1, eth/sol-staking 2, rwusd 2, bfusd 2, launchpool 2,
auto-invest 3, smart-arbitrage 4, dual 4, onchain 5.
Профили: консервативный — Flexible 60 %, Locked 25 %, RWUSD/BFUSD 15 %; умеренный — Flexible 35 %, Locked 25 %,
RWUSD/BFUSD 15 %, staking 15 %, Dual 10 %; агрессивный — Flexible 20 %, Locked 15 %, RWUSD/BFUSD 10 %, staking 20 %,
Dual 20 %, DeFi 10 %, Smart Arbitrage 5 % (описательно, без продукта). Резерв ≥ 10 % входит в Flexible.

### Риски
- Имена полей подписанных ручек не верифицированы (документация рендерится JS) — шаг 0 и мягкие Zod-схемы.
- Публичная сводка недокументирована и может исчезнуть — UI переживает её ошибку, гид статичен.
- BFUSD/RWUSD без соответствующего аккаунта могут отвечать ошибкой → `warnings`.
- `signedRequest` не ставит cooldown после 429/418 — при кэше 5 мин приемлемо.
- Объём большой: один PR, коммиты по шагам; при затягивании ревью калькулятор можно вынести в следующую задачу.

### Открытые вопросы пользователю
- Достаточно ли монет Dual: BTC, ETH, BNB, SOL × USDT, USDC?
- «Мои позиции» в сложных продуктах — отдельной задачей (предлагаю да).

### Итог пробы полей (шаг 0, 2026-10-15)
- Dual `dci/product/list`: `settleDate`/`purchaseEndTime` — мс; `duration` — дни; `apr` — **доля** (`2.5608` = 256 %,
  у 1-дневных у страйка); `pageSize` ≤ 100, у BTC CALL ~670 предложений (7 страниц), список — от ближнего страйка.
  CALL: `investCoin` = монета, страйк выше цены → Sell High; PUT: `investCoin` = стейбл, страйк ниже → Buy Low
  (зафиксировано тестом `entities/earn-product/model/normalize.test.ts`).
- On-chain `locked/list`: `rows[] {projectId, detail {asset, rewardAsset, duration, isSoldOut, apr, status}, quota
  {totalPersonalQuota, minimum}}`, APR — доля; сейчас 9 продуктов (BTC, USDT, BNB).
- ETH/SOL `quota`: ставки нет — APR берём из `…/history/rateHistory?size=1` (`annualPercentageRate`, доля);
  `redeemPeriod` — дни (ETH 27, SOL 4). То же для RWUSD/BFUSD (`rateHistory`), `quota` — `subscriptionQuota`,
  `standardRedemptionQuota {redeemPeriod, fee}`; у BFUSD нет `subscribeEnable`.
- Soft Staking `list`: `rows[] {asset, apr, minAmount, maxCap}` — ~30 альткоинов.
- Все ручки ответили на read-only ключ; ошибок аккаунта RWUSD/BFUSD не было. Полный каталог — ~4,7 тыс. предложений
  Dual (~1,3 МБ JSON), холодная загрузка ~4–5 с.

## Журнал
| Дата | Событие |
|---|---|
| 2026-10-15 | План утверждён пользователем (plan mode), ТЗ записано; ветка `feature/0019-earn-advanced-products` |
| 2026-10-15 | Developer, ветка `feature/0019-earn-advanced-products`: проба полей, клиент Binance, сущность `earn-product`, загрузчик `load-earn-catalog` и роуты, вкладки `/earn`, Dual (фильтры, таблица, исходы), «Стейкинг и DeFi», гид и калькулятор `allocation-advice` |
