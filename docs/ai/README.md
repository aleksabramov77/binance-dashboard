# Документация для AI-агентов

Читать в начале любой задачи. Порядок: этот файл → `architecture.md` → `conventions.md` →
спецификация задачи (`docs/specs/NNNN-*.md`) → README модуля, который меняешь.

| Файл | О чём |
|---|---|
| [`../PRD.md`](../PRD.md) | Что за продукт, требования по разделам, решения пользователя, журнал этапов |
| [`architecture.md`](architecture.md) | FSD-слои, сервер/клиент, данные, логирование, где что лежит |
| [`conventions.md`](conventions.md) | Нейминг, тесты, номер задачи, коммиты, ветки, PR, Definition of Done |
| [`workflow.md`](workflow.md) | AI-конвейер: `/feature`, `/bug`, `/merge`, процессы `/flow`, worktree на задачу, роли агентов |
| [`deploy-supabase.md`](deploy-supabase.md) | **Основной деплой:** Supabase (БД, тик) + Vercel (интерфейс, регион Tokyo) |
| [`deploy.md`](deploy.md) | Резервный деплой на Oracle Cloud (Dubai): VM, HTTPS, Supabase, GitHub OAuth, автодеплой, ключи на сервере |
| [`../specs/`](../specs/) | ТЗ на каждую фичу и баг (`NNNN-slug.md`) + шаблоны |
| [`../lab/`](../lab/) | Память лаборатории: журнал прогонов `/flow lab`, бэклог гипотез, отчёты и разборы по датам |

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
| `pnpm lab:report` | read-only отчёт лаборатории по текущей эпохе из БД: метрики, t, MFE, контекст рынка BTC, семейства, подсказки (`--experiment F06`, `--since 7d`, `--out <каталог>`, `--no-market`) — вход для `/flow lab` |
| `pnpm lab:apply` | применить решения разбора: `--disable`/`--enable` эксперимент, `--mirror-on`/`--mirror-off` демо-зеркало, `--dry-run`, `--out <каталог>` (пишет apply.md) — те же тумблеры, что в /settings; печатает, к какой БД подключён, без `DATABASE_URL` отказывается (нужен `--local`); только по подтверждению пользователя |
| `pnpm hooks:install` | включить pre-push хук (запрет push в main + `pnpm check`) |

Ключи — только в `.env.local` (пример — `.env.example`), в git не попадают. Без ключей приложение
работает частично: соответствующие блоки показывают «не настроено». CI ключей не имеет.

## Нельзя
- Никогда не отправлять реальные ордера: торговля — только через демо-хосты (`demo-api`, `demo-fapi`).
- Не логировать и не отдавать на клиент секреты (логгер маскирует, но не полагайся только на это).
- Не использовать MobX, CRA, Moment.js, ручные Webpack-конфиги.
- Не трогать рабочие аккаунты/репозитории (SDG, Cupid Media). GitHub — только `aleksabramov77`,
  `gh` — только с `GH_CONFIG_DIR="$HOME/.config/gh-personal"`.
