---
name: merge
description: Мерж одобренного PR binance-dashboard в main — проверяет идентичность GitHub, зелёный CI и label ai-approved, делает squash-merge, обновляет PRD/spec и удаляет ветку и worktree. Только по явной команде пользователя /merge.
argument-hint: <номер PR>
disable-model-invocation: true
---

PR: $ARGUMENTS (если пусто — `gh pr list` и спроси, какой). Все вызовы `gh` — только
`GH_CONFIG_DIR="$HOME/.config/gh-personal" gh …`.

## Проверки — если любая не прошла, остановись и объясни, ничего не мержь
1. `gh auth status` → аккаунт `aleksabramov77`; `git remote -v` → `aleksabramov77/binance-dashboard`.
2. `gh pr view <N> --json state,isDraft,labels,headRefName,mergeable,title,body`:
   открыт, не draft, `mergeable` = MERGEABLE, есть label `ai-approved`.
3. `gh pr checks <N>` — все проверки зелёные (идут — `--watch` и дождись).

## Мерж
1. `gh pr merge <N> --squash` (заголовок — заголовок PR). Без `--delete-branch`: ветка открыта в worktree задачи,
   gh не сможет удалить её локально и тогда не удалит и на GitHub. Ветку на GitHub удали сам —
   `git push origin --delete <headRefName>`, но только когда `gh pr view <N> --json state` показывает `MERGED`:
   удаление ветки открытого PR закрывает его.
2. Основной checkout (первая строка `git worktree list`) стоит на `main` — там `git pull --ff-only`. Открыта другая
   ветка или есть незакоммиченные изменения — не трогай: `git fetch origin main:main` и сообщи пользователю.
3. Статусы обновляются ещё в ветке задачи (шаг 6 конвейера), поэтому после мержа проверь в `main`:
   spec из тела PR — статус `done`, требование в `docs/PRD.md` — ✅ и строка в «Журнале работ»,
   строка задачи в `docs/HISTORY.md` — ✅ и номер PR (номер задачи — из заголовка PR `NNNN: …`).
   Если забыли — сообщи пользователю, предложи `chore/NNNN-…`-PR; сам в `main` не пушь.

## Уборка
- `git fetch --prune`. Локальную ветку PR удаляет `pnpm wt remove` вместе с worktree (ниже); ветку без worktree —
  `git branch -D <headRefName>`.
- Worktree задачи (`pnpm wt list`): удаляется после выкатки — `pnpm wt remove <headRefName>` (этап `cleanup`
  в `/flow feature|bug`; при мерже без `/flow` — сразу после выкатки). Есть незакоммиченные изменения или
  незапушенные коммиты — не удаляй, спроси пользователя. Забытые worktree других влитых задач —
  `pnpm wt prune` (его же запускает хук `SessionStart`).

## Отчёт пользователю
Что смержено (заголовок, коммит в main), что убрано (ветки, worktree), что обновлено в PRD/spec.
