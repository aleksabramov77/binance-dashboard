# 0063 · Ссылки в Telegram ведут на старый адрес Vercel

- **Тип:** bug
- **Статус:** in-progress
- **Серьёзность:** major
- **Дата:** 2026-10-17

## Шаги воспроизведения
1. Прод работает на VM apps-tokyo (spec 0055); в `/etc/binance/app.env` нет `SITE_URL`.
2. Реальное зеркало открывает сделку — приходит сообщение в Telegram (spec 0049).
3. Ссылка в сообщении: `https://binance-dashboard-gold.vercel.app/settings#live`.

## Ожидаемое поведение
Ссылки во всех сообщениях бота (сделки реального счёта, монитор журнала, место в БД) ведут на текущий прод —
адрес из `SITE_URL`, то есть сайт на VM.

## Фактическое поведение
```
Binance Dashboard · 🟢 Реальная сделка: F04 HYPEUSDT (USDⓈ-M) short $9,56, SL 80.05558686955933, TP 78.77332426088135
https://binance-dashboard-gold.vercel.app/settings#live
```
На VM `grep -c '^SITE_URL=' /etc/binance/app.env` → 0.

## Причина
`getSiteUrl()` (`src/shared/config/env.server.ts`) при пустом `SITE_URL` подставляет зашитый адрес Vercel. После
переезда на VM `SITE_URL` в env сервиса не задали (его передавали только разово в `pnpm telegram:setup`), поэтому
все ссылки в уведомлениях — `liveAccount.ts`, `logMonitor.ts`, `dbSpace.ts` — ведут на Vercel. Адрес VM зашить
вместо Vercel нельзя: IP в репозиторий не пишется (`.env.example` → «Своя VM apps-tokyo»).

## Критерии приёмки
- [ ] AC1. В коде нет запасного адреса Vercel: `getSiteUrl()` возвращает адрес из `SITE_URL` без завершающего `/`,
  а без него — `null`.
- [ ] AC2. Без `SITE_URL` сообщения бота уходят без строки-ссылки (текст тот же), ссылка на Vercel не появляется.
  С `SITE_URL` — ссылка `${SITE_URL}/settings#live` (и `/logs` у монитора и места в БД), как раньше.
- [ ] AC3. `pnpm telegram:setup` без `SITE_URL` не регистрирует webhook, а пишет, что нужен `SITE_URL`.
- [ ] AC4. `SITE_URL` описан в `.env.example` (раздел Telegram): что это и где задаётся (env сервиса на VM); в
  `docs/ai/deploy-lightsail.md` — строка `SITE_URL` в env VM при переезде и явный адрес Vercel в инструкции отката.
- [ ] AC5. Есть тесты, которые падали до фикса и проходят после (`getSiteUrl` без `SITE_URL`, текст сообщения без
  ссылки).
- [ ] AC6. Выкатка: `SITE_URL=https://binance.<ip>.sslip.io` в `/etc/binance/app.env`, сервис перезапущен;
  следующее сообщение бота ведёт на VM.

## Вне scope
- `scripts/mirror-supabase.ts`, `scripts/monitor-supabase.ts`, `scripts/earn-supabase.ts` — скрипты режима отката на Supabase, они вызывают
  роуты Vercel и остаются как есть.
- Прошлые сообщения в Telegram не правятся.

## Журнал
| Дата | Событие |
|---|---|
| 2026-10-17 | Баг заведён: ссылка в сообщении о реальной сделке ведёт на binance-dashboard-gold.vercel.app |
| 2026-10-17 | Код: `getSiteUrl()` без запасного адреса Vercel (`null`), `getSiteLink(path)`; сообщения `notifyLive`, монитора журнала и места в БД без ссылки при пустом `SITE_URL`; `telegram:setup` требует `SITE_URL`; `SITE_URL` в `.env.example` и `deploy-lightsail.md`; тесты |
