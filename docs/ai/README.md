# Документация для AI-агентов

Читать в начале любой задачи. Порядок: этот файл → `architecture.md` → `conventions.md` →
спецификация задачи (`docs/specs/NNNN-*.md`) → README модуля, который меняешь.

| Файл | О чём |
|---|---|
| [`../PRD.md`](../PRD.md) | Что за продукт, требования по разделам, решения пользователя, журнал этапов |
| [`architecture.md`](architecture.md) | FSD-слои, сервер/клиент, данные, логирование, где что лежит |
| [`conventions.md`](conventions.md) | Нейминг, тесты, номер задачи, коммиты, ветки, PR, Definition of Done |
| [`workflow.md`](workflow.md) | AI-конвейер: `/feature`, `/bug`, `/merge`, процессы `/flow`, worktree на задачу, роли агентов |
| [`glossary.md`](glossary.md) | Глоссарий терминов и сокращений (AG, Paper/Demo/Real, эпоха, PF…) — источник истины для `/help` (`pnpm glossary`) |
| [`deploy-supabase.md`](deploy-supabase.md) | **Основной деплой:** Supabase (БД, тик) + Vercel (интерфейс, регион Tokyo) |
| [`deploy.md`](deploy.md) | Резервный деплой на Oracle Cloud (Dubai): VM, HTTPS, Supabase, GitHub OAuth, автодеплой, ключи на сервере |
| [`../specs/`](../specs/) | ТЗ на каждую фичу и баг (`NNNN-slug.md`) + шаблоны |
| [`../lab/`](../lab/) | Указатель: память лаборатории (журнал, гипотезы, прогоны) — в приватном репозитории `private/lab/` |

README внутри сложных модулей (читать перед правкой модуля):
- `src/shared/api/binance/README.md` — клиенты Binance: публичный, read-only, Demo Trading.
- `src/features/execute-trade/README.md` — исполнение демо-сделок.
- `src/features/scan-market/README.md` — сканер рынка и правила сетапов.

## Проект в двух словах
Личный локальный дашборд Binance (один пользователь, работает на его Mac): портфель, Earn,
сигналы и сделки в 1 клик на **Binance Demo Trading**, логи. Live-торговли нет намеренно.

## Команды
| Команда | Что делает |
|---|---|
| `pnpm dev` | dev-сервер на первом свободном порту от 5000 (адрес — в выводе `Local: http://localhost:<порт>`) |
| `pnpm check` | Biome + Steiger + typecheck + Vitest — то же, что CI, без сборки |
| `pnpm build` | production-сборка (в CI тоже) |
| `pnpm test` | Vitest |
| `pnpm lint` / `pnpm lint:fsd` | Biome / Steiger (FSD) |
| `pnpm format` | автоформат Biome |
| `pnpm lab:report` | read-only отчёт лаборатории по эпохе из БД: метрики, t, R до издержек и издержки, MFE и MAE, разрезы по контексту входа, отсечённые сигналы, контроль, контекст рынка BTC, семейства, подсказки (`--run 1` — прошлая эпоха, `--experiment F06`, `--since 7d`, `--out <каталог>`, `--no-market`, `--after-exit` — догрузить свечи: что было после выхода и исход отсечённых сигналов; открытые позиции — по последней цене `ticker/price`, «Откр.» и «Нереализ. R / $», `--no-prices` — без запроса) — вход для `/flow lab` |
| `pnpm lab:apply` | применить решения разбора: `--disable`/`--enable` эксперимент, `--mirror-on`/`--mirror-off` демо-зеркало вручную, `--mirror-auto` — положение «Авто» (автомат сразу решает, spec 0043) (id каталога `S01`/`F20` и приватные `PS01`/`PF01`/`PC01`), `--dry-run`, `--out <каталог>` (пишет apply.md) — те же тумблеры, что в /settings; выключение — только с причиной `--reason <id>=<категория>` (+ `--note <id>=<текст>`), повтор для уже выключенного обновляет причину, контрольный с включёнными вариантами — только с `--force-control` (spec 0046); печатает, к какой БД подключён, без `DATABASE_URL` отказывается (нужен `--local`); только по подтверждению пользователя |
| `pnpm lab:backtest` | бэктест экспериментов по истории свечей Binance (spec 0032): тот же `runTick` движка по шагу закрытия свечи, без заглядывания вперёд; `--ids F10,PF99` (+ `--file private/experiments.json`), `--days 120`, `--split 0.66` (обучающая и проверочная части), `--exit-tf auto\|1m\|5m\|15m`, `--no-download` (только кэш `~/.cache/binance-dashboard`); отчёт как у `lab:report` в `--out` (по умолчанию `private/lab/backtests/<дата>-<хэш>/`), открытые на конец периода — по close последней свечи; ордеров и БД нет |
| `pnpm telegram:setup [--delete]` | webhook бота Telegram на прод (`${SITE_URL}/api/telegram/webhook`, секрет `TELEGRAM_WEBHOOK_SECRET`) и меню команд; `--delete` — снять webhook |
| `pnpm hooks:install` | включить pre-push хук (запрет push в main + `pnpm check`) |
| `pnpm lab:private [--dry-run] [--prod] [--file <path>]` | записать приватные эксперименты из `private/experiments.json` в БД: в прод (Postgres) — только с `--prod`; для локального сервера worktree — `DATABASE_URL= pnpm lab:private` при остановленном сервере (`architecture.md` → «Приватные эксперименты») |

Ключи — только в `.env.local` (пример — `.env.example`), в git не попадают. Без ключей приложение
работает частично: соответствующие блоки показывают «не настроено». CI ключей не имеет.

## Нельзя
- Никогда не отправлять реальные ордера: торговля — только через демо-хосты (`demo-api`, `demo-fapi`).
- Не логировать и не отдавать на клиент секреты (логгер маскирует, но не полагайся только на это).
- Не использовать MobX, CRA, Moment.js, ручные Webpack-конфиги.
- Не трогать рабочие аккаунты/репозитории (SDG, Cupid Media). GitHub — только `aleksabramov77`,
  `gh` — только с `GH_CONFIG_DIR="$HOME/.config/gh-personal"`.
