# 0061 · Выкатка воркера реального счёта `binance-live` на VM из CI

- **Тип:** feature
- **Статус:** draft
- **Раздел PRD:** §3.7 Реальные деньги (хостинг)
- **Дата:** 2026-10-17

## Цель
Воркер реального счёта (`scripts/live-worker.ts`, spec 0047 и 0049) работает на VM `apps-tokyo` как сервис
`binance-live`. Выкатывается из CI вместе с приложением. Торговый ключ субсчёта владелец кладёт на VM сам, после
выкатки. Без ключа воркер только шлёт пульс «ключ не задан» и не может отправить ни одного ордера. С ключом реальные
сделки идут только по ручному «Вкл» или «Авто» у эксперимента (spec 0049, 0053).

## Сценарии
1. После мержа в `main` CI выкатывает и сайт, и `live-worker.mjs`. Если сервис `binance-live` включён, он
   перезапускается и доделывает начатую сделку (SIGTERM, до 120 с).
2. До ключа карточка «Реальный счёт» на `/settings` показывает: воркер подключён, ключ не задан. Торговать нельзя.
3. Владелец вписывает ключ в `/etc/binance-live/app.env` по шагам из `deploy-lightsail.md` и перезапускает сервис.
   Карточка показывает проверку ключа и прав. Первую сделку делает владелец вместе с сессией real-money.
4. Проверка релиза (`/flow release`, этап smoke) смотрит тик в SQLite на VM, а не в замороженном Supabase, и что
   `binance-live` активен.

## Технические решения
- **CI (`.github/workflows/deploy.yml`):**
  - после сборки сайта собирается `pnpm live:build` → `dist/live-worker.mjs`;
  - после рестарта и проверки сайта файл копируется rsync в `/srv/binance-live/app/live-worker.mjs`. Пользователь
    `deploy` — владелец каталога; права 644;
  - если `systemctl is-enabled binance-live` = `enabled`, выполняется `sudo systemctl restart binance-live` и
    проверка «active через 15 с». Если сервис выключен, файл обновляется, а рестарта нет. Нужные права в sudoers
    у `deploy` уже есть (0017).
  - Сбой выкатки воркера роняет job, но сайт уже выкачен; в журнале шага видна причина.
- **Сервис на VM** (делает Claude один раз после мержа):
  - `add-project.sh binance-live --no-web --exec live-worker.mjs --memory 128M --heap 96 --stop-timeout 120`
    повторно: unit получает `TimeoutStopSec=120` и `KillSignal=SIGTERM`, которых в нём сейчас нет;
  - в `/etc/binance-live/app.env` (root:binance-live 640):
    - `LIVE_WORKER_SECRET` — тот же, что в `/etc/binance/app.env`;
    - `LIVE_APP_URL=http://127.0.0.1:5000` — приложение на той же VM, без TLS и без выхода в интернет;
  - `systemctl enable --now binance-live` — запуск без ключа: только пульс «ключ не задан».
- **Ключ владельца:** `BINANCE_TRADE_API_KEY` и `BINANCE_TRADE_API_SECRET` в тот же файл (`sudoedit`, под
  `aleksandr`), затем `sudo systemctl restart binance-live`. В ключе на Binance — белый список IP: static IP VM.
  Claude ключ не видит и не вписывает.
- **`/flow release`, этап smoke** (`.config/flows/release.yaml`):
  - `last_tick` читается из `/var/lib/binance/app.db` по SSH (`sqlite3 -readonly`);
  - `systemctl is-active binance-live`, если сервис включён;
  - во всех командах SSH явно указан ключ `-i ~/.ssh/lightsail_apps_tokyo -o IdentitiesOnly=yes` (в
    `deploy-lightsail.md` тоже).

## Критерии приёмки
Код (PR):
- [ ] AC1. `deploy.yml` собирает и копирует `live-worker.mjs`, перезапускает `binance-live`, только если он включён,
  и проверяет, что он активен. Ручной запуск с выбором ветки работает так же.
- [ ] AC2. `release.yaml`: smoke по SQLite на VM и `binance-live`; во флоу и в `deploy-lightsail.md` SSH с явным
  ключом.
- [ ] AC3. `deploy-lightsail.md`: раздел «Воркер реального счёта» — устройство, переменные, шаги владельца по ключу
  (с белым списком IP), как выключить (`systemctl disable --now binance-live`), где смотреть журнал.
- [ ] AC4. PRD: строка 20 очереди → 🚧 0061; новая строка «Сторож зависшего тика» (на старой версии тик и демо-зеркало
  висели ~5 ч 2026-10-16/17 без тревоги).
- [ ] AC5. `pnpm check`, `pnpm build`, `pnpm live:build` зелёные.

На VM (Claude после мержа):
- [ ] AC6. Unit `binance-live` с `TimeoutStopSec=120` и `KillSignal=SIGTERM`, `app.env` с `LIVE_WORKER_SECRET` и
  `LIVE_APP_URL`; сервис включён и активен. Выкатка из CI обновила `live-worker.mjs`.
- [ ] AC7. В журнале `binance-live`: «ключ не задан, пульс → http://127.0.0.1:5000», пульсы принимаются (200, не
  401). Карточка «Реальный счёт» на `/settings` показывает подключённый воркер без ключа. Ордеров нет.
- [ ] AC8. `systemctl restart binance-live` завершается без SIGKILL.

## Вне scope
- Сам торговый ключ и первая сделка — владелец с сессией real-money.
- Сторож зависшего тика — отдельная задача (строка очереди из AC4).
- Ключ реального аккаунта в базе (п. 22), бэкапы (п. 23).
