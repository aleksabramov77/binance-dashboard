# 007b · Основной хостинг: Supabase (движок + БД) и Vercel (интерфейс)

- **Тип:** feature (задача 5b эпика [spec 003](003-experiments-lab.md))
- **Статус:** done
- **Раздел PRD:** §3.4 «Авто-бот» → «Лаборатория экспериментов»
- **Дата:** 2026-10-10

## Цель
У пользователя должен быть второй способ запустить лабораторию 24/7 без своего Mac, на случай если Oracle Cloud недоступен: у Oracle 10.10 было обслуживание. **Решение пользователя 2026-10-10 (позже в тот же день): основной вариант — Supabase + Vercel, Oracle VM (задача 5, spec 007) — резерв.** Этот вариант не требует VM: Supabase-проект работает и как база данных, и как планировщик, и как место запуска движка.

## Решения (2026-10-10)
Пользователь: «На Oracle сегодня обслуживание. Давай добавим ещё резервный способ через Supabase». Затем подтвердил чату «Деплой»: основной — Supabase + Vercel, Oracle — резерв.
- **Исполнители:** Vercel-часть (AC5, AC6) — ветка `feat/007c-vercel`; `binance-ping`, `engine-tick`, pg_cron и Vault (AC1–AC4) — ветка `feat/007b-supabase` (AC1 можно сразу, AC2–AC4 — после задач 1d и 2b).
- **БД — Supabase Postgres**, та же, что в плане A, схема и миграции из задачи 2a.
- **Регион проекта — Northeast Asia (Tokyo), `ap-northeast-1`.**
  - Регионов в ОАЭ у Supabase нет.
  - В Токио находятся серверы Binance, и боты обычно работают оттуда, так что ответ 451 там наименее вероятен.
  - Это не ЕС и не США.
  - Запасной регион — South Asia (Mumbai), `ap-south-1`.
- **Тик движка — Supabase Edge Function `engine-tick` (Deno):**
  - pg_cron + pg_net вызывают её раз в минуту;
  - URL вызывается с `?forceFunctionRegion=ap-northeast-1`, чтобы функция всегда шла из Токио;
  - ключ вызова хранится в Supabase Vault.
- **Интерфейс — Vercel Hobby (бесплатно).**
  - Next-приложение без фонового цикла: оно читает БД и показывает страницы.
  - Регион функций Vercel — `hnd1` (Tokyo).
  - Вход через GitHub — задача 4.
- **Ключи:** как в плане A. Ключа реального аккаунта Binance в облаке нет; движок ходит в Binance анонимно, за публичными данными. Ключи Demo появятся только для задачи 6 и только по отдельному решению пользователя.

## Требования к коду, общие для обоих планов
- **Движок не зависит от среды запуска.** Задача 1d пишет тик как функцию с внедряемыми зависимостями: загрузка свечей, хранилище и часы.
  - В ядре нет `node:*`, `process.env`, `fs` и таймеров.
  - План A вызывает его из Next-сервера (`instrumentation.ts`), план B — из Edge Function.
- **Ядро совместимо с Deno.** `@binance-dashboard/trading-core` — чистый TypeScript, внешняя зависимость только `zod`. Edge Function импортирует его исходники с `npm:zod`.
- Хранилище в Edge Function: `npm:postgres` + Drizzle по переменной `SUPABASE_DB_URL`, которую Supabase выдаёт автоматически. Таблицы — из домена `entities/experiment/model/db.ts`.
- **Одновременно работает только один тик-раннер.** В `engine_state` хранится ключ `runner`: `oracle` или `supabase`. Тик чужого раннера сразу завершается, чтобы два плана не открывали одни и те же сделки дважды.

## Лимиты Supabase Free и как в них уложиться
Источник — [Edge Functions limits](https://supabase.com/docs/guides/functions/limits).
- **CPU 2 с на вызов** без учёта ожидания сети, **150 с по времени**, **256 МБ памяти**.
  - Тик лёгкий: индикаторы считаются только на закрытии свечи своего таймфрейма, свечи берутся из кэша в `engine_state`.
  - Если CPU не хватит, тик делится на два вызова — Spot и Futures — со смещением 30 с.
- **500 000 вызовов в месяц.** Раз в минуту — около 43 200, это меньше 10% лимита.
- Free-проект засыпает после недели без активности. Движок пишет в БД каждую минуту, поэтому проект не засыпает.

## Критерии приёмки
- [x] AC1. `supabase/functions/binance-ping` отвечает статусами `api.binance.com/api/v3/ping` и `fapi.binance.com/fapi/v1/ping`, а заголовок `x-sb-edge-region` равен `ap-northeast-1`. Это первая проверка, до остальной работы: при 451 переключаемся на Mumbai.
  - 2026-10-10 ✅: функция задеплоена в `binance-lab` (Tokyo), вызов с `?forceFunctionRegion=ap-northeast-1` — `x-sb-edge-region: ap-northeast-1`, Spot ping `200` (17 мс), Futures ping `200` (53 мс). Регион Tokyo подходит, переключение на Mumbai не нужно.
- [x] AC2. `supabase/functions/engine-tick` выполняет один тик общего движка и пишет сделки и состояние в БД. Повторный вызов в ту же минуту ничего не дублирует.
  - 2026-10-10 ✅ (ветка `feat/007b-engine-tick`): функция вызывает общую композицию `src/app/server/engineTick.ts` (`runEngineTick`, та же на VM) с `runner: "supabase"`; хранилище — Drizzle + `npm:postgres` по `SUPABASE_DB_URL` (`prepare: false`). Код движка и ядра грузится исходниками через import map (`deno.json`). Тик — одна транзакция под `pg_try_advisory_xact_lock`: второй одновременный тик (VM, cron, ручной вызов) получает `locked` и ничего не делает. Запись сделок и неповторение — тесты `engineTick.test.ts` (PGlite). Функция задеплоена; ручной вызов в проде при `runner` ≠ supabase → `foreign-runner`, 137 мс, `x-sb-edge-region: ap-northeast-1`, в БД ничего не записано. Живой тик в проде — после переключения раннера (решение пользователя).
- [x] AC3. Миграция `drizzle/` создаёт задание pg_cron `engine-tick-every-minute`; ключ вызова — в Vault. В «Логах» Supabase видны ежеминутные вызовы.
  - 2026-10-10 ⏳: SQL готов — `supabase/migrations/20261010120000_engine_tick_cron.sql` (идемпотентный), ставится командой `pnpm engine:supabase cron-install` (Vault `engine_tick_url` + `engine_tick_secret`, затем `cron.schedule`). **Отступление от AC:** не в `drizzle/` — pg_cron и pg_net есть только в Supabase (в PGlite тестов их нет), а drizzle-миграции применяются автоматически (`pnpm dev` с `DATABASE_URL`, `pnpm db:migrate`), то есть ежеминутные вызовы в проде начались бы без решения пользователя. В прод не применено — ждёт команды пользователя.
  - 2026-10-14 ✅ в проде (`pnpm engine:supabase status`): `runner: supabase`, `enabled: true`, задание
    `engine-tick-every-minute` активно (`* * * * *`), последние запуски `succeeded`, последний тик `ok` без ошибок.
- [x] AC4. Переключение раннера `oracle ↔ supabase` описано в `docs/ai/deploy-supabase.md`, тик чужого раннера — no-op.
  - 2026-10-10 ✅: `pnpm engine:supabase runner oracle|supabase` (ждёт конца текущего тика — та же advisory-блокировка) или SQL в разделе 7 `deploy-supabase.md`; no-op чужого раннера — тесты и живой вызов (AC2).
- [x] AC5. Vercel: проект из GitHub-репозитория, регион `hnd1`, env (`DATABASE_URL`, `AUTH_*`); страницы лаборатории открываются после входа через GitHub.
  Сделано 2026-10-10: https://binance-dashboard-gold.vercel.app, функции в `hnd1`, env на месте, вход через OAuth App «Binance Dashboard (prod)» пускает `aleksabramov77`, без входа — `/login` и 401. Осталось: страницы лаборатории (задача 3b) — проверить после их мержа.
  2026-10-14 ✅: страницы лаборатории смержены (PR #24–#26) и задеплоены — `/experiments`, `/stats`,
  `/settings` без входа → 307 на `/login`, `GET /api/experiments` → 401. Вид после входа — у владельца.
- [x] AC6. `docs/ai/deploy-supabase.md` — пошаговая инструкция для пользователя (iPhone/Mac, один шаг — одно действие, точные английские названия кнопок): Supabase-проект в Токио, ключи, Vercel, GitHub OAuth App с callback для домена `*.vercel.app`.

## Вне scope
- Отказ от Oracle: скрипты spec 007 остаются резервом (переключение раннера — `engine_state.runner`).
- Платные тарифы: при упоре в лимиты сначала оптимизируем тик.

## Порядок
1. Сразу, без ожидания других задач:
   - пользователь создаёт Supabase-проект в Токио (AC6, раздел Supabase);
   - разработчик делает `binance-ping` (AC1).
2. После задачи 1d (движок) и 2b (БД + движок) — `engine-tick`, pg_cron и переключатель раннера (AC2–AC4).
3. После задачи 4 (вход через GitHub) — Vercel (AC5).

## Журнал
| Дата | Событие |
|---|---|
| 2026-10-10 | Запрос пользователя, ТЗ записано в ветке `docs/007b-supabase-hosting` |
| 2026-10-10 | AC1: `binance-ping` задеплоена (Tokyo, `x-sb-edge-region: ap-northeast-1`), статусы Binance ждут publishable-ключа (ветка `feat/007b-supabase`) |
| 2026-10-10 | AC5/AC6: PR #18 (vercel.json `hnd1`, serverless-режим, инструкция); проект Vercel `binance-dashboard`, адрес https://binance-dashboard-gold.vercel.app, env через API Vercel, OAuth App «Binance Dashboard (prod)»; вход владельца проверен |
| 2026-10-10 | AC1 ✅: из Tokyo Spot ping 200 (17 мс), Futures 200 (53 мс) |
| 2026-10-10 | AC2, AC4 ✅, AC3 ⏳: `engine-tick` + advisory lock тика + pg_cron SQL + `pnpm engine:supabase` (ветка `feat/007b-engine-tick`); функция задеплоена, в проде no-op до переключения раннера |
| 2026-10-14 | AC3, AC5 ✅: раннер `supabase`, pg_cron тика активен; страницы лаборатории в проде за входом. Spec — done (PR #19, #28, #18, #29) |
