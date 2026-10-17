# 0061 · Выкатка воркера реального счёта `binance-live` на VM из CI

- **Тип:** feature
- **Статус:** approved
- **Раздел PRD:** §3.7 Реальные деньги (хостинг)
- **Дата:** 2026-10-17

## Цель
Воркер реального счёта (`scripts/live-worker.ts`, spec 0047 и 0049) работает на VM `apps-tokyo` как сервис
`binance-live`. Выкатывается из CI вместе с приложением. Торговый ключ субсчёта владелец уже положил на VM сам
(2026-10-17, `/etc/binance-live/app.env`, ключ ограничен IP VM, без вывода и переводов). Реальные сделки идут только
по ручному «Вкл» или «Авто» у эксперимента (spec 0049, 0053); сейчас у всех 68 экспериментов реальное зеркало «Выкл»,
поэтому после запуска воркер только проверяет ключ и права и шлёт пульс.

## Сценарии
1. После мержа в `main` CI выкатывает и сайт, и `live-worker.mjs`. Если сервис `binance-live` включён, он
   перезапускается и доделывает начатую сделку (SIGTERM, до 120 с).
2. После запуска карточка «Реальный счёт» на `/settings` показывает подключённый воркер, проверку ключа и прав.
   Ордеров нет, пока владелец не включит реальное зеркало у эксперимента. Первую сделку владелец делает вместе с
   сессией real-money.
3. Новый ключ (замена) — по шагам из `deploy-lightsail.md`: `sudoedit` и рестарт сервиса.
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
  - Сбой выкатки воркера роняет job, но сайт уже выкачен; в журнале шага видна причина. Сборка воркера
    (`pnpm live:build`) идёт и в CI на каждом PR, поэтому её поломка ловится до мержа.
- **Сервис на VM** (делает Claude один раз после мержа):
  - `add-project.sh binance-live --no-web --exec live-worker.mjs --memory 128M --heap 96 --stop-timeout 120`
    повторно: unit получает `TimeoutStopSec=120` и `KillSignal=SIGTERM`, которых в нём сейчас нет;
  - в `/etc/binance-live/app.env` (root:binance-live 640):
    - `LIVE_WORKER_SECRET` — тот же, что в `/etc/binance/app.env`;
    - `LIVE_APP_URL=http://127.0.0.1:5000` — приложение на той же VM, без TLS и без выхода в интернет;
  - строки ключа (`BINANCE_TRADE_API_*`), вписанные владельцем, не трогаются и не выводятся;
  - `systemctl enable --now binance-live`.
- **Ключ владельца:** `BINANCE_TRADE_API_KEY` и `BINANCE_TRADE_API_SECRET` уже в том же файле (`sudoedit`, под
  `aleksandr`); замена — так же, затем `sudo systemctl restart binance-live`. В ключе на Binance — белый список IP: static IP VM.
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
- [ ] AC7. В журнале `binance-live`: «ключ задан, пульс → http://127.0.0.1:5000», пульсы принимаются (200, не 401),
  проверка ключа и прав проходит. Карточка «Реальный счёт» на `/settings` показывает подключённый воркер. Ордеров нет
  (у всех экспериментов реальное зеркало «Выкл»). Сессия real-money оповещена для проверки и первой сделки.
- [ ] AC8. `systemctl restart binance-live` завершается без SIGKILL.

## Вне scope
- Сам торговый ключ и первая сделка — владелец с сессией real-money.
- Сторож зависшего тика — отдельная задача (строка очереди из AC4).
- Ключ реального аккаунта в базе (п. 22), бэкапы (п. 23).

## Журнал
| Дата | Событие |
|---|---|
| 2026-10-17 | ТЗ заведено; ключ владельца уже на VM — ТЗ уточнено (запуск с ключом при «Выкл» у всех 68 экспериментов), утверждено |
| 2026-10-17 | Код: `deploy.yml` (сборка и выкатка воркера, рестарт только включённого), `ci.yml` (`pnpm live:build`), `scripts/server/smoke.sh` и этап smoke `/flow release` по SQLite, раздел «Воркер реального счёта» в `deploy-lightsail.md`, PRD (п. 20 🚧, п. 27). На VM до мержа: unit `TimeoutStopSec=120`, `KillSignal=SIGTERM`; `LIVE_WORKER_SECRET`, `LIVE_APP_URL` в `app.env`; сервис выключен |
| 2026-10-17 | Тестер PASS (5/5, мелочи исправлены); ревью PR #100 — 4 minor (сборка воркера в CI, порядок шагов и автозапуск у `add-project.sh`, команды `LIVE_*`, журнал spec) и nits — исправлены |
