# AI-конвейер разработки

Решения пользователя (2026-10-10): мержит пользователь (`/merge`); приёмка — AI-Tester + пользователь
по скриншотам; ТЗ — файлы `docs/specs/`; запуск — команды `/feature` и `/bug`.

```
/feature <требование>   |   /bug <описание>
 │
 ├─1. ANALYST — главная сессия (нужен диалог)            → docs/PRD.md + docs/specs/NNN-slug.md
 │     ⏸ пользователь подтверждает ТЗ
 ├─2. DEVELOPER — субагент `developer`                    → ветка feat|fix/NNN-slug, код + тесты, push
 ├─3. TESTER — субагент `tester`                           → скриншоты + отчёт PASS/FAIL по критериям
 │     FAIL → 2 (до 3 кругов, дальше — к пользователю)
 │     ⏸ пользователь смотрит скриншоты: «ок» / «не то: …» (→ 2)
 ├─4. DEVELOPER открывает PR (draft → ready)
 ├─5. REVIEWER — субагент `reviewer`                       → ревью-комментарий в PR
 │     есть замечания → 2 (до 3 кругов, дальше — к пользователю)
 │     замечаний нет → label `ai-approved`
 └─6. ⏸ пользователь: /merge → проверки → squash-merge → статусы в PRD/spec
CI (GitHub Actions) — на каждый PR и push в main: Biome · Steiger · typecheck · Vitest · build.
```

## Роли
| Роль | Где | Может | Не может |
|---|---|---|---|
| Analyst | главная сессия (скиллы `/feature`, `/bug`) | спрашивать пользователя, писать PRD и spec | писать код |
| Developer | `.claude/agents/developer.md` | код, тесты, git, push, PR | мержить, менять spec без согласования |
| Tester | `.claude/agents/tester.md` | запускать приложение, Playwright MCP, скриншоты | править код |
| Reviewer | `.claude/agents/reviewer.md` | читать код, комментировать PR, ставить label | править код, мержить |

Почему Analyst не субагент: субагенты не ведут диалог с пользователем. Почему Reviewer — отдельный
субагент: свежий контекст, не «помнит», как писался код.

## Артефакты задачи
- `docs/specs/NNN-slug.md` — ТЗ (шаблоны `_template-feature.md`, `_template-bug.md`). NNN — следующий
  свободный номер. В конце spec — «Журнал»: ветка, PR, круги тестов/ревью, статус.
- `docs/specs/NNN-slug/screens/*.png` — скриншоты приёмки (коммитятся в ветку задачи).
- PR со ссылкой на spec; ревью — комментарием в PR (approve своего PR GitHub не даёт → label `ai-approved`).

## Защита main
Репозиторий приватный на Free-плане — branch protection GitHub не применяется. Поэтому:
- pre-push хук `scripts/hooks/pre-push` (ставится `pnpm hooks:install`) блокирует push в `main` и гоняет `pnpm check`;
- `/merge` мержит только при зелёном CI и label `ai-approved`.
Если перейти на GitHub Pro или сделать репо публичным — включить required status check `CI` для `main`.

## Worktree — временно не используются
Решение пользователя 2026-10-10 (до отдельного указания, проект пока небольшой): новые worktree не создаём.
Конвейер работает в основном checkout, в ветке задачи; одна задача за раз, перед сменой ветки — чистое
дерево. Старые worktree удаляет `/merge`, когда их ветки смержены. Вернуть worktree — снять запрет в `CLAUDE.md`.

## Мелочи без конвейера
Опечатки, тексты, правки документации можно делать напрямую в ветке `chore/…`/`docs/…` + PR, без spec.
