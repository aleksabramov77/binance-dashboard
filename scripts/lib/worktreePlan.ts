// Чистая часть `pnpm wt` (scripts/worktree.ts): разбор `git worktree list --porcelain`, список связанных файлов
// и решение, какие worktree удалить при очистке. Без git, fs и сети — всё это передаёт CLI.

export interface WorktreeEntry {
  path: string;
  /** Короткое имя ветки (без refs/heads/); null — detached HEAD. */
  branch: string | null;
  /** Основной checkout — первый в списке git. */
  main: boolean;
}

/** `git worktree list --porcelain` → записи; первая — основной checkout. */
export function parseWorktreeList(porcelain: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  for (const block of porcelain.trim().split(/\n\s*\n/)) {
    let path: string | null = null;
    let branch: string | null = null;
    let bare = false;
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line.startsWith("branch "))
        branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
      else if (line === "bare") bare = true;
    }
    if (path && !bare)
      entries.push({ path, branch, main: entries.length === 0 });
  }
  return entries;
}

export interface LinkEntry {
  /** Путь от корня репозитория. */
  path: string;
  /** link — относительная симлинка на файл основного checkout; copy — независимая копия. */
  mode: "link" | "copy";
}

/**
 * Связанные пути, если `.claude/worktree-links.json` нет. `private` — клон приватного репозитория с
 * экспериментами и анализами лаборатории (spec 0015): одна копия на все worktree, ссылка — если он есть.
 */
export const DEFAULT_LINKS = [".env.local", "private"];

/**
 * Записи `.claude/worktree-links.json` (+ `.local.json`): строка — ссылка, `{ path, mode: "copy" }` — копия.
 * Пути вне репозитория и повторы отбрасываются.
 */
export function normalizeLinks(...lists: unknown[]): LinkEntry[] {
  const out = new Map<string, LinkEntry>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const raw =
        typeof item === "string"
          ? { path: item, mode: "link" as const }
          : item &&
              typeof item === "object" &&
              typeof (item as { path?: unknown }).path === "string"
            ? {
                path: (item as { path: string }).path,
                mode:
                  (item as { mode?: unknown }).mode === "copy"
                    ? ("copy" as const)
                    : ("link" as const),
              }
            : null;
      if (!raw) continue;
      const path = raw.path.replace(/^\.\/+/, "").replace(/\/+$/, "");
      if (!path || path.startsWith("/") || path.split("/").includes(".."))
        continue;
      if (!out.has(path)) out.set(path, { path, mode: raw.mode });
    }
  }
  return [...out.values()];
}

const UNITS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** «90m», «24h», «3d» → миллисекунды; иначе null. */
export function parseDuration(value: string): number | null {
  const match = /^(\d+)\s*([mhd])$/.exec(value.trim());
  return match ? Number(match[1]) * UNITS[match[2]] : null;
}

export interface PullRequestInfo {
  number: number;
  state: "OPEN" | "CLOSED" | "MERGED";
  mergedAt: string | null;
  closedAt: string | null;
  /** Последний коммит PR — база для «незапушенного», когда ветку на GitHub уже удалили. */
  headRefOid?: string;
}

export interface PruneInput {
  branch: string | null;
  /** Незакоммиченные изменения, включая новые неотслеживаемые файлы. */
  dirty: boolean;
  /** Коммиты, которых нет на GitHub. */
  unpushed: number;
  /** Worktree, в котором запущена команда, — его не трогаем. */
  current: boolean;
  /** Последний PR этой ветки; null — PR нет. */
  pr: PullRequestInfo | null;
  /** Время последнего коммита ветки, мс. */
  lastCommitAt: number;
  now: number;
  /** Сколько ждать после мержа, прежде чем удалить. */
  olderThanMs: number;
  /** Через сколько напомнить о worktree без PR. */
  staleMs: number;
}

export type PruneDecision =
  | { action: "remove"; reason: string }
  /** Ничего не делать, пользователю сказать (attention) или промолчать. */
  | { action: "keep"; reason: string; attention: boolean };

const days = (ms: number) => Math.max(1, Math.round(ms / UNITS.d));
const age = (ms: number) =>
  ms < UNITS.d
    ? `${Math.max(1, Math.round(ms / UNITS.h))} ч назад`
    : `${days(ms)} дн. назад`;

/**
 * Что делать с worktree при очистке. Удаляем только то, что точно не жалко: PR влит давно, нет
 * незакоммиченных изменений и незапушенных коммитов. Остальное — оставить и, если похоже на забытое, сказать.
 */
export function planPrune(w: PruneInput): PruneDecision {
  if (w.current)
    return { action: "keep", reason: "открыт в этой сессии", attention: false };
  if (!w.branch)
    return {
      action: "keep",
      reason: "detached HEAD — разберитесь вручную",
      attention: true,
    };
  const pr = w.pr;
  if (pr?.state === "MERGED") {
    const since = w.now - Date.parse(pr.mergedAt ?? "");
    if (!(since >= w.olderThanMs))
      return {
        action: "keep",
        reason: `PR #${pr.number} влит ${Number.isFinite(since) ? age(since) : "недавно"}`,
        attention: false,
      };
    if (w.dirty)
      return {
        action: "keep",
        reason: `PR #${pr.number} влит ${age(since)}, но есть незакоммиченные изменения`,
        attention: true,
      };
    if (w.unpushed > 0)
      return {
        action: "keep",
        reason: `PR #${pr.number} влит ${age(since)}, но есть незапушенные коммиты (${w.unpushed})`,
        attention: true,
      };
    return { action: "remove", reason: `PR #${pr.number} влит ${age(since)}` };
  }
  if (pr?.state === "CLOSED")
    return {
      action: "keep",
      reason: `PR #${pr.number} закрыт без мержа — удалить или вернуть в работу?`,
      attention: true,
    };
  if (pr?.state === "OPEN")
    return {
      action: "keep",
      reason: `PR #${pr.number} открыт`,
      attention: false,
    };
  const idle = w.now - w.lastCommitAt;
  if (idle >= w.staleMs)
    return {
      action: "keep",
      reason: `нет PR, последний коммит ${age(idle)} — задача забыта?`,
      attention: true,
    };
  return { action: "keep", reason: "в работе, PR ещё нет", attention: false };
}

/** Последний PR каждой ветки из `gh pr list --json number,headRefName,state,mergedAt,closedAt`. */
export function latestPrByBranch(
  prs: (PullRequestInfo & { headRefName: string })[],
): Map<string, PullRequestInfo> {
  const map = new Map<string, PullRequestInfo>();
  for (const { headRefName, ...pr } of prs) {
    const known = map.get(headRefName);
    if (!known || pr.number > known.number) map.set(headRefName, pr);
  }
  return map;
}

/** Имя папки worktree: `<репозиторий>_<метка>`; метка по умолчанию — последний сегмент ветки. */
export function worktreeFolderName(
  repo: string,
  branch: string,
  label?: string,
): string {
  const tail = (label ?? branch.split("/").pop() ?? branch)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${repo}_${tail}`;
}

/** Новая ветка задачи (`docs/ai/conventions.md` → «Git»): `feature|bug|hotfix|chore/NNNN-slug`. */
export const BRANCH_PATTERN =
  /^(feature|bug|hotfix|chore)\/(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*$/;

const HISTORY_ROW = /^\| (\d{4}) \|/gm;
const TASK_BRANCH = /^(?:origin\/)?[a-z]+\/(\d{4})-/;

/**
 * Занятые номера задач: строки журнала `docs/HISTORY.md` ветки `main` и номера в именах веток задач — локальных
 * и на GitHub (`origin/…`). Ветки нужны, потому что строка журнала попадает в `main` только с мержем: без них
 * два параллельных worktree получили бы один номер.
 */
export function usedTaskNumbers(
  history: string,
  branches: string[],
): Set<number> {
  const used = new Set<number>();
  for (const match of history.matchAll(HISTORY_ROW)) used.add(Number(match[1]));
  for (const branch of branches) {
    const match = TASK_BRANCH.exec(branch);
    if (match) used.add(Number(match[1]));
  }
  return used;
}

/** Следующий номер задачи — на 1 больше всех занятых, четыре цифры. */
export function nextTaskNumber(used: Set<number>): string {
  return String(Math.max(0, ...used) + 1).padStart(4, "0");
}
