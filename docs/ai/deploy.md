# Деплой на Oracle Cloud Always Free (резерв)

> **Резервный вариант.** Основной хостинг с 2026-10-10 — Supabase + Vercel: [deploy-supabase.md](deploy-supabase.md).
> Одновременно тик крутит только один раннер (`engine_state.runner`, spec 007b).

Приложение работает на бесплатной VM Oracle Cloud, независимо от Mac владельца.

| Узел | Решение | Почему |
|---|---|---|
| VM | Oracle Cloud Always Free, Ubuntu 24.04, Ampere A1 (запасной вариант — E2.1.Micro) | бесплатно навсегда, процесс живёт постоянно — фоновые задачи работают |
| Регион | **UAE East (Dubai)** | не ЕС: владелец — гражданин РФ, санкционный комплаенс Binance; не США: Binance отвечает 451 |
| HTTPS | Caddy + Let's Encrypt на `<ip>.sslip.io` | домен не нужен |
| БД | Supabase Free, регион ближе к Dubai | Postgres бесплатно; при постоянной записи проект не засыпает |
| Вход | GitHub OAuth, только `aleksabramov77` (задача 4) | чужие не тратят токены OpenRouter и не нажимают кнопки |
| Автодеплой | `.github/workflows/deploy.yml`: после зелёного CI на `main` → ssh → `scripts/deploy/deploy.sh` | без ручных действий |

**Ключи Binance на сервер не кладём** (решение владельца 2026-10-10). Серверу хватает публичных
данных Binance (свечи, тикеры) — без ключа и без привязки к аккаунту. Ключ реального аккаунта
(`BINANCE_API_KEY/SECRET`) на сервере запрещён — `deploy.sh` остановится, если найдёт его. Demo-ключи —
только по отдельному решению владельца и вместе с `ALLOW_DEMO_KEYS=yes`.

## Кто что делает
- **Владелец (с iPhone)** — только нажатия в веб-интерфейсах: Oracle, Supabase, GitHub. Шаги ниже.
- **Claude (на Mac владельца)** — всё в терминале: настройка VM по SSH (`setup.sh`), deploy key,
  секреты GitHub Actions, файл окружения на VM, первый деплой и проверка.

Ключ для входа на VM лежит на Mac: `~/.ssh/oracle_binance_dashboard`. Его публичную часть
(одна строка `ssh-ed25519 AAAA… binance-dashboard-admin`) Claude присылает в чат: её вставляют на шаге 1.11.

---

## 1. Создать VM в Oracle
Названия кнопок могут чуть отличаться: Oracle иногда меняет интерфейс.

1. Откройте https://cloud.oracle.com и войдите в аккаунт.
2. Нажмите **☰** (меню слева вверху).
3. Нажмите **Compute**.
4. Нажмите **Instances**.
5. Нажмите **Create instance**.
6. В поле **Name** введите `binance-dashboard`.
7. В блоке **Image and shape** нажмите **Edit** → **Change image**.
8. Выберите **Ubuntu**, затем **Canonical Ubuntu 24.04** → **Select image**.
9. Нажмите **Change shape** → **Ampere** → отметьте **VM.Standard.A1.Flex**.
10. Поставьте **Number of OCPUs** = `2`, **Amount of memory (GB)** = `12` → **Select shape**.
11. В блоке **Add SSH keys** выберите **Paste public keys** и вставьте строку из чата (`ssh-ed25519 …`).
12. Блок **Networking** не меняйте: новая сеть (VCN) и **Assign a public IPv4 address** должны быть включены.
13. Нажмите **Create**.
14. Дождитесь статуса **Running** (1–3 минуты).
15. Скопируйте **Public IP address** со страницы VM и пришлите его в чат.

**Ошибка «Out of capacity»** — частая на Ampere. Подождите и нажмите **Create** снова, либо на шаге 9
выберите **Specialty and previous generation** → **VM.Standard.E2.1.Micro** (1 ГБ RAM, тоже бесплатно;
`setup.sh` добавит swap 4 ГБ, сборка пойдёт медленнее).

## 2. Открыть порты 80 и 443
На самой VM порты открывает `setup.sh`, но Oracle режет трафик ещё и на уровне сети.

1. На странице VM в блоке **Primary VNIC** нажмите ссылку **Subnet** (`subnet-…`).
2. Откройте вкладку **Security** (или раздел **Security Lists**).
3. Нажмите **Default Security List for vcn-…**.
4. Откройте вкладку **Security rules** (или **Ingress Rules**).
5. Нажмите **Add Ingress Rules**.
6. **Source CIDR**: `0.0.0.0/0`.
7. **Destination Port Range**: `80,443`.
8. Нажмите **Add Ingress Rules**.

## 3. Настройка VM — делает Claude
После того как IP пришёл в чат, Claude с Mac:
1. Проверяет SSH: `ssh -i ~/.ssh/oracle_binance_dashboard ubuntu@<ip>`.
2. Копирует и запускает `scripts/deploy/setup.sh`. Первым делом скрипт проверяет, отвечает ли Binance
   с этого IP (`api.binance.com`, `fapi.binance.com`); при 451/403 он останавливается — нужен другой регион.
   Затем ставит Node 22, pnpm, Caddy, swap, открывает 80/443 в iptables, создаёт systemd-юнит.
3. Добавляет deploy key VM в репозиторий (только чтение):
   `GH_CONFIG_DIR=~/.config/gh-personal gh repo deploy-key add … --title binance-dashboard-vm`.
4. Создаёт отдельный SSH-ключ для GitHub Actions, кладёт его публичную часть в `authorized_keys`
   на VM и записывает секреты репозитория `VM_HOST`, `VM_USER`, `VM_SSH_KEY`
   (`GH_CONFIG_DIR=~/.config/gh-personal gh secret set …`).

> Ubuntu от Oracle уже содержит правила iptables с REJECT всего, кроме SSH. ufw поверх них не помогает
> (REJECT стоит раньше цепочек ufw), поэтому `setup.sh` открывает 80/443 в тех же iptables
> и сохраняет их `netfilter-persistent`.

## 4. База данных Supabase
1. Откройте https://supabase.com и нажмите **Start your project**.
2. Нажмите **Continue with GitHub** (личный аккаунт `aleksabramov77`).
3. Нажмите **New project**.
4. **Name**: `binance-dashboard`.
5. **Database Password**: нажмите **Generate a password** — пароль запоминать не нужно, он войдёт в строку подключения.
6. **Region**: ближайший к Dubai. Если в списке есть **Middle East (UAE)**, выберите его, иначе — **South Asia (Mumbai)**.
7. Нажмите **Create new project** и подождите около 2 минут.
8. Нажмите **Connect** (вверху страницы проекта).
9. Выберите **Session pooler**: VM Oracle работает по IPv4, а прямое подключение Supabase — только IPv6.
10. Нажмите **Copy** у строки `postgresql://postgres.…:[YOUR-PASSWORD]@…pooler.supabase.com:5432/postgres`.
11. Пришлите строку в чат вместе с паролем из шага 5. Claude запишет её в `DATABASE_URL` на VM.
    После этого по желанию смените пароль: **Project Settings** → **Database** → **Reset database password**.

## 5. GitHub OAuth App (вход в приложение)
Делается после того, как на VM появился HTTPS-адрес `https://<ip>.sslip.io` (шаг 3).

1. Откройте https://github.com/settings/developers.
2. Нажмите **OAuth Apps**.
3. Нажмите **New OAuth App**.
4. **Application name**: `Binance Dashboard`.
5. **Homepage URL**: `https://<ip>.sslip.io`.
6. **Authorization callback URL**: `https://<ip>.sslip.io/api/auth/callback/github`.
7. Нажмите **Register application**.
8. Скопируйте **Client ID** и пришлите в чат.
9. Нажмите **Generate a new client secret**.
10. Скопируйте секрет (он показывается один раз) и пришлите в чат.

Локально вход выключен (без `AUTH_SECRET`), поэтому второе OAuth App для `localhost` не нужно.

## 6. Запуск — делает Claude
Claude заполняет `/opt/binance-dashboard/.env.production.local` по шаблону
`scripts/deploy/env.production.example`: `DATABASE_URL`, `AUTH_*`, `CRON_SECRET`, `OPENROUTER_API_KEY`.
Затем запускает `deploy.sh` и проверяет:
- `https://<ip>.sslip.io` открывается с валидным сертификатом;
- вход через GitHub пускает `aleksabramov77`, а без входа — редирект на страницу входа;
- журнал сервиса без ошибок: `journalctl -u binance-dashboard -f`.

Дальше каждый мерж в `main` после зелёного CI сам уезжает на VM (workflow **Deploy**).
Пока секретов `VM_*` нет, workflow завершается с пометкой «деплой пропущен».

---

## Справочник

| Что | Где |
|---|---|
| Код на VM | `/opt/binance-dashboard` (копия `main`, локальные правки сбрасываются при деплое) |
| Окружение | `/opt/binance-dashboard/.env.production.local` (chmod 600, не в git) |
| Сервис | `sudo systemctl status binance-dashboard`, журнал — `journalctl -u binance-dashboard -f` |
| Логи приложения | `/opt/binance-dashboard/data/logs/` |
| HTTPS | `/etc/caddy/Caddyfile`, `sudo systemctl reload caddy` |
| Ручной деплой | `ssh -i ~/.ssh/oracle_binance_dashboard ubuntu@<ip> 'bash /opt/binance-dashboard/scripts/deploy/deploy.sh'` или **Actions → Deploy → Run workflow** |

**Порядок `deploy.sh`:** `git fetch` + `reset --hard origin/main` → перезапуск уже обновлённого скрипта →
проверка ключей Binance в env → `pnpm install --frozen-lockfile` → `pnpm build` → `pnpm db:migrate`
(если такой скрипт есть) → `systemctl restart` → ожидание ответа сервера (любой код < 500).

**Неполадки**
- `setup.sh`: «Binance блокирует IP этой VM» — регион не подходит. Вариант — VM в другом регионе
  не в ЕС и не в США; Always Free доступен только в домашнем регионе аккаунта.
- Сертификат не выдаётся — проверьте Ingress Rules (шаг 2) и что `curl http://<ip>` с Mac отвечает.
- Сборка падает по памяти на E2.1.Micro — проверьте swap: `swapon --show`.
- Во время `pnpm build` сайт может на минуту отвечать с ошибками (сборка идёт рядом с работающим
  сервером), это ожидаемо.
