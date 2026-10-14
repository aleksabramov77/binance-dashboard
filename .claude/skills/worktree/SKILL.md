---
name: worktree
description: Worktree на задачу binance-dashboard через `pnpm wt` — создать (ветка от свежего main, ссылка на .env.local, зависимости), поднять локальный сервер worktree для проверки, удалить после мержа, найти и убрать забытые. Используй, когда начинаешь задачу, проверяешь её на локальном сервере, мержишь или наводишь порядок в worktree; никогда не создавай worktree встроенными командами.
argument-hint: "[next | new <ветка> | serve | stop | list | remove <ветка> | prune]"
---

# Worktree на задачу

Каждая задача (фича, баг, chore) — своя ветка в своём worktree (решение пользователя 2026-10-15). Основной checkout
(`~/Projects/my/binance-dashboard`) всегда стоит на чистом `main`: в нём только мерж и выкатка. Так задачи не мешают
друг другу, а у каждой свой локальный сервер для проверки.

## Где и как называются

Плоско рядом с основным checkout: `~/Projects/my/binance-dashboard_<метка>`. Метка — последний сегмент ветки
(`feature/0012-sort-memory` → `binance-dashboard_0012-sort-memory`) или своя через `--name`: несколько слов, чтобы
потом узнать задачу. Новая ветка — по соглашению `feature|bug|hotfix|chore/NNNN-slug` (`docs/ai/conventions.md` →
«Git»), номер — `pnpm -s wt next`; другое имя или занятый номер `pnpm wt new` не примет. Уже существующую ветку
(локально или на GitHub) откроет с любым именем.

**Не создавать worktree встроенными командами** — `EnterWorktree`, `claude --worktree`, режимом worktree агентов или
голым `git worktree add`: они кладут worktree в `.claude/worktrees/` основного репозитория и не готовят его (нет
`.env.local`, зависимостей). Только `pnpm wt new`.

## Команды

```bash
pnpm -s wt next                              # номер новой задачи: журнал main + ещё не влитые ветки задач
pnpm wt new feature/0012-sort-memory         # из любого места репозитория: ветка от свежего origin/main, ссылки, pnpm install
pnpm wt new bug/0013-x --from origin/bug/…   # от другой базы; существующая ветка (локально или на GitHub) — просто откроется
pnpm wt serve                                # внутри worktree: локальный сервер, печатает адрес http://localhost:<порт>
pnpm wt stop                                 # остановить его
pnpm wt list                                 # все worktree: ветка, изменения, незапушенное, PR, адрес сервера
pnpm wt link                                 # внутри worktree: создать или починить ссылки (после git worktree move)
pnpm wt remove feature/0012-sort-memory      # остановить сервер и удалить worktree; после мержа — и локальную ветку
pnpm wt prune [--older-than 24h] [--dry-run] # удалить worktree задач, влитых давно; показать забытые
```

`serve`, `stop`, `remove` без аргумента работают с worktree, в котором запущены; `--path <worktree>` — с другим.

## Локальный сервер worktree

`pnpm wt serve` запускает `pnpm dev` этого worktree в фоне: свой порт (5000+, первый свободный), **своя база PGlite**
в `data/pglite` worktree и **вход выключен** (`DATABASE_URL=`, `AUTH_SECRET=`). Прод (Supabase) не трогается, а
Playwright тестировщика заходит без GitHub. Адрес и PID — в `.git/worktrees/<имя>/dev-server.json`, журнал —
`dev-server.log` рядом. Повторный `serve` возвращает адрес уже запущенного сервера.

На этом сервере агент-тестировщик проверяет задачу **до PR** и **ещё раз после правок по ревью** — перед повторным
ревью (`.config/flows/feature.yaml`, `bug.yaml`).

## Связанные файлы

Неотслеживаемые файлы, без которых worktree не работает, перечислены в `.claude/worktree-links.json` основного
checkout: строка — относительная симлинка на файл основного checkout, `{ "path": …, "mode": "copy" }` — независимая
копия (если worktree должен менять файл сам). Сейчас там `.env.local` и `private` — клон приватного репозитория
с экспериментами и анализами лаборатории (spec 0015; ссылка создаётся, только если он есть в основном checkout). Личные добавки —
`.claude/worktree-links.local.json` (не коммитится), в том же формате. Настоящие файлы в worktree никогда не
перезаписываются; ссылки после `git worktree move` чинит `pnpm wt link`.

## Когда удалять

- **После мержа** — `pnpm wt remove <ветка>` из основного checkout: последний этап `/flow feature` и `/flow bug`.
  Сервер останавливается, worktree и локальная ветка удаляются. Если в worktree есть незакоммиченные изменения или
  незапушенные коммиты, удаление отказывает; удалить всё равно — `--force`, только по решению пользователя.
- **Забытые** — хук `SessionStart` (`.claude/settings.json`) при старте каждой сессии запускает
  `pnpm wt prune --quiet`: удаляет worktree, чей PR влит больше суток назад, если в нём всё закоммичено и запушено
  (сервер останавливает). Остальное только показывает: PR закрыт без мержа, влит, но есть изменения, нет PR больше
  14 дней. Вручную то же — `/flow worktree-cleanup`. Текущий worktree сессии и основной checkout не трогаются никогда.
