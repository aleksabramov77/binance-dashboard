# Деплой: Supabase + Vercel (основной вариант)

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
12. Нажмите **Continue to Dashboard** и скопируйте адрес из **Domains** (вида `binance-dashboard-xxxx.vercel.app`). Пришлите его в чат.

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

## 7. Переключение раннера тика (Oracle ↔ Supabase)
Описывается вместе с `engine-tick` в задаче 5b: ключ `runner` в таблице `engine_state`
(`oracle` | `supabase`), тик чужого раннера ничего не делает.

---

## Ограничения Vercel
| Что | Почему | Что делать |
|---|---|---|
| Earn: «Обновить сейчас» не сохраняет снимок, расписание 09:00/21:00 не работает | снимки — файлы в `data/snapshots`, а диск Vercel только для чтения; расписание — launchd на Mac | Earn пока смотреть локально; перенос снимков в БД — отдельная задача домена Earn |
| «Логи» показывают только журнал одного экземпляра функции | журнал пишется во временный каталог экземпляра | полный журнал — **Vercel → Project → Logs** |
| Старый переключатель «Автосделки (демо)» ничего не делает | фонового процесса нет, demo-ключей нет | убирается в задаче 3e |
| Запросы к Binance идут из Tokyo (`hnd1`) | регион функций | если Binance ответит 451 — сменить регион в `vercel.json` (spec 007b: запасной — Mumbai, `bom1`) |
