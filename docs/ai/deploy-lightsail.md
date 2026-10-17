# Своя VM apps-tokyo (AWS Lightsail Tokyo)

Решение владельца 2026-10-15: прод переезжает с Vercel + Supabase на свою VM ([spec 0017](../specs/0017-lightsail-vm.md),
план — шаги 0–6). Причины: свой IP, поэтому весь лимит Binance только наш (14.10 Binance банил общий IP Vercel, spec 0014);
постоянный процесс; дешевле Supabase Pro. С шага «переключение» ([spec 0055](../specs/0055-cutover-to-vm.md), раздел
[«Переключение прода на VM»](#переключение-прода-на-vm)) прод — VM: сайт, API, тик движка, фоновые задачи и бот Telegram.
Supabase — только база Postgres ([deploy-supabase.md](deploy-supabase.md)); Vercel новых выкаток не получает и неделю
остаётся резервом с той же базой (тик там не идёт). До переключения VM работала рядом с той же базой, тик на ней — no-op.
С [spec 0059](../specs/0059-sqlite.md) (раздел [«Переезд базы на SQLite»](#переезд-базы-на-sqlite-spec-0059)) база —
файл SQLite на VM `/var/lib/binance/app.db`; Supabase неделю остаётся для отката, потом отключается (очередь PRD, п. 24).

Репозиторий публичный: IP VM, ключи и секреты сюда не пишем. Они в секретах GitHub Actions и в
`/etc/<проект>/app.env` на VM. Ниже `<ip>` — static IP инстанса (Lightsail → Networking; на Mac — `APPS_TOKYO_HOST`
в `.env.local`). `ssh claude@<ip>` везде ниже — с ключом AI: `ssh -i ~/.ssh/lightsail_apps_tokyo -o IdentitiesOnly=yes
claude@<ip>` (ключ владельца `~/.ssh/apps_tokyo` — только для `aleksandr@<ip>`).

## Устройство

| Что | Где |
|---|---|
| VM | Lightsail `apps-tokyo`: Tokyo, Ubuntu 24.04, $5 (512 МБ, 2 vCPU, 20 ГБ), static IP `apps-tokyo-ip`, порты 22/80/443 TCP и 443 UDP (HTTP/3 — Caddy, решение владельца 2026-10-17), ежедневные снимки (00:00 UTC) |
| Общая настройка | `scripts/server/bootstrap.sh`: пользователи, Node 22, Caddy, sqlite3, swap 2 ГБ, TCP BBR (быстрее на длинном маршруте, решение владельца 2026-10-17), unattended-upgrades, fail2ban, SSH только по ключам |
| Проекты | `scripts/server/add-project.sh`: свой Linux-пользователь, `/srv/<проект>/app` (код), `/var/lib/<проект>` (данные), `/etc/<проект>/app.env` (секреты, 640), `<проект>.service` с `MemoryMax`, сайт `/etc/caddy/sites/<проект>.caddy` |
| binance | сайт `https://binance.<ip>.sslip.io` → 127.0.0.1:5000, `MemoryMax=300M`, `--stop-timeout 30` |
| binance-live | фоновый `live-worker.mjs` эпика «Реальные деньги» (spec 0047): без порта и Caddy, `MemoryMax=128M`, `--stop-timeout 120`; выкатка из CI и запуск — [«Воркер реального счёта»](#воркер-реального-счёта-spec-0061) |
| Выкатка | `.github/workflows/deploy.yml`: сама после зелёного CI на `main` (`workflow_run`, коммит, который проверил CI) и вручную с выбором ветки или коммита. `next build` (`output: "standalone"`) в CI → rsync бандла под `deploy` → `systemctl restart` → проверка ответа; затем `pnpm live:build` → `live-worker.mjs` в `/srv/binance-live/app` и рестарт `binance-live`, если он включён (spec 0061). Vercel из `main` не выкатывается (`vercel.json` → `git.deploymentEnabled`, spec 0055) |

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
адрес VM), `AUTH_SECRET`, `AUTH_ALLOWED_GITHUB_LOGINS`, `DATABASE_PATH=/var/lib/binance/app.db` (база SQLite, spec 0059;
`DATABASE_URL` Supabase остаётся неделю для отката — новая версия его не читает), `CRON_SECRET`, `OPENROUTER_API_KEY`,
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
(Tokyo, attach `apps-tokyo`) и в файрволе инстанса **Add rule** → **HTTPS** (Anywhere IPv4 + Anywhere IPv6), а для
HTTP/3 — ещё правило **Custom**, протокол **UDP**, порт **443** (Anywhere IPv4 + Anywhere IPv6; решение владельца 2026-10-17).

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
| Снимок прод-базы на Mac | `pnpm db:pull` → `data/prod.db` (`sqlite3 .backup` на VM по SSH, сервис не останавливается; `APPS_TOKYO_HOST` в `.env.local`); отчёт лаборатории по нему — `pnpm lab:report --prod` |
| Смоук прода | `ssh claude@<ip> 'bash -s' < scripts/server/smoke.sh` — тик в SQLite свежий, `runner = oracle`, `binance` и включённый `binance-live` активны (этап smoke `/flow release`) |
| Ночная копия базы на Mac | `pnpm db:pull --backup [ГГГГ-ММ-ДД]` → `data/backup-<дата\|latest>.db` (по умолчанию последняя; spec 0062) |
| Журнал воркера | `ssh claude@<ip> 'sudo journalctl -u binance-live -n 100 --no-pager'` |
| Запрос к базе на VM | `ssh claude@<ip> 'sudo -u binance sqlite3 -readonly /var/lib/binance/app.db "select key, value from engine_state"'` |
| Новый проект (сайт) | `sudo bash add-project.sh <имя> --port <порт> [--stop-timeout <сек>]` → `https://<имя>.<ip>.sslip.io` |
| Новый фоновый сервис | `sudo bash add-project.sh <имя> --no-web --exec <файл> --memory 128M --heap 96 [--stop-timeout <сек>]` |
| Таймаут остановки binance | `sudo bash ~claude/server-scripts/add-project.sh binance --port 5000 --stop-timeout 30` (скрипт на VM — обновить копию из `scripts/server/`) |
| Повторить общую настройку | `sudo CLAUDE_KEY=… DEPLOY_KEY=… [OWNER_KEY=…] bash bootstrap.sh` (повторный запуск сам держит `ubuntu` закрытым) |

Скрипты лежат в `scripts/server/`; на VM их копия — `~claude/server-scripts/`.

## Бэкапы базы (spec 0062)

Каждую ночь в 23:30 UTC (до снимка Lightsail в 00:00 — свежая копия попадает и в снимок) `binance-backup.timer` запускает
`binance-backup.service` (oneshot, от `binance`, `Nice=10`): `/usr/local/bin/binance-db-backup` (= `scripts/server/db-backup.sh`)
делает `sqlite3 .backup` без остановки сервиса, проверяет копию (`pragma integrity_check` = ok), сжимает в
`/var/lib/binance/backups/app-YYYY-MM-DD.db.gz` (каталог 700, файлы 600) и оставляет 7 последних копий. Та же задача
удаляет файлы журнала `/var/lib/binance/logs/app-*.jsonl` старше 14 дней. Пропущенный запуск (VM была выключена)
догоняется после загрузки (`Persistent=true`). Копия ~1–2 МБ.

Установка и обновление (один раз и после правки скриптов; повтор безопасен):
```sh
scp -i ~/.ssh/lightsail_apps_tokyo -o IdentitiesOnly=yes scripts/server/db-backup.sh scripts/server/add-backup.sh claude@<ip>:server-scripts/
ssh claude@<ip> 'sudo bash ~claude/server-scripts/add-backup.sh binance'
```

Проверка:
- `ssh claude@<ip> 'systemctl list-timers binance-backup.timer --no-pager'` — следующий запуск;
- `ssh claude@<ip> 'sudo journalctl -u binance-backup -n 5 --no-pager'` — строка «Копия базы: …, integrity ok»;
- копия вручную: `ssh claude@<ip> 'sudo systemctl start binance-backup'`;
- смоук (`scripts/server/smoke.sh`, этап smoke `/flow release`) падает, если последней копии больше 26 ч.

Восстановление базы из копии дня `<дата>` (на секундах 25–50 минуты; пауза торговли ~1 мин):
```sh
ssh claude@<ip> 'set -e; d=<дата>; B=/var/lib/binance
  sudo systemctl stop binance
  sudo -u binance cp $B/app.db $B/app.db.before-restore      # текущая — на всякий случай
  sudo rm -f $B/app.db-wal $B/app.db-shm
  sudo -u binance sh -c "gunzip -c $B/backups/app-$d.db.gz > $B/app.db.restore"
  sudo -u binance sqlite3 $B/app.db.restore "pragma integrity_check"   # → ok
  sudo -u binance mv $B/app.db.restore $B/app.db
  sudo systemctl start binance'
```
Затем смоук и `/experiments` на сайте. Всё, что записано после 23:30 дня копии, теряется (сделки paper, журнал);
демо- и реальные позиции на бирже остаются — сверить их со строками зеркал вручную (как в «Откат» spec 0059).
`app.db.before-restore` удалить, когда восстановление проверено.

Скачать копию на Mac: `pnpm db:pull --backup` (последняя) или `pnpm db:pull --backup 2026-10-16` →
`data/backup-<дата|latest>.db` (`quick_check` до замены); локальный сервер на ней:
`DATABASE_PATH=data/backup-latest.db pnpm dev` с `ENGINE_RUNNER=supabase` (чтобы не тикал).

Вне AWS копии не уходят: при потере VM база возвращается из снимка Lightsail (в нём и свежая ночная копия).

## Воркер реального счёта (spec 0061)

Сервис `binance-live` (пользователь `binance-live`, без входа и sudo) запускает `node /srv/binance-live/app/live-worker.mjs`
(бандл `pnpm live:build`, spec 0047). Входящих соединений нет: воркер раз в минуту шлёт пульс и прогон реального зеркала
в приложение на той же VM (`LIVE_APP_URL=http://127.0.0.1:5000`, Bearer `LIVE_WORKER_SECRET`). Торговый ключ субсчёта —
только у него. Реальные ордера — только у экспериментов с реальным зеркалом «Вкл» или «Авто» (spec 0049, 0053).

Переменные `/etc/binance-live/app.env` (root:binance-live 640, значения не выводить):
- `LIVE_WORKER_SECRET` — тот же, что в `/etc/binance/app.env` (по нему приложение принимает пульс);
- `LIVE_APP_URL=http://127.0.0.1:5000` — http разрешён только для localhost (`scripts/lib/liveWorker.ts`);
- `BINANCE_TRADE_API_KEY`, `BINANCE_TRADE_API_SECRET` — ключ субсчёта. Вписывает только владелец; Claude эти строки не
  читает и не меняет.

Выкатка — из CI (`deploy.yml`, шаг «Воркер binance-live»): файл обновляется при каждой выкатке, рестарт — только если
сервис включён; restart ждёт выхода по SIGTERM до 120 с (начатая сделка доделывается).

Первый запуск (Claude, порядок важен):
1. Строки `LIVE_*` — до `add-project.sh` (значение секрета копируется из файла сайта, на экран не выводится):
   ```sh
   ssh claude@<ip> 'E=/etc/binance-live/app.env
     sudo grep -q "^LIVE_WORKER_SECRET=" $E || sudo grep "^LIVE_WORKER_SECRET=" /etc/binance/app.env | sudo tee -a $E >/dev/null
     sudo grep -q "^LIVE_APP_URL=" $E || echo "LIVE_APP_URL=http://127.0.0.1:5000" | sudo tee -a $E >/dev/null
     sudo grep -cE "^(LIVE_WORKER_SECRET|LIVE_APP_URL)=" $E'   # → 2 (только число строк, без значений)
   ```
2. Unit с таймаутом остановки:
   `ssh claude@<ip> 'sudo bash ~claude/server-scripts/add-project.sh binance-live --no-web --exec live-worker.mjs --memory 128M --heap 96 --stop-timeout 120'`
   (копию скрипта на VM сначала обновить из `scripts/server/`). **Внимание:** если `live-worker.mjs` уже лежит в
   `/srv/binance-live/app`, `add-project.sh` сам делает `enable` и `restart` — воркер с ключом стартует сразу, а
   выключенный владельцем сервис включается снова. Повторять его при выключенном воркере — только с последующим
   `sudo systemctl disable --now binance-live`.
3. Перед `enable --now` — проверка, что реальных входов не будет (оба числа — 0, только чтение):
   ```sh
   ssh claude@<ip> 'sudo -u binance sqlite3 -readonly /var/lib/binance/app.db "select count(*) from experiments where live_mirror = 1 or live_mirror_mode <> '\''off'\''; select count(*) from live_mirror_orders where status in ('\''pending'\'','\''protected'\'','\''unprotected'\'','\''closing'\'','\''close_failed'\'')"'
   ```
4. `ssh claude@<ip> 'sudo systemctl enable --now binance-live'`.

Ключ субсчёта (владелец):
1. На Binance у ключа субсчёта: права «чтение» + Spot + Futures, без вывода, переводов и займов; **Restrict access to
   trusted IPs only** — static IP VM.
2. `ssh -i ~/.ssh/apps_tokyo aleksandr@<ip>` → `sudoedit /etc/binance-live/app.env` → строки
   `BINANCE_TRADE_API_KEY=…` и `BINANCE_TRADE_API_SECRET=…` (без кавычек и пробелов).
3. `sudo systemctl restart binance-live` (если сервис уже включён) — карточка «Реальный счёт» на `/settings` показывает
   проверку ключа и прав.

Включить / выключить: `sudo systemctl enable --now binance-live` / `sudo systemctl disable --now binance-live`. Останавливать
надолго — только `disable --now`: после простого `stop` следующая выкатка из CI снова запустит включённый сервис.
Проверка: `sudo journalctl -u binance-live -n 30 --no-pager` — «Воркер реального счёта …: ключ задан, пульс →
http://127.0.0.1:5000», пульсы без 401; остановка без SIGKILL: `sudo journalctl -u binance-live -n 20 --no-pager | grep -E "stop-sigterm|SIGKILL"`
— пусто.

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

## Переезд базы на SQLite (spec 0059)

Выполняет Claude после мержа PR 0059. База приложения переезжает из Supabase Postgres в файл
`/var/lib/binance/app.db` на VM (владелец `binance`, права 600). Данных около 6 МБ, перенос — секунды; торговля стоит
≈ 5 минут. Команды `pnpm db:import-pg` — на Mac из основного checkout на свежем `main` (`.env.local`: `DATABASE_URL`);
`ssh` — под `claude`. Значения секретов не выводить.

**До мержа:**
1. В `/etc/binance/app.env` (`ssh claude@<ip> 'sudoedit /etc/binance/app.env'`) добавить
   `DATABASE_PATH=/var/lib/binance/app.db`. `DATABASE_URL` не удалять — он нужен откату неделю. Рестарт не нужен:
   текущая версия `DATABASE_PATH` не читает (новая без него на VM не стартует — явная ошибка).
2. `ssh claude@<ip> 'sqlite3 --version'` — CLI есть (ставит `bootstrap.sh`), он нужен `.backup` и проверкам.
3. Репетиция переноса из worktree задачи: `pnpm db:import-pg --to /tmp/rehearsal.db` — все строки `✓`, затем
   `rm /tmp/rehearsal.db`.

**Переключение:**
1. Мерж PR. Сразу, пока идут CI и сборка Deploy (≈ 3 мин), — основной checkout на свежий `main` с новыми
   зависимостями (нативный `better-sqlite3`, `postgres` теперь в devDependencies), иначе перенос упадёт, когда торговля
   уже стоит:
   ```sh
   git pull --ff-only && pnpm install --frozen-lockfile
   ```
2. Там же, до выкатки, на **25–50-й секунде минуты** (мимо тика +5 с и прогона демо-зеркала +20 с) остановить старую
   версию — не ждать случайного `restart` из Deploy (сервис не дожидается конца прогона по SIGTERM: прерванный прогон
   оставил бы ордер на демо при строке `pending`):
   ```sh
   ssh claude@<ip> 'sudo systemctl stop binance'
   pnpm mirror:supabase status   # в demo_mirror_orders нет pending и closing
   ```
   Есть `pending` или `closing` — прогон оборвался: после шага 4 взять их из `data/import.db`
   (`sqlite3 data/import.db "select trade_id, symbol, status from demo_mirror_orders where status in ('pending','closing')"`)
   и после переключения сверить эти позиции на демо-счёте со строками вручную. Если Deploy уже дошёл до шага
   «Перезапуск и проверка» (новая версия поднята) — этот шаг пропустить: `stop` остановил бы новую версию, и проверка
   Deploy упала бы. С этого момента торговля на паузе и Supabase никто не пишет.
3. Deploy (`systemctl restart`) поднимает новую версию на пустом файле `app.db`: миграции и сид каталога есть, но
   `engine_state.runner` нет — фоновые задачи стоят (пропуск «engine_state.runner не задан» пишется на уровне debug — в `journalctl` его нет), тумблер движка
   выключен — сделок нет. Дождаться конца Deploy и проверить, что модуль загрузился:
   `ssh claude@<ip> 'sudo journalctl -u binance --since "-3 min" --no-pager | grep db.migrate'` —
   «Миграции применены (sqlite)», а не «Миграции не применены».
4. Остановить новую версию и перенести данные:
   ```sh
   ssh claude@<ip> 'sudo systemctl stop binance'
   pnpm db:import-pg --to data/import.db   # уже есть — добавить --force
   ```
   Все строки сверки — `✓` (число строк 12 таблиц, суммы PnL `paper_trades`, `demo_mirror_orders`,
   `live_mirror_orders`); иначе код 1 и `data/import.db` не создаётся — не продолжать, разбор (сервис можно поднять на
   пустой базе: торговли не будет) или «Откат».
5. Загрузить файл и запустить сервис (файлы пустой версии `app.db*` с журналом этих минут удаляются):
   ```sh
   scp data/import.db claude@<ip>:/tmp/app-import.db
   ssh claude@<ip> 'set -e; sudo rm -f /var/lib/binance/app.db /var/lib/binance/app.db-wal /var/lib/binance/app.db-shm; \
     sudo install -o binance -g binance -m 600 /tmp/app-import.db /var/lib/binance/app.db; rm -f /tmp/app-import.db; \
     sudo -u binance sqlite3 /var/lib/binance/app.db "pragma quick_check; select value from engine_state where key = '\''runner'\''"; \
     sudo systemctl start binance'
   ```
   `quick_check` — `ok`, runner — `"oracle"`. Момент запуска записать (UTC) — он нужен откату.

**Проверки (через 2–3 мин):**
- тики идут раз в минуту, `runner = oracle`, новые сделки пишутся в SQLite: `/logs` на сайте (`source = vm`) или
  `ssh claude@<ip> 'sudo -u binance sqlite3 -readonly /var/lib/binance/app.db "select value from engine_state where key = '\''last_tick'\''"'`;
- демо-зеркало прогоняется без ошибок, открытые демо-позиции на месте (не закрыты как «чужие»);
- `/db` в Telegram отвечает размером файла базы и свободным местом диска;
- сайт показывает те же цифры `/experiments` и `/stats`, что до переключения;
- в Supabase после переключения новых записей нет: `pnpm engine:supabase status` — последний тик не двигается.

**Откат** (в течение недели): ручная выкатка коммита до мержа PR 0059 — Actions → Deploy → **Run workflow** с этим
ref (`gh workflow run deploy.yml -f ref=<sha>`); `DATABASE_URL` в `app.env` ещё есть, старая версия снова работает с
Supabase (там `runner = oracle`, тик пойдёт на VM). Paper-сделки и журнал, записанные в SQLite после переключения, при
откате теряются. Демо-зеркало работает только со своими строками в базе, поэтому демо-счёт нужно сверить вручную —
сразу после выкатки, до первого прогона зеркала (или остановив сервис на время сверки). Файл
`/var/lib/binance/app.db` не удалять: по нему видно, что изменилось за время на SQLite (`<T>` — момент запуска на
SQLite, мс):
```sh
ssh claude@<ip> 'sudo -u binance sqlite3 -readonly /var/lib/binance/app.db \
  "select trade_id, market, symbol, direction, status, created_at >= <T> as new from demo_mirror_orders \
   where created_at >= <T> or closed_at >= <T> or updated_at >= <T>"'
```
- **Новые позиции** (`new = 1`, статус открытый: `protected`, `unprotected`, `closing`, `close_failed`) — Supabase о них не
  знает, это сироты: закрыть вручную на Binance Demo (позицию и её стоп/тейк), иначе они закроются только своими
  ногами на бирже.
- **Закрытые за время на SQLite** (`new = 0`, `closed`) — в Supabase они ещё открыты, и зеркало попытается закрыть
  позицию, которой нет: перевести их строки в Supabase в `closed` (`update demo_mirror_orders set status = 'closed',
  closed_at = now(), message = 'закрыто на SQLite до отката' where trade_id in (…)`) — с согласия владельца, это запись в
  прод-базу.
- Итог сверить с открытыми позициями демо-счёта: каждой открытой строке `demo_mirror_orders` в Supabase — позиция на
  демо, и наоборот.

Через неделю без отката — отдельная задача (п. 24 очереди PRD): `DATABASE_URL` убрать из `app.env`, Supabase
отключить. Ночные `sqlite3 .backup` — п. 23; до них данные защищают ежедневные снимки Lightsail.
