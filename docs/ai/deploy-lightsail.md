# Своя VM apps-tokyo (AWS Lightsail Tokyo)

Решение владельца 2026-10-15: прод переезжает с Vercel + Supabase на свою VM ([spec 0017](../specs/0017-lightsail-vm.md),
план — шаги 0–6). Причины: свой IP, поэтому весь лимит Binance только наш (14.10 Binance банил общий IP Vercel, spec 0014);
постоянный процесс; дешевле Supabase Pro. С шага «переключение» ([spec 0055](../specs/0055-cutover-to-vm.md), раздел
[«Переключение прода на VM»](#переключение-прода-на-vm)) прод — VM: сайт, API, тик движка, фоновые задачи и бот Telegram.
Supabase — только база Postgres ([deploy-supabase.md](deploy-supabase.md)); Vercel новых выкаток не получает и неделю
остаётся резервом с той же базой (тик там не идёт). До переключения VM работала рядом с той же базой, тик на ней — no-op.

Репозиторий публичный: IP VM, ключи и секреты сюда не пишем. Они в секретах GitHub Actions и в
`/etc/<проект>/app.env` на VM. Ниже `<ip>` — static IP инстанса (Lightsail → Networking).

## Устройство

| Что | Где |
|---|---|
| VM | Lightsail `apps-tokyo`: Tokyo, Ubuntu 24.04, $5 (512 МБ, 2 vCPU, 20 ГБ), static IP `apps-tokyo-ip`, порты 22/80/443, ежедневные снимки (00:00 UTC) |
| Общая настройка | `scripts/server/bootstrap.sh`: пользователи, Node 22, Caddy, sqlite3, swap 2 ГБ, unattended-upgrades, fail2ban, SSH только по ключам |
| Проекты | `scripts/server/add-project.sh`: свой Linux-пользователь, `/srv/<проект>/app` (код), `/var/lib/<проект>` (данные), `/etc/<проект>/app.env` (секреты, 640), `<проект>.service` с `MemoryMax`, сайт `/etc/caddy/sites/<проект>.caddy` |
| binance | сайт `https://binance.<ip>.sslip.io` → 127.0.0.1:5000, `MemoryMax=300M`, `--stop-timeout 30` |
| binance-live | фоновый `live-worker.mjs` эпика «Реальные деньги» (spec 0047): без порта и Caddy, `MemoryMax=128M`, `--stop-timeout 120` |
| Выкатка | `.github/workflows/deploy.yml`: сама после зелёного CI на `main` (`workflow_run`, коммит, который проверил CI) и вручную с выбором ветки или коммита. `next build` (`output: "standalone"`) в CI → rsync бандла под `deploy` → `systemctl restart` → проверка ответа. Vercel из `main` не выкатывается (`vercel.json` → `git.deploymentEnabled`, spec 0055) |

Пользователи VM:
- `claude` — администратор (sudo), через него работает AI, ключ `~/.ssh/lightsail_apps_tokyo` на Mac владельца;
- `aleksandr` — администратор (sudo) для владельца, его ключ `~/.ssh/apps_tokyo`;
- `deploy` — вход для GitHub Actions (ключ `~/.ssh/apps_tokyo_deploy`, приватная часть — в секрете Actions); может только
  писать в `/srv/<проект>/app` и `sudo systemctl enable|restart <проект>`, `sudo systemctl status <проект> --no-pager`, `sudo journalctl -u <проект> -n 80 --no-pager`;
- `binance`, `binance-live` — сервисы, без входа и без sudo.

Вход под `root` и по паролю закрыт, встроенный `ubuntu` закрыт (`AllowUsers`). Lightsail browser SSH поэтому не
работает — аварийный доступ: снимок → новый инстанс.

Переменные `binance` (`/etc/binance/app.env`): `APP_HOST=vm` (источник журнала `vm`, хостинг «облако»),
`ENGINE_RUNNER=oracle` (роль «свой постоянный процесс»), `AUTH_URL`, `AUTH_GITHUB_ID/SECRET` (отдельное OAuth App под
адрес VM), `AUTH_SECRET`, `AUTH_ALLOWED_GITHUB_LOGINS`, `DATABASE_URL`, `CRON_SECRET`, `OPENROUTER_API_KEY`,
`ANALYSIS_MODEL`, `TELEGRAM_*` (в т.ч. `TELEGRAM_WEBHOOK_SECRET` — тот же, что на Vercel), `LOG_DIR=/var/lib/binance/logs`
(файловый журнал `app-YYYY-MM-DD.jsonl` с debug: каталог кода только для чтения, писать можно только в `/var/lib/binance`;
без `LOG_DIR` файл не пишется), с переключения — `BINANCE_DEMO_API_KEY` / `BINANCE_DEMO_API_SECRET` (демо-зеркало,
решение владельца 2026-10-17). Ключа реального аккаунта Binance на VM нет (решение владельца 2026-10-15; позже — в базе
в зашифрованном виде); «Портфель» и сложные продукты Earn на VM показывают «ключ не настроен».

Остановка сервиса: `add-project.sh --stop-timeout <сек>` задаёт в unit `KillSignal=SIGTERM` и `TimeoutStopSec=<сек>` —
сколько systemd ждёт выхода после SIGTERM до SIGKILL (без параметра — 90 с по умолчанию). Значение — с запасом над
замеренным временем остановки: `binance` — 30 (тик и прогон зеркала успевают закончиться), `binance-live` — 120 (воркер
дожидается ответа биржи по открытым заявкам, просьба сессии 0047). Замер: `time sudo systemctl stop binance` и
`sudo journalctl -u binance -n 20 --no-pager | grep -E "stop-sigterm|SIGKILL"` — строк быть не должно. Повторный
`add-project.sh` перезаписывает unit и перезапускает сервис, секреты и данные не трогает.

## Фоновые задачи

Кто и когда запускает (spec 0048):

| Задача | Расписание (UTC) | До переключения (`engine_state.runner = supabase`) | После переключения (`runner = oracle`, spec 0055) |
|---|---|---|---|
| Тик лаборатории | каждую минуту, +5 с | Edge Function Supabase (pg_cron) | таймер VM (`experimentEngine.ts`) |
| Снимок Earn | `0 3,15 * * *` | pg_cron → Vercel `/api/cron/earn-snapshot` | таймер VM |
| Монитор журнала и места в базе | `*/15 * * * *` | pg_cron → Vercel `/api/cron/log-monitor` | таймер VM |
| Демо-зеркало | `* * * * *`, +20 с | pg_cron → Vercel `/api/cron/demo-mirror` | таймер VM (demo-ключи в `/etc/binance/app.env`) |
| Авто-зеркало | `0 7 * * *` | pg_cron → Vercel `/api/cron/mirror-auto` | таймер VM |

Таймеры (`src/app/server/backgroundJobs.ts`) стартуют вместе с сервером только при `APP_HOST=vm` и перед каждым
запуском сверяют `ENGINE_RUNNER=oracle` с `engine_state.runner` в БД. Пока там `supabase`, таймеры срабатывают и
пропускают работу. Строка о пропуске — только при смене состояния задачи: после старта сервиса в `journalctl -u binance`
по одной строке на задачу при её первом срабатывании (`[log] · cron.…: <задача>: пропуск — задачи выполняет другой
раннер …`; демо-зеркало — в первую минуту, монитор — в ближайшую четверть часа, Earn и авто-зеркало — в своё время),
дальше пропуски молча. Когда задача снова выполняется — одна строка `<задача>: задача снова выполняется`; смена причины
пропуска (например, «прошлый запуск ещё идёт») — новая строка. В журнале БД записей этих задач с `source = vm` нет.
Не удалось прочитать `engine_state.runner` (БД недоступна) — отдельный пропуск «раннер неизвестен»: одна запись `warn`
на серию (`<задача>: пропуск — раннер неизвестен …`, с текстом ошибки), не `error` каждую минуту — монитор считает
всплески только по `error` и тревогу на это не шлёт. БД вернулась — строка «задача снова выполняется».
Проверка после выкатки:
`ssh claude@<ip> 'sudo journalctl -u binance --since "-5 min" --no-pager | grep -E "jobs.start|пропуск"'`.
При переключении задания pg_cron снимаются той же серией, что и смена runner (spec 0055): роуты `/api/cron/*` на Vercel
runner не проверяют, и без снятия заданий задачи выполнялись бы дважды.

## Шаги владельца (MacBook)

Шаг 0. Аккаунт AWS не под root:
1. Консоль AWS → имя аккаунта справа вверху → **Security credentials** → **Assign MFA device** → **Authenticator app**.
2. Поиск → **IAM** → **Users** → **Create user** → `aleksandr` → **Provide user access to the AWS Management Console** →
   **I want to create an IAM user** → пароль → **Next** → **Attach policies directly** → `AdministratorAccess` → **Create user**.
3. Войти по **Console sign-in URL** под `aleksandr` и включить MFA и ему. Root — только для оплаты.

Инстанс (сделано 2026-10-16): Lightsail → **Create instance** → Tokyo → **Linux operating system** → **Ubuntu 24.04 LTS**
→ General purpose, Dual-stack, **$5** → **Advanced settings** → SSH key → **Upload key** (`~/.ssh/lightsail_apps_tokyo.pub`)
→ **Enable Automatic Snapshots** → имя `apps-tokyo` → **Create instance**. Затем **Networking** → **Create static IP**
(Tokyo, attach `apps-tokyo`) и в файрволе инстанса **Add rule** → **HTTPS** (Anywhere IPv4 + Anywhere IPv6).

Свой ключ для входа: `ssh-keygen -t ed25519 -f ~/.ssh/apps_tokyo -C aleksandr@apps-tokyo` (с паролем) — Claude
добавляет его пользователю `aleksandr` (`OWNER_KEY=… bootstrap.sh`). Вход: `ssh -i ~/.ssh/apps_tokyo aleksandr@<ip>`.

GitHub OAuth App под VM: GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**:
Homepage `https://binance.<ip>.sslip.io`, callback `https://binance.<ip>.sslip.io/api/auth/callback/github` →
**Register application** → **Generate a new client secret**. Client ID и secret — в `/etc/binance/app.env`.

Секреты GitHub Actions (репозиторий → **Settings** → **Secrets and variables** → **Actions**): `APPS_TOKYO_HOST` (IP),
`APPS_TOKYO_USER` = `deploy`, `APPS_TOKYO_SSH_KEY` (содержимое `~/.ssh/apps_tokyo_deploy`). Не `VM_*`: под этими именами
старый Oracle-workflow начал бы падать.

## Runbook

| Задача | Команда |
|---|---|
| Выкатить `main` | само после зелёного CI на `main`; повторить — `gh workflow run deploy.yml -f ref=main` |
| Выкатить ветку | `gh workflow run deploy.yml -f ref=<ветка>` (или Actions → Deploy → Run workflow) |
| Журнал сервиса | `ssh claude@<ip> 'sudo journalctl -u binance -n 100 --no-pager'` |
| Рестарт | `ssh claude@<ip> 'sudo systemctl restart binance'` |
| Секреты | `ssh claude@<ip> 'sudoedit /etc/binance/app.env'` → рестарт |
| Новый проект (сайт) | `sudo bash add-project.sh <имя> --port <порт> [--stop-timeout <сек>]` → `https://<имя>.<ip>.sslip.io` |
| Новый фоновый сервис | `sudo bash add-project.sh <имя> --no-web --exec <файл> --memory 128M --heap 96 [--stop-timeout <сек>]` |
| Таймаут остановки binance | `sudo bash ~claude/server-scripts/add-project.sh binance --port 5000 --stop-timeout 30` (скрипт на VM — обновить копию из `scripts/server/`) |
| Повторить общую настройку | `sudo CLAUDE_KEY=… DEPLOY_KEY=… [OWNER_KEY=…] bash bootstrap.sh` (повторный запуск сам держит `ubuntu` закрытым) |

Скрипты лежат в `scripts/server/`; на VM их копия — `~claude/server-scripts/`.

## Переключение прода на VM

Spec 0055. Выполняет Claude после мержа PR 0055 и успешной автовыкатки VM из CI (Actions → Deploy по `workflow_run`).
Пауза торговли ≈ 1 мин. Команды `pnpm *:supabase` и `telegram:setup` — на Mac из основного checkout (`.env.local`:
`DATABASE_URL`, `TELEGRAM_*`); `ssh` — под `claude`. Значения секретов не выводить.

1. **Таймаут остановки и журнал.** Обновить копию скриптов на VM (`scp scripts/server/add-project.sh claude@<ip>:server-scripts/`)
   и применить таймаут: `ssh claude@<ip> 'sudo bash server-scripts/add-project.sh binance --port 5000 --stop-timeout 30'`
   (значение уточняется замером, см. «Остановка сервиса» выше). В `/etc/binance/app.env` (`sudoedit`) добавить
   `LOG_DIR=/var/lib/binance/logs`.
2. **Demo-ключи.** В тот же `/etc/binance/app.env` — `BINANCE_DEMO_API_KEY=…` и `BINANCE_DEMO_API_SECRET=…` (значения из
   `.env.local` владельца; не печатать, не передавать через аргументы командной строки — `sudoedit` или
   `ssh … 'sudo tee -a /etc/binance/app.env >/dev/null' < файл`). Права файла остаются `640 root:binance`:
   `ssh claude@<ip> 'sudo stat -c "%a %U:%G" /etc/binance/app.env'` → `640 root:binance`.
3. **Рестарт VM-сервиса:** `ssh claude@<ip> 'sudo systemctl restart binance'`; ответ —
   `curl -s -o /dev/null -w '%{http_code}' https://binance.<ip>.sslip.io/` (2xx–3xx).
4. **Смена раннера и снятие заданий pg_cron — одной серией** (окно между ними — секунды, иначе задачи выполнятся дважды
   или ни разу):
   ```sh
   pnpm engine:supabase runner oracle && \
   pnpm engine:supabase cron-remove && \
   pnpm earn:supabase cron-remove && \
   pnpm monitor:supabase cron-remove && \
   pnpm mirror:supabase cron-remove && \
   pnpm mirror:supabase cron-remove-auto
   ```
   `runner oracle` ждёт конца текущего тика. Edge Function `engine-tick` при `runner = oracle` — no-op, её задание
   (`engine-tick-every-minute`) тоже снимается.
   - **Когда запускать:** на 25–50-й секунде минуты — мимо тика (+5 с) и прогона демо-зеркала (+20 с).
   - **Если серия оборвалась после `runner oracle`** (упал какой-то `cron-remove`): сразу повторить ВСЕ `cron-remove`
     ещё раз (они идемпотентны — снимают задание, только если оно есть). Роуты Vercel `runner` не проверяют: пока
     задание pg_cron живо, задача выполняется дважды (демо-зеркало — две сделки). Не снялось за минуту — «Откат».
   - **После серии** убедиться, что заданий не осталось: `pnpm engine:supabase status` и `pnpm mirror:supabase status`
     (в `cron.job` пусто).
5. **Бот Telegram на VM:** `SITE_URL=https://binance.<ip>.sslip.io pnpm telegram:setup` (webhook
   `/api/telegram/webhook` с `TELEGRAM_WEBHOOK_SECRET` и меню команд).

Проверки (через 2–3 мин):
- `pnpm engine:supabase status` — `runner = oracle`, последний тик свежий (раз в минуту), заданий pg_cron нет;
- `pnpm mirror:supabase status` — заданий `demo-mirror` и `mirror-auto` нет; в `cron.job` Supabase нет активных заданий;
- `/logs` на сайте VM — записи `source = vm`: тик, сделки, прогон демо-зеркала без ошибок;
- `ssh claude@<ip> 'sudo journalctl -u binance --since "-5 min" --no-pager | grep -E "jobs.start|пропуск|снова"'` —
  пропусков «другой раннер» и «раннер неизвестен» нет;
- `ssh claude@<ip> 'sudo ls -l /var/lib/binance/logs'` — файл журнала за сегодня растёт;
- `/db` в Telegram отвечает; монитор (ближайшая четверть часа) не шлёт ложных тревог;
- `https://binance.<ip>.sslip.io` открывается со входом через GitHub.

## Откат

Если после переключения что-то не так — вернуть прод на Vercel + Supabase (база та же, данные не теряются):

1. Одной серией:
   ```sh
   pnpm engine:supabase cron-install && \
   pnpm engine:supabase runner supabase && \
   pnpm earn:supabase cron-install && \
   pnpm monitor:supabase cron-install && \
   pnpm mirror:supabase cron-install && \
   pnpm mirror:supabase cron-install-auto
   ```
   Сначала задание тика: это самая хрупкая команда (Management API), а при `runner = oracle` Edge Function — no-op,
   так что ставить его раньше безопасно; если оно упадёт, тик продолжает идти на VM. Только потом `runner supabase`.
   Серия оборвалась — повторить оставшиеся `cron-install` (они идемпотентны) и проверить `status`, чтобы тик не встал нигде.
   Задания pg_cron по умолчанию вызывают роуты Vercel (`https://binance-dashboard-gold.vercel.app`); таймеры VM
   при `runner = supabase` пропускают работу сами.
2. Бот Telegram — обратно на Vercel: `pnpm telegram:setup` (без `SITE_URL` — адрес Vercel).
3. Если нужна выкатка нового кода на Vercel — PR, который возвращает в `vercel.json` `"main": true`; автовыкатку VM из
   `deploy.yml` при этом можно оставить (VM с `runner = supabase` ничего не исполняет).
4. Проверки: `pnpm engine:supabase status` (раннер `supabase`, задание активно, тики идут), `pnpm mirror:supabase status`,
   `/db` в Telegram, `/logs` — свежие тики идут с Supabase (Edge Function), задачи по расписанию — с Vercel.

Demo-ключи на VM при откате можно оставить: при `runner = supabase` VM в демо не торгует.
