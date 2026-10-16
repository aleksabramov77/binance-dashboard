# 0017 · Сервер apps-tokyo (AWS Lightsail) и скрипты выкатки под него

- **Тип:** feature
- **Статус:** approved
- **Раздел PRD:** §3.4 Авто-бот (хостинг), §4 Ключи и окружение
- **Дата:** 2026-10-15

## Цель
Шаги 1–2 плана переезда (утверждён 2026-10-15): подготовить свою VM `apps-tokyo` и скрипты, которыми приложение
выкатывается на неё. VM — AWS Lightsail, Tokyo, Ubuntu 24.04, $5 (512 МБ). Прод в этой задаче не переключается: он
остаётся на Vercel + Supabase. Переключение — после перехода на SQLite (шаги 3–4).

VM общая для нескольких личных проектов (позже — учебный проект дочери): у каждого проекта свой Linux-пользователь,
свой каталог, свой systemd-сервис с лимитом памяти и свой поддомен в общем Caddy.

## Сценарии
1. Владелец создаёт инстанс (ключ `claude@apps-tokyo`, static IP, порты 80/443) и присылает IP.
2. Claude по SSH запускает `scripts/server/bootstrap.sh`: пользователи, пакеты, swap, защита SSH. Скрипт можно
   повторять.
3. Claude запускает `scripts/server/add-project.sh binance`: пользователь, каталоги, сервис, поддомен Caddy.
4. GitHub Actions собирает приложение (на 512 МБ `next build` не помещается), копирует бандл на VM и перезапускает
   сервис. Запуск — вручную (workflow_dispatch) с любой ветки, чтобы на шаге 3 выкатить ветку SQLite на проверку.
   Автодеплой с `main` включается на шаге 4.
5. Владелец заходит на сервер под своим пользователем `aleksandr` с Mac по SSH, без root.

## Критерии приёмки
- [ ] AC1. **Пользователи.**
  - `claude`: sudo, вход по ключу `claude@apps-tokyo`.
  - `aleksandr`: sudo, вход по ключу владельца с Mac.
  - `deploy`: вход для GitHub Actions по отдельному ключу. Ему разрешено только скопировать бандл в каталог
    проекта и выполнить `systemctl restart|status <проект>` (sudoers).
  - `binance`: системный, без входа, от него работает сервис.
  - В `sshd`: `PermitRootLogin no`, `PasswordAuthentication no`. Встроенный `ubuntu` заблокирован после проверки
    входа под `claude`.
- [ ] AC2. **Пакеты и защита.** Node 22 (как в CI), Caddy, `sqlite3`, swap 2 ГБ, `unattended-upgrades` (обновления
  безопасности), `fail2ban` для SSH. Повторный запуск `bootstrap.sh` ничего не ломает.
- [ ] AC3. **Проект `binance`.**
  - Каталоги: код — `/srv/binance/app` (владелец `deploy`, читает `binance`), данные — `/var/lib/binance/`
    (владелец `binance`, 700).
  - Секреты — `/etc/binance/app.env`: root:binance, 640, не в git.
  - `binance.service`: `MemoryMax`, `Restart=always`, слушает только 127.0.0.1.
  - Сайт Caddy — `/etc/caddy/sites/binance.caddy`; общий `Caddyfile` только импортирует `sites/*.caddy`.
  - Второй проект добавляется тем же `add-project.sh <имя> <порт>` без правок скриптов.
  - Сервис без сайта (без порта и поддомена — например, будущий `live:worker` эпика «Реальные деньги», spec 0047)
    добавляется тем же скриптом с флагом `--no-web`: свой пользователь, свой `/etc/<имя>/app.env` (640), свой unit,
    без Caddy и без входящих соединений.
- [ ] AC4. **HTTPS и Binance.** `https://binance.<ip>.sslip.io` отвечает с сертификатом Let's Encrypt. С IP VM
  `api.binance.com` и `fapi.binance.com` отвечают 200 (проверка в `bootstrap.sh`).
- [ ] AC5. **Выкатка из CI.** `.github/workflows/deploy.yml`:
  - собирает Next.js в режиме `output: "standalone"`;
  - копирует бандл на VM под `deploy`, перезапускает сервис и ждёт ответа сервера;
  - при сбое печатает журнал сервиса.
  Ветка — параметр запуска. Автоматического запуска с `main` пока нет, чтобы прод на Vercel не дублировался.
  Секреты Actions: `APPS_TOKYO_HOST`, `APPS_TOKYO_USER=deploy`, `APPS_TOKYO_SSH_KEY` (не `VM_*`: под этими именами старый Oracle-`deploy.yml` в `main` начал бы падать после каждого CI).
- [ ] AC6. **Приложение на VM.**
  - Выкаченный `main` открывается на `https://binance.<ip>.sslip.io` с базой Supabase (как Vercel).
  - Журнал пишет `source = vm` (сейчас `vercel | local`).
  - Тик движка на VM — no-op: `engine_state.runner` остаётся `supabase`, двойных сделок нет.
  - Demo-ключей на VM нет — решение владельца 2026-10-15.
  - Ключа реального аккаунта на VM пока тоже нет: он появится в базе в зашифрованном виде отдельной задачей. До
    переключения «Портфель» и `/api/earn/advanced` на VM честно показывают «ключ не настроен», а на Vercel работают
    как раньше.
- [ ] AC7. **Документация.** `docs/ai/deploy-lightsail.md`:
  - шаги владельца с точными названиями кнопок — инстанс, IAM-пользователь вместо root (шаг 0), секреты Actions,
    свой SSH-ключ;
  - runbook: выкатка, журнал, рестарт, добавление проекта.
  `docs/ai/deploy.md` (Oracle) помечен устаревшим; `setup.sh` и `deploy.sh` Oracle удалены. PRD §3.4 и §4 обновлены.

## Вне scope
- SQLite, перенос данных, отключение Supabase и Vercel — шаги 3–5.
- Ключ реального аккаунта Binance в базе в зашифрованном виде (решение 2026-10-15) — отдельная задача после SQLite.
- Hono, вход только для владельца, Vite — шаг 6.

## Технические заметки
- Основа — скрипты Oracle (`scripts/deploy/*`): проверка Binance, swap, Node, Caddy, systemd. Убрать Oracle-специфику
  (iptables VCN), сборку на сервере и deploy key: бандл приходит из CI, git на VM не нужен.
- `standalone` не включает `public/` и `.next/static` — копировать отдельно (документация Next в `node_modules/next/dist/docs/`).
- `instrumentation.ts` вне Vercel применяет миграции при старте и запускает таймер движка. С Supabase так и
  остаётся: миграции те же, что выкатывает `/flow release`; тик — no-op, пока `runner = supabase`.
- `src/app/server/logs.ts`: источник `vm` по переменной `APP_HOST=vm` из `app.env`; та же переменная — для подписи хостинга в `/api/earn/advanced` (сейчас `isServerless()` → cloud/local).
- В `app.env` также `TELEGRAM_WEBHOOK_SECRET` (webhook бота пока остаётся на Vercel, перенос — на переключении).
- Секреты в `app.env` — из `.env.local` и `~/.config/vercel/binance-dashboard-prod.env`, по scp, без вывода
  значений. `AUTH_URL`, `AUTH_GITHUB_*` — отдельное GitHub OAuth App под адрес VM.
- Репозиторий публичный: IP VM, ключи и адреса в git не писать (секреты Actions, плейсхолдер `<ip>` в доках).

## Журнал
| Дата | Событие |
|---|---|
| 2026-10-15 | ТЗ заведено (шаги 1–2 плана переезда) |
| 2026-10-16 | Добавлен сервис без сайта (`--no-web`) под `live:worker` (spec 0047); static IP VM нужен для whitelist торгового ключа |
| 2026-10-16 | Инстанс apps-tokyo создан (Tokyo, $5, static IP, порты 22/80/443, автоснимки — подтверждено владельцем); ТЗ утверждено |
