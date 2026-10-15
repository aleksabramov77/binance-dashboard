# AI-конвейер разработки

Решения пользователя (2026-10-10): мержит пользователь (`/merge`); приёмка — AI-Tester + пользователь
по скриншотам; ТЗ — файлы `docs/specs/`; запуск — команды `/feature` и `/bug`. С 2026-10-15 каждая задача —
в своём worktree с локальным сервером для проверки (скилл `worktree`, `pnpm wt`).

```
/feature <требование>   |   /bug <описание>
 │
 ├─1. ANALYST — главная сессия (нужен диалог)  → номер `pnpm wt next`, worktree `pnpm wt new feature|bug/NNNN-slug`,
 │     в нём docs/PRD.md + docs/specs/NNNN-slug.md + строка docs/HISTORY.md
 │     ⏸ пользователь подтверждает ТЗ → первый коммит ветки
 ├─2. DEVELOPER — субагент `developer` в worktree задачи  → код + тесты, push
 ├─3. `pnpm check && build` → `pnpm wt serve` (локальный сервер worktree: PGlite, без входа)
 │     TESTER (субагент) проходит AC на этом сервере → скриншоты + PASS/FAIL
 │     FAIL → 2 (до 3 кругов, дальше — к пользователю)
 │     ⏸ пользователь смотрит скриншоты: «ок» / «не то: …» (→ 2)
 ├─4. DEVELOPER открывает PR — только после PASS и «ок»
 ├─5. REVIEWER — субагент `reviewer`                       → ревью-комментарий в PR
 │     есть замечания → DEVELOPER правит → TESTER снова все AC на локальном сервере → REVIEWER
 │     (до 3 кругов, дальше — к пользователю); замечаний нет → label `ai-approved`
 ├─6. статусы в PRD, spec и docs/HISTORY.md, зелёный CI → ⏸ пользователь: «мерж» → squash-merge
 ├─7. выкатка (`/flow release`) → `pnpm wt remove <ветка>` (сервер остановлен, worktree удалён)
 └─8. закрытие: хвосты проверены, другие сессии оповещены → 🎉 «сессию можно закрывать» (иначе ⛔ «пока не закрывать»)
CI (GitHub Actions) — на каждый PR и push в main: Biome · Steiger · typecheck · Vitest · build.
```

## Процессы целиком: `/flow`
Общий скилл `flow` (`~/.claude-second/skills/flow/`, решение пользователя 2026-10-15) прогоняет задачу по
этапам из `.config/flows/*.yaml` и после каждого этапа пишет ход прогона в `.git/flow/<run-id>.yaml`. После
сжатия контекста или в новой сессии тот же `/flow <имя>` продолжает с первого незавершённого этапа.

| Команда | Этапы |
|---|---|
| `/flow feature "<требование>"` | скилл `feature` до готового PR → ⏸ «мержить?» → мерж по `.claude/skills/merge/SKILL.md` → `release` → `cleanup` → `close` (🎉 «сессию можно закрывать») |
| `/flow bug "<описание>"` | то же со скиллом `bug` |
| `/flow release` | выкатка влитого в main: `db:migrate` → Edge Function `engine-tick` → кроны → ⏸ env на Vercel (`!`-командой пользователя) → ожидание деплоя Vercel → смоук-проверки |
| `/flow worktree-cleanup` | удалить worktree давно влитых задач (с остановкой их сервера) и разобрать забытые |
| `/flow lab ["<фокус>"]` | лаборатория экспериментов (worktree `chore/NNNN-lab-<дата>`): `pnpm lab:report` → отчёт по сделкам эпохи с контекстом рынка → субагент `quant` разбирает (review.md: подозрительное, решения keep/mirror/tune/pivot/kill, команда `lab:apply`) ⏸ → `pnpm lab:apply` только подтверждённое → `quant` пишет карточки гипотез (ideas.md) ⏸ выбор одной → журнал `docs/lab/` (journal.md, hypotheses.md) → PR → `reviewer` → ⏸ мерж → `pnpm wt remove` → выбранная карточка в `flow feature`. Фокус — id («F06 F07»), группа, вопрос или своя идея |
| `/flow status` | незавершённые прогоны: этап, ветка, PR |

Этап выкатки выполняется, только если выполнено условие из его `note` (например, миграции — только при
изменениях в `drizzle/`); остальные пропускаются с причиной. Мерж и загрузка секретов — всегда за ⏸.
Claude запускать из папки проекта (`~/Projects/my/binance-dashboard`): из `~/Projects/my` не видны скиллы и
настройки проекта, а git-команды процессов не работают.

## Роли
| Роль | Где | Может | Не может |
|---|---|---|---|
| Analyst | главная сессия (скиллы `/feature`, `/bug`) | спрашивать пользователя, заводить worktree задачи, писать PRD и spec | писать код |
| Developer | `.claude/agents/developer.md` | код, тесты, git, push, PR | мержить, менять spec без согласования |
| Tester | `.claude/agents/tester.md` | Playwright MCP на локальном сервере worktree, скриншоты | править код |
| Reviewer | `.claude/agents/reviewer.md` | читать код, комментировать PR, ставить label | править код, мержить |
| Quant | `.claude/agents/quant.md` (из `/flow lab`) | читать отчёт и сделки прогона, считать поверх `trades.csv`, писать `review.md` и `ideas.md` | менять БД (`lab:apply`), код, журнал `docs/lab`, git |

Почему Analyst не субагент: субагенты не ведут диалог с пользователем. Почему Reviewer — отдельный
субагент: свежий контекст, не «помнит», как писался код.

## Артефакты задачи
- Номер задачи `NNNN` — сквозной на все типы, строка в `docs/HISTORY.md` (правила — `conventions.md` → «Git»).
- `docs/specs/NNNN-slug.md` — ТЗ (шаблоны `_template-feature.md`, `_template-bug.md`). В конце spec —
  «Журнал»: ветка, PR, круги тестов/ревью, статус.
- `docs/specs/NNNN-slug/screens/*.png` — скриншоты приёмки (коммитятся в ветку задачи).
- PR со ссылкой на spec; ревью — комментарием в PR (approve своего PR GitHub не даёт → label `ai-approved`).

## Защита main
Репозиторий приватный на Free-плане — branch protection GitHub не применяется. Поэтому:
- pre-push хук `scripts/hooks/pre-push` (ставится `pnpm hooks:install`) блокирует push в `main` и гоняет `pnpm check`;
- `/merge` мержит только при зелёном CI и label `ai-approved`.
Если перейти на GitHub Pro или сделать репо публичным — включить required status check `CI` для `main`.

## Worktree на задачу
Решение пользователя 2026-10-15 (отменяет «один чат, без worktree» от 2026-10-10): каждая задача — своя ветка в
своём worktree `~/Projects/my/binance-dashboard_<метка>`, созданном `pnpm wt new` (скилл `worktree`): ветка от
свежего `main`, ссылки на `.env.local` и `private/` (если есть) по списку `.claude/worktree-links.json`, зависимости. Основной checkout всегда
на чистом `main` — в нём только мерж и выкатка; spec и строка журнала задачи пишутся уже в её worktree. У каждого worktree свой локальный сервер (`pnpm wt serve`, свой порт
и своя PGlite): на нём Tester проверяет задачу до PR и после каждого круга правок по ревью.

После мержа и выкатки задача удаляет свой worktree — `pnpm wt remove <ветка>` (останавливает сервер,
удаляет worktree и локальную ветку), а последним сообщением сессии выводит блок «сессию можно закрывать» (шаг 8). Чтобы забытые копии не копились, хук `SessionStart` (`.claude/settings.json`)
при старте каждой сессии запускает `pnpm wt prune --quiet`: удаляет worktree, чей PR влит больше суток назад и в
котором всё закоммичено и запушено, остальное показывает. Видно всё командой `pnpm wt list`. Встроенные
`EnterWorktree`/`--worktree` и голый `git worktree add` не использовать — они не готовят worktree.

## Мелочи без конвейера
Опечатки, тексты, правки документации можно делать напрямую в ветке `chore/NNNN-slug` (тоже в своём worktree) + PR,
без spec.
Номер и строка в `docs/HISTORY.md` нужны и здесь. Срочный фикс прода — `hotfix/NNNN-slug` (можно без spec,
но с падающим тестом).
