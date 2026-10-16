# Своя VM apps-tokyo (AWS Lightsail Tokyo)

Решение владельца 2026-10-15: прод переезжает с Vercel + Supabase на свою VM ([spec 0017](../specs/0017-lightsail-vm.md),
план — шаги 0–6). Причины: свой IP, поэтому весь лимит Binance только наш (14.10 Binance банил общий IP Vercel, spec 0014);
постоянный процесс; дешевле Supabase Pro. До шага «переключение» прод остаётся на Vercel + Supabase
([deploy-supabase.md](deploy-supabase.md)), VM работает рядом с той же базой, тик на ней — no-op.

Репозиторий публичный: IP VM, ключи и секреты сюда не пишем. Они в секретах GitHub Actions и в
`/etc/<проект>/app.env` на VM. Ниже `<ip>` — static IP инстанса (Lightsail → Networking).

## Устройство

| Что | Где |
|---|---|
| VM | Lightsail `apps-tokyo`: Tokyo, Ubuntu 24.04, $5 (512 МБ, 2 vCPU, 20 ГБ), static IP `apps-tokyo-ip`, порты 22/80/443, ежедневные снимки (00:00 UTC) |
| Общая настройка | `scripts/server/bootstrap.sh`: пользователи, Node 22, Caddy, sqlite3, swap 2 ГБ, unattended-upgrades, fail2ban, SSH только по ключам |
| Проекты | `scripts/server/add-project.sh`: свой Linux-пользователь, `/srv/<проект>/app` (код), `/var/lib/<проект>` (данные), `/etc/<проект>/app.env` (секреты, 640), `<проект>.service` с `MemoryMax`, сайт `/etc/caddy/sites/<проект>.caddy` |
| binance | сайт `https://binance.<ip>.sslip.io` → 127.0.0.1:5000, `MemoryMax=300M` |
| binance-live | фоновый `live-worker.mjs` эпика «Реальные деньги» (spec 0047): без порта и Caddy, `MemoryMax=128M` |
| Выкатка | `.github/workflows/deploy.yml` (вручную, с выбором ветки): `next build` (`output: "standalone"`) в CI → rsync бандла под `deploy` → `systemctl restart` → проверка ответа |

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
`ANALYSIS_MODEL`, `TELEGRAM_*`. Demo-ключей и ключа реального аккаунта Binance на VM нет (решения владельца 2026-10-15;
ключ реального аккаунта позже — в базе в зашифрованном виде).

## Фоновые задачи

Кто и когда запускает (spec 0048):

| Задача | Расписание (UTC) | Пока `engine_state.runner = supabase` | После переключения (`runner = oracle`, задача 0049) |
|---|---|---|---|
| Тик лаборатории | каждую минуту, +5 с | Edge Function Supabase (pg_cron) | таймер VM (`experimentEngine.ts`) |
| Снимок Earn | `0 3,15 * * *` | pg_cron → Vercel `/api/cron/earn-snapshot` | таймер VM |
| Монитор журнала и места в базе | `*/15 * * * *` | pg_cron → Vercel `/api/cron/log-monitor` | таймер VM |
| Демо-зеркало | `* * * * *`, +20 с | pg_cron → Vercel `/api/cron/demo-mirror` | таймер VM (без demo-ключей отвечает «не настроено») |
| Авто-зеркало | `0 7 * * *` | pg_cron → Vercel `/api/cron/mirror-auto` | таймер VM |

Таймеры (`src/app/server/backgroundJobs.ts`) стартуют вместе с сервером только при `APP_HOST=vm` и перед каждым
запуском сверяют `ENGINE_RUNNER=oracle` с `engine_state.runner` в БД. Пока там `supabase`, таймеры срабатывают и
пропускают работу. Строка о пропуске — только при смене состояния задачи: после старта сервиса в `journalctl -u binance`
по одной строке на задачу при её первом срабатывании (`[log] · cron.…: <задача>: пропуск — задачи выполняет другой
раннер …`; демо-зеркало — в первую минуту, монитор — в ближайшую четверть часа, Earn и авто-зеркало — в своё время),
дальше пропуски молча. Когда задача снова выполняется — одна строка `<задача>: задача снова выполняется`; смена причины
пропуска (например, «прошлый запуск ещё идёт») — новая строка. В журнале БД записей этих задач с `source = vm` нет.
Проверка после выкатки:
`ssh claude@<ip> 'sudo journalctl -u binance --since "-5 min" --no-pager | grep -E "jobs.start|пропуск"'`.
При переключении задания pg_cron нужно выключить (0049): после смены runner Vercel-роуты ещё работают, а таймеры VM
уже выполняют задачи.

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
| Выкатить ветку | `gh workflow run deploy.yml -f ref=<ветка>` (или Actions → Deploy → Run workflow) |
| Журнал сервиса | `ssh claude@<ip> 'sudo journalctl -u binance -n 100 --no-pager'` |
| Рестарт | `ssh claude@<ip> 'sudo systemctl restart binance'` |
| Секреты | `ssh claude@<ip> 'sudoedit /etc/binance/app.env'` → рестарт |
| Новый проект (сайт) | `sudo bash add-project.sh <имя> --port <порт>` → `https://<имя>.<ip>.sslip.io` |
| Новый фоновый сервис | `sudo bash add-project.sh <имя> --no-web --exec <файл> --memory 128M --heap 96` |
| Повторить общую настройку | `sudo CLAUDE_KEY=… DEPLOY_KEY=… [OWNER_KEY=…] bash bootstrap.sh` (повторный запуск сам держит `ubuntu` закрытым) |

Скрипты лежат в `scripts/server/`; на VM их копия — `~claude/server-scripts/`.
