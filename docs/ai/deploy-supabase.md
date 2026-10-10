# Деплой: Supabase + Vercel (основной вариант)

**Сейчас:** https://binance-dashboard-gold.vercel.app — Vercel-проект `binance-dashboard` (команда `aleksabramov77s-projects`), функции в `hnd1`.
Прод-секреты (`AUTH_SECRET`, `CRON_SECRET`, OAuth prod-App) — копия на Mac владельца: `~/.config/vercel/binance-dashboard-prod.env` (chmod 600); токен Vercel — `~/.config/vercel/claude-mac.token`.

Решение владельца 2026-10-10: основной хостинг — Supabase + Vercel, резерв — Oracle VM ([deploy.md](deploy.md)).
Требования и критерии — [spec 007b](../specs/007b-supabase-hosting.md).

| Узел | Где | Что делает |
|---|---|---|
| База | Supabase `binance-lab`, Northeast Asia (Tokyo) `ap-northeast-1` | Postgres; подключение — Transaction pooler, порт 6543, IPv4 |
| Фоновый тик | Supabase Edge Function `engine-tick` + pg_cron (задача 5b) | раз в минуту, регион Tokyo |
| Интерфейс | Vercel Hobby, регион функций `hnd1` (Tokyo, `vercel.json`) | страницы и API по запросу; фоновых задач нет |
| Вход | GitHub OAuth App → Auth.js (spec 006) | пускает только `aleksabramov77` |

Автодеплой: Vercel сам собирает каждый push в `main` (production) и каждую ветку PR (preview).

**Ключи Binance в облако не кладём:** ни ключ реального аккаунта, ни demo-ключи (demo — только по
отдельному решению владельца). На Vercel блоки «Портфель» и «Сделка в демо» показывают «не настроено».

## Кто что делает
- **Владелец (iPhone)** — нажатия в Vercel и GitHub: шаги 2, 3 и 5.
- **Claude (Mac)** — переменные окружения через Vercel CLI, миграции БД, проверка (шаги 4 и 6).
  Секреты берутся из `.env.local` на Mac; в чат присылаются только токен Vercel и Client ID/секрет prod-App.

---

## 1. Supabase — уже сделано
Проект `binance-lab` создан в Tokyo, миграции применены (spec 007b). Если понадобится создать заново:
**New project** → **Region**: **Northeast Asia (Tokyo)** → **Create new project**; строка подключения —
**Connect** → **Transaction pooler** → **Copy** (порт `6543`). Прямое подключение (`db.<ref>.supabase.co`)
на Free работает только по IPv6 — его не используем.

## 2. Проект на Vercel
1. Откройте https://vercel.com/signup.
2. Нажмите **Continue with GitHub** (личный аккаунт `aleksabramov77`).
3. Если спросят тариф — выберите **Hobby**, введите имя и нажмите **Continue**.
4. Нажмите **Add New…** → **Project**.
5. В блоке **Import Git Repository** нажмите **Install** (или **Adjust GitHub App Permissions**).
6. Выберите **Only select repositories** → `binance-dashboard` → **Install**.
7. Напротив `binance-dashboard` нажмите **Import**.
8. **Project Name** оставьте `binance-dashboard` (от него зависит адрес `https://binance-dashboard-….vercel.app`).
9. **Framework Preset** — **Next.js**, остальное не меняйте.
10. Нажмите **Deploy**.
11. Дождитесь окончания (2–3 минуты). Сайт пока ответит «Вход не настроен» — так и должно быть.
12. Нажмите **Continue to Dashboard**. Постоянный адрес — короткий production-домен проекта: **`https://binance-dashboard-gold.vercel.app`** (Vercel выдал сам, т.к. `binance-dashboard.vercel.app` занят).
    Адреса вида `binance-dashboard-<хеш>-aleksabramov77s-projects.vercel.app` — отдельные сборки, они закрыты Vercel Authentication и для входа не годятся.

## 3. Токен Vercel для Claude
1. Откройте https://vercel.com/account/settings/tokens.
2. Нажмите **Create Token**.
3. **Token Name**: `claude-mac`.
4. **Scope**: ваш личный аккаунт (Hobby).
5. **Expiration**: **30 days**.
6. Нажмите **Create** и скопируйте токен.
7. Пришлите его в чат. Claude сохранит его в `.env.local` на Mac (`VERCEL_TOKEN`) и дальше пересылать не нужно.
   Отозвать токен можно там же: **Delete**.

## 4. Переменные окружения — делает Claude
С Mac: `pnpm dlx vercel@<версия> link` → `vercel env add <ИМЯ> production` для каждой переменной.

| Переменная | Откуда | Зачем |
|---|---|---|
| `DATABASE_URL` | `.env.local` (Transaction pooler, 6543) | БД; без неё на Vercel приложение сразу падает с понятной ошибкой |
| `AUTH_SECRET` | генерирует Claude (`openssl rand -base64 32`) | подпись сессий Auth.js |
| `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | шаг 5, «Binance Dashboard (prod)» — из чата, только в Vercel | вход через GitHub |
| `AUTH_ALLOWED_GITHUB_LOGINS` | `aleksabramov77` | allowlist |
| `OPENROUTER_API_KEY` | `.env.local` | «Разбор от ИИ»; доступ закрыт входом |
| `CRON_SECRET` | генерирует Claude (`openssl rand -hex 32`) | без него в production `/api/cron/*` отвечает 503 (fail-closed). Тик по spec 007b идёт из Supabase в Edge Function, а не в Vercel; если когда-нибудь Supabase будет дёргать `POST /api/cron/tick`, тот же секрет кладётся в Vault и шлётся как `Authorization: Bearer <CRON_SECRET>` |

Важно: при неполном наборе `AUTH_*` в production приложение отвечает 503 на всё (fail-closed, spec 006).

Не задаются: `BINANCE_*` (ключи на сервер не кладём), `LOG_DIR` (на Vercel логи сами пишутся во временный каталог).

## 5. GitHub OAuth App для production
Нужен адрес из шага 2.12. Решение владельца 2026-10-10: **отдельное prod-App** — у прода свой секрет,
утечка локального `.env.local` не открывает вход в прод.
1. Откройте https://github.com/settings/developers.
2. Нажмите **OAuth Apps**.
3. Нажмите **New OAuth App**.
4. **Application name**: `Binance Dashboard (prod)`.
5. **Homepage URL**: `https://<адрес из шага 2.12>`.
6. **Authorization callback URL**: `https://<адрес из шага 2.12>/api/auth/callback/github`.
7. Нажмите **Register application**.
8. Скопируйте **Client ID** и пришлите в чат.
9. Нажмите **Generate a new client secret**.
10. Скопируйте секрет (показывается один раз) и пришлите в чат. Claude внесёт его только в Vercel.

«Binance Dashboard (local)» (spec 006, `localhost:5000`/`5001`) остаётся только для локального запуска.

Callback работает только для production-адреса. Preview-сборки веток PR откроются, но вход в них
не пройдёт — для проверки используйте production или локальный запуск.

## 6. Запуск и проверка — делает Claude
1. После шага 5 запускает **Redeploy** production.
2. Проверяет:
   - без входа — редирект на `/login`, `/api/*` → 401;
   - вход через GitHub пускает `aleksabramov77`;
   - страницы открываются, функции работают в `hnd1` (заголовок ответа `x-vercel-id` содержит `hnd1`).

## 7. Тик движка в Supabase и переключение раннера (Oracle ↔ Supabase)
Тики исполняет только один раннер: ключ `runner` в `engine_state` (`oracle` | `supabase`, не задан —
`oracle`). Тик чужого раннера ничего не делает (`foreign-runner`): ни сделок, ни записей в БД. Кроме того,
любой тик (VM, `/api/cron/tick`, Edge Function) идёт в транзакции под `pg_try_advisory_xact_lock`
(ключ `ENGINE_TICK_LOCK_KEY`): пока один тик работает, второй сразу завершается со статусом `locked`.

Все команды — с Mac из корня репозитория, секреты берутся из `.env.local` и не печатаются
(`ENV_FILE=<путь>` — другой файл). Скрипт — `scripts/engine-supabase.ts`.

| Команда | Что делает | Меняет прод |
|---|---|---|
| `pnpm engine:supabase status` | раннер, тумблер, последний тик, задание pg_cron и 5 последних запусков | нет |
| `pnpm engine:supabase secret` | `ENGINE_TICK_SECRET`: создаёт в `.env.local`, если нет, и пишет в секреты функций (Management API) | секрет функции |
| `pnpm engine:supabase invoke` | один ручной `POST` в `engine-tick` (Tokyo), печатает статус, регион и итог тика | только если `runner` = supabase |
| `pnpm engine:supabase cron-install` | `secret` + Vault (`engine_tick_url`, `engine_tick_secret`) + задание pg_cron `engine-tick-every-minute` | да: вызовы раз в минуту |
| `pnpm engine:supabase cron-remove` | снимает задание pg_cron | да |
| `pnpm engine:supabase runner supabase` | тики исполняет Supabase (ждёт конца текущего тика) | да |
| `pnpm engine:supabase runner oracle` | тики исполняет VM / Next-сервер | да |

### Запуск движка в Supabase (решение владельца)
1. `pnpm engine:supabase cron-install` — каждую минуту pg_cron вызывает функцию. Пока `runner` = oracle,
   вызовы — no-op (`foreign-runner`, ~150 мс); так можно проверить расписание без последствий.
2. Проверка: `pnpm engine:supabase status` → у задания есть запуски со `status: succeeded`;
   Supabase → **Edge Functions** → **engine-tick** → **Logs** — вызов раз в минуту.
3. `pnpm engine:supabase runner supabase` — с этой минуты тики исполняет Supabase.
4. Тумблер «Автоторговля» в интерфейсе (или `engine_state.enabled = true`) — движок начинает торговать
   (paper). Пока тумблер выключен, тик отвечает `disabled`.
5. Если на VM тоже запущен Next-сервер, его тики становятся no-op сами; `ENGINE_RUNNER` на VM менять не нужно.

Обратно на Oracle: `pnpm engine:supabase runner oracle` (вызовы pg_cron снова no-op) и при желании
`pnpm engine:supabase cron-remove`.

То же через **SQL Editor** Supabase, без скрипта:
```sql
-- кто исполняет тики
insert into engine_state (key, value) values ('runner', '"supabase"')  -- или '"oracle"'
on conflict (key) do update set value = excluded.value, updated_at = now();
-- состояние
select key, value from engine_state where key in ('runner', 'enabled', 'last_tick');
select * from cron.job_run_details order by start_time desc limit 5;
-- снять задание
select cron.unschedule('engine-tick-every-minute');
```

### Почему задание pg_cron не в `drizzle/`
`supabase/migrations/20261010120000_engine_tick_cron.sql` — отдельно от drizzle-миграций: pg_cron и pg_net
есть только в Supabase (в PGlite тестов и локальной БД их нет), а drizzle-миграции применяются
автоматически (`pnpm dev` с `DATABASE_URL` прода, `pnpm db:migrate`) — ежеминутные вызовы начались бы
без решения владельца. Файл идемпотентный: `create extension if not exists`, `cron.schedule` с тем же
именем заменяет задание. Адрес функции и ключ вызова задание читает из Vault при каждом запуске.

---

## Ограничения Vercel
| Что | Почему | Что делать |
|---|---|---|
| Earn: «Обновить сейчас» не сохраняет снимок, расписание 09:00/21:00 не работает | снимки — файлы в `data/snapshots`, а диск Vercel только для чтения; расписание — launchd на Mac | Earn пока смотреть локально; перенос снимков в БД — отдельная задача домена Earn |
| «Логи» показывают только журнал одного экземпляра функции | журнал пишется во временный каталог экземпляра | полный журнал — **Vercel → Project → Logs** |
| Запросы к Binance идут из Tokyo (`hnd1`) | регион функций | если Binance ответит 451 — сменить регион в `vercel.json` (spec 007b: запасной — Mumbai, `bom1`) |

## Edge Functions (Supabase)
Код — `supabase/functions/*` (Deno), конфигурация CLI — `supabase/config.toml`; `tsconfig.json` их исключает, Biome проверяет.

### Деплой функции
Нужны `SUPABASE_PROJECT_REF` и `SUPABASE_ACCESS_TOKEN` в `.env.local` (как получить — `.env.example`).
Docker не нужен: флаг `--use-api` собирает функцию на стороне Supabase.

```bash
set -a; source .env.local; set +a
pnpm dlx supabase@2.120.0 functions deploy binance-ping --project-ref "$SUPABASE_PROJECT_REF" --use-api
```

CLI кладёт локальное состояние в `supabase/.temp/` — папка в `.gitignore`.

### Функция engine-tick
```bash
pnpm check:edge   # deno check функций (Deno скачивается через pnpm dlx)
pnpm dlx supabase@2.120.0 functions deploy engine-tick --project-ref "$SUPABASE_PROJECT_REF" --use-api
```
- Общий код (`src/app/server/engineTick.ts`, `features/paper-engine`, `entities/experiment`,
  `packages/trading-core`, `shared/api/binance/marketApi.ts`) подключается исходниками через import map
  `supabase/functions/engine-tick/deno.json`; npm-пакеты — `npm:zod`, `npm:drizzle-orm`, `npm:postgres`
  тех же версий, что в `package.json` (обновляете пакет — обновите и `deno.json`).
- Бандлер Supabase не угадывает расширения: в этих модулях относительные импорты — с `.ts`
  (Biome `useImportExtensions`). Добавляете в import map новый модуль — те же правила.
- БД — `SUPABASE_DB_URL` (Supabase задаёт сам), `prepare: false`.
- Вызов — только `POST` с `Authorization: Bearer <ENGINE_TICK_SECRET>`; `verify_jwt = false`
  (`supabase/config.toml`), секрет проверяет функция. Нет секрета у функции — `503`, неверный — `401`.
- Ответ — итог тика: `status` (`ok` | `disabled` | `foreign-runner` | `locked`), `opened`, `closed`,
  `evaluated`, `errors`, `ms`, `region`. Лимиты Free: CPU 2 с, 150 с по времени (spec 007b).

### Проверка доступа к Binance
Функция `binance-ping` параллельно вызывает публичные `GET https://api.binance.com/api/v3/ping` (Spot)
и `GET https://fapi.binance.com/fapi/v1/ping` (USDⓈ-M Futures) с таймаутом 8 с. Ключей Binance нет.

Проверка JWT включена (`verify_jwt = true`), поэтому вызов — с publishable/anon ключом проекта
(Project Settings → API Keys). Ключ в git не коммитим.

```bash
curl -i "https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/binance-ping?forceFunctionRegion=ap-northeast-1" \
  -H "Authorization: Bearer <publishable или anon key>"
```

Вместо `?forceFunctionRegion=` можно передать заголовок `x-region: ap-northeast-1`. Без них Supabase
запускает функцию в регионе, ближайшем к вызывающему, — для проверки Binance это бессмысленно.

Ответ:
```json
{
  "spot": { "status": 200, "ms": 45 },
  "futures": { "status": 200, "ms": 52 },
  "region": "ap-northeast-1",
  "at": "2026-10-10T07:45:00.000Z"
}
```

Что смотреть:
- **Заголовок `x-sb-edge-region`** — где реально выполнилась функция. Должен совпадать с запрошенным
  регионом; `region` в теле — то же самое из переменной `SB_REGION` рантайма.
- **`status: 200`** — Binance пускает запросы из этого региона, движок может работать здесь.
- **`451`** — Binance блокирует регион (ограниченная юрисдикция). **`403`** — блокировка CloudFront/WAF.
  В обоих случаях регион не годится: проверить запасные (`ap-south-1` Mumbai, `ap-southeast-1`
  Singapore, `ap-northeast-2` Seoul) и сообщить пользователю — смена региона движка — его решение.
- **`status: null` + `error`** — сетевая ошибка или таймаут 8 с; повторить вызов.
- **HTTP 401 от самой функции** (`sb-error-code: UNAUTHORIZED_*`) — не передан или неверен ключ.

Результаты проверок — в spec 007b, критерий AC1.
