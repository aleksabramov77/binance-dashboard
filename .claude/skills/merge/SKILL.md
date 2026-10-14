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
1. `gh pr merge <N> --squash --delete-branch` (заголовок — заголовок PR).
2. В основном checkout (путь — первая строка `git worktree list`): `git switch main && git pull --ff-only`.
   Если там незакоммиченные изменения — не трогай, только сообщи.
3. Статусы обновляются ещё в ветке задачи (шаг 6 конвейера), поэтому после мержа проверь в `main`:
   spec из тела PR — статус `done`, требование в `docs/PRD.md` — ✅ и строка в «Журнале работ»,
   строка задачи в `docs/HISTORY.md` — ✅ и номер PR (номер задачи — из заголовка PR `NNNN: …`).
   Если забыли — сообщи пользователю, предложи `chore/NNNN-…`-PR; сам в `main` не пушь.

## Уборка
- Локальная ветка PR: `git branch -D <headRefName>`, если осталась; `git fetch --prune`.
- Старые worktree (новые не создаём — `CLAUDE.md`): для каждого из `git worktree list`, кроме
  основного, чья ветка смержена в `main` (`git branch --merged main`) или удалена на remote, —
  `git worktree remove <путь>` (незакоммиченные изменения внутри → не удаляй, спроси пользователя),
  затем `git worktree prune`. Worktree с несмерженными ветками не трогай.

## Отчёт пользователю
Что смержено (заголовок, коммит в main), что убрано (ветки, worktree), что обновлено в PRD/spec.
