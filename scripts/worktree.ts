// Worktree на задачу (решение пользователя 2026-10-15). Каждая задача — своя ветка в своём worktree, плоско рядом
// с репозиторием: ~/Projects/my/binance-dashboard_<метка>. Неотслеживаемые файлы из .claude/worktree-links.json
// (.env.local) — ссылками на основной checkout; у каждого worktree свой локальный сервер, своя PGlite и свой порт.
//
//   pnpm wt new <ветка> [--name <метка>] [--from <commit-ish>]  создать (ветка от свежего origin/main) и подготовить
//   pnpm wt link                                               внутри worktree: создать или починить ссылки
//   pnpm wt serve [--path <worktree>]                          запустить локальный сервер (PGlite, без входа)
//   pnpm wt stop [--path <worktree>]                           остановить его
//   pnpm wt list                                               все worktree: ветка, PR, изменения, сервер
//   pnpm wt remove [<путь|ветка>] [--force]                    остановить сервер и удалить worktree (после мержа)
//   pnpm wt prune [--older-than 24h] [--dry-run] [--quiet]     удалить worktree давно влитых задач (хук SessionStart)
//
// Правила и процесс — .claude/skills/worktree/SKILL.md. gh — только личный конфиг (~/.config/gh-personal).
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  BRANCH_PATTERN,
  latestPrByBranch,
  normalizeLinks,
  type PullRequestInfo,
  parseDuration,
  parseWorktreeList,
  planPrune,
  type WorktreeEntry,
  worktreeFolderName,
} from "./lib/worktreePlan";

const DEFAULT_LINKS = [".env.local"];
const STALE_MS = 14 * 86_400_000;
const SERVER_WAIT_MS = 120_000;

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryGit(args: string[], cwd: string): string | null {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

function fail(message: string): never {
  console.error(`[wt] ${message}`);
  process.exit(1);
}

// --- где мы ---

function worktrees(cwd = process.cwd()): WorktreeEntry[] {
  return parseWorktreeList(git(["worktree", "list", "--porcelain"], cwd));
}

function mainRoot(): string {
  const main = worktrees().find((w) => w.main);
  if (!main) fail("не нашёл основной checkout (git worktree list пуст)");
  return main.path;
}

/** Корень worktree, в котором запущена команда; null — вне репозитория. */
function currentRoot(): string | null {
  const top = tryGit(["rev-parse", "--show-toplevel"], process.cwd());
  return top ? fs.realpathSync(top) : null;
}

function repoName(root: string): string {
  const url = tryGit(["remote", "get-url", "origin"], root);
  return url ? path.basename(url).replace(/\.git$/, "") : path.basename(root);
}

/** Плоская папка для worktree: родитель основного checkout (переопределяется BD_WORKTREE_ROOT). */
function workspaceRoot(main: string): string {
  return process.env.BD_WORKTREE_ROOT
    ? path.resolve(process.env.BD_WORKTREE_ROOT)
    : path.dirname(main);
}

function resolveTarget(arg: string | undefined): WorktreeEntry {
  const list = worktrees();
  if (!arg) {
    const here = currentRoot();
    const found = list.find((w) => here && fs.realpathSync(w.path) === here);
    if (!found) fail("укажите путь или ветку worktree");
    return found;
  }
  const abs = path.resolve(arg);
  const found =
    list.find((w) => w.path === abs || w.branch === arg) ??
    list.find((w) => path.basename(w.path) === arg);
  if (!found) fail(`нет worktree «${arg}» (pnpm wt list)`);
  return found;
}

// --- связанные файлы ---

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function linkList(main: string) {
  const team = readJson(path.join(main, ".claude", "worktree-links.json"));
  const local = readJson(
    path.join(main, ".claude", "worktree-links.local.json"),
  );
  return normalizeLinks(team ?? DEFAULT_LINKS, local ?? []);
}

/** Создать или починить ссылки и копии в worktree. Идемпотентно; настоящие файлы не трогаются. */
function link(root: string, main: string): void {
  if (fs.realpathSync(root) === fs.realpathSync(main)) {
    console.log("skip    основной checkout — ссылки не нужны");
    return;
  }
  for (const entry of linkList(main)) {
    const source = path.join(main, entry.path);
    const target = path.join(root, entry.path);
    if (!fs.existsSync(source)) {
      console.log(`skip    ${entry.path} — нет в основном checkout`);
      continue;
    }
    const stats = fs.lstatSync(target, { throwIfNoEntry: false });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (entry.mode === "copy") {
      if (stats && !stats.isSymbolicLink()) {
        console.log(`ok      ${entry.path} (копия)`);
        continue;
      }
      if (stats) fs.unlinkSync(target);
      fs.cpSync(source, target, { recursive: true });
      console.log(`${stats ? "recopy " : "copy   "} ${entry.path}`);
      continue;
    }
    const relative = path.relative(path.dirname(target), source);
    if (!stats) {
      fs.symlinkSync(relative, target);
      console.log(`link    ${entry.path}`);
    } else if (!stats.isSymbolicLink()) {
      console.log(`keep    ${entry.path} — настоящий файл, не трогаю`);
    } else if (fs.readlinkSync(target) === relative) {
      console.log(`ok      ${entry.path}`);
    } else {
      fs.unlinkSync(target);
      fs.symlinkSync(relative, target);
      console.log(`relink  ${entry.path}`);
    }
  }
}

// --- локальный сервер ---

interface ServerState {
  pid: number;
  url: string;
  startedAt: string;
  log: string;
}

function stateFile(root: string): string {
  return path.join(
    git(["rev-parse", "--absolute-git-dir"], root),
    "dev-server.json",
  );
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readServer(root: string): ServerState | null {
  const state = readJson(stateFile(root)) as ServerState | undefined;
  return state?.pid && alive(state.pid) ? state : null;
}

async function serve(root: string): Promise<void> {
  const running = readServer(root);
  if (running) {
    console.log(`Сервер уже работает: ${running.url} (pid ${running.pid})`);
    return;
  }
  if (!fs.existsSync(path.join(root, "node_modules")))
    execFileSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], {
      cwd: root,
      stdio: "inherit",
    });
  const log = path.join(path.dirname(stateFile(root)), "dev-server.log");
  const fd = fs.openSync(log, "w");
  // Локальная база PGlite в data/pglite этого worktree и вход выключен: прод (Supabase) не трогаем,
  // Playwright тестировщика заходит без GitHub.
  const child = spawn("pnpm", ["dev"], {
    cwd: root,
    detached: true,
    stdio: ["ignore", fd, fd],
    env: {
      ...process.env,
      DATABASE_URL: "",
      AUTH_SECRET: "",
      PGLITE_DIR: "data/pglite",
    },
  });
  child.unref();
  fs.closeSync(fd);
  const pid = child.pid;
  if (!pid) fail("не удалось запустить pnpm dev");
  const started = Date.now();
  while (Date.now() - started < SERVER_WAIT_MS) {
    await new Promise((r) => setTimeout(r, 500));
    const text = fs.readFileSync(log, "utf8");
    const url = /Local:\s+(http:\/\/localhost:\d+)/.exec(text)?.[1];
    if (url) {
      const state: ServerState = {
        pid,
        url,
        startedAt: new Date().toISOString(),
        log,
      };
      fs.writeFileSync(stateFile(root), `${JSON.stringify(state, null, 2)}\n`);
      console.log(`Сервер: ${url} (PGlite, без входа; журнал — ${log})`);
      return;
    }
    if (!alive(pid)) fail(`pnpm dev завершился, журнал: ${log}`);
  }
  killGroup(pid);
  fail(`сервер не ответил за ${SERVER_WAIT_MS / 1000} с, журнал: ${log}`);
}

/** Синхронная пауза без внешних команд. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function killGroup(pid: number): void {
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    try {
      process.kill(-pid, signal);
    } catch {
      return;
    }
    const until = Date.now() + 5000;
    while (Date.now() < until && alive(pid)) pause(200);
    if (!alive(pid)) return;
  }
}

function stop(root: string, quiet = false): void {
  const state = readServer(root);
  fs.rmSync(stateFile(root), { force: true });
  if (!state) {
    if (!quiet) console.log("Сервер не запущен");
    return;
  }
  killGroup(state.pid);
  if (!quiet) console.log(`Сервер остановлен (${state.url})`);
}

// --- состояние worktree ---

function isDirty(root: string): boolean {
  return git(["status", "--porcelain"], root).length > 0;
}

/**
 * Коммиты ветки, которых нет на GitHub. После мержа ветку на GitHub удаляют (`--delete-branch`), и сравнивать не
 * с чем — тогда база — последний коммит PR (headRefOid): всё, что было в PR, уже на GitHub.
 */
function unpushed(root: string, branch: string, prHead?: string): number {
  const base =
    tryGit(["rev-parse", "--verify", "--quiet", "@{u}"], root) ??
    tryGit(
      ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`],
      root,
    ) ??
    (prHead && tryGit(["cat-file", "-e", `${prHead}^{commit}`], root) !== null
      ? prHead
      : null) ??
    "origin/main";
  return Number(tryGit(["rev-list", "--count", `${base}..HEAD`], root) ?? 0);
}

function pullRequests(main: string): Map<string, PullRequestInfo> | null {
  try {
    const json = execFileSync(
      "gh",
      [
        "pr",
        "list",
        "--state",
        "all",
        "--limit",
        "200",
        "--json",
        "number,headRefName,headRefOid,state,mergedAt,closedAt",
      ],
      {
        cwd: main,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          GH_CONFIG_DIR: path.join(homedir(), ".config", "gh-personal"),
        },
      },
    );
    return latestPrByBranch(JSON.parse(json));
  } catch {
    return null;
  }
}

// --- команды ---

function cmdNew(args: string[], flags: Flags): void {
  const branch = args[0];
  if (!branch || !BRANCH_PATTERN.test(branch))
    fail("ветка вида feat/NNN-slug (feat|fix|chore|docs|test|refactor)");
  const main = mainRoot();
  const dir = path.join(
    workspaceRoot(main),
    worktreeFolderName(repoName(main), branch, flags.name),
  );
  if (fs.existsSync(dir)) fail(`${dir} уже есть (pnpm wt list)`);
  git(["fetch", "--prune", "origin"], main);
  if (tryGit(["show-ref", "--verify", `refs/heads/${branch}`], main) !== null)
    git(["worktree", "add", dir, branch], main);
  else if (
    tryGit(["show-ref", "--verify", `refs/remotes/origin/${branch}`], main) !==
    null
  )
    git(
      ["worktree", "add", "--track", "-b", branch, dir, `origin/${branch}`],
      main,
    );
  // --no-track: иначе upstream станет origin/main, и git status будет сравнивать ветку с main.
  else
    git(
      [
        "worktree",
        "add",
        "--no-track",
        "-b",
        branch,
        dir,
        flags.from ?? "origin/main",
      ],
      main,
    );
  console.log(`worktree ${dir} (ветка ${branch})`);
  link(dir, main);
  execFileSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], {
    cwd: dir,
    stdio: "inherit",
  });
  console.log(
    `\nГотово. Дальше: cd ${dir} — работа; pnpm wt serve — локальный сервер.`,
  );
}

function cmdList(): void {
  const main = mainRoot();
  const prs = pullRequests(main);
  for (const w of worktrees()) {
    const exists = fs.existsSync(w.path);
    const parts = [w.main ? "основной" : (w.branch ?? "detached")];
    if (!exists) parts.push("папки нет — git worktree prune");
    else {
      if (isDirty(w.path)) parts.push("есть изменения");
      if (w.branch && !w.main) {
        const ahead = unpushed(
          w.path,
          w.branch,
          prs?.get(w.branch)?.headRefOid,
        );
        if (ahead) parts.push(`незапушено: ${ahead}`);
      }
      const pr = w.branch ? prs?.get(w.branch) : undefined;
      if (pr) parts.push(`PR #${pr.number} ${pr.state}`);
      const server = readServer(w.path);
      if (server) parts.push(`сервер ${server.url}`);
    }
    console.log(`${w.path}\n    ${parts.join(" · ")}`);
  }
  if (!prs) console.log("(GitHub недоступен — статусы PR не показаны)");
}

function removeWorktree(
  w: WorktreeEntry,
  main: string,
  opts: { force: boolean; merged: boolean },
) {
  if (fs.existsSync(w.path)) stop(w.path, true);
  git(["worktree", "remove", ...(opts.force ? ["--force"] : []), w.path], main);
  if (w.branch && (opts.merged || opts.force))
    tryGit(["branch", "-D", w.branch], main);
  tryGit(["worktree", "prune"], main);
}

function cmdRemove(args: string[], flags: Flags): void {
  const main = mainRoot();
  const w = resolveTarget(args[0]);
  if (w.main) fail("основной checkout не удаляю");
  const pr = w.branch ? pullRequests(main)?.get(w.branch) : undefined;
  if (!flags.force && fs.existsSync(w.path)) {
    if (isDirty(w.path))
      fail(
        `${w.path}: есть незакоммиченные изменения (--force — удалить всё равно)`,
      );
    const ahead = w.branch ? unpushed(w.path, w.branch, pr?.headRefOid) : 0;
    if (ahead)
      fail(
        `${w.path}: незапушенных коммитов ${ahead} (--force — удалить всё равно)`,
      );
  }
  removeWorktree(w, main, {
    force: flags.force,
    merged: pr?.state === "MERGED",
  });
  console.log(
    `Удалён ${w.path}${w.branch && pr?.state !== "MERGED" && !flags.force ? ` (ветка ${w.branch} оставлена — PR не влит)` : ""}`,
  );
}

function cmdPrune(flags: Flags): void {
  const olderThanMs = parseDuration(flags.olderThan ?? "24h");
  if (olderThanMs === null) fail("--older-than: 90m, 24h, 3d");
  const main = mainRoot();
  const prs = pullRequests(main);
  if (!prs) {
    if (!flags.quiet) console.log("[wt] GitHub недоступен — очистка пропущена");
    return;
  }
  const here = currentRoot();
  const removed: string[] = [];
  const attention: string[] = [];
  for (const w of worktrees()) {
    if (w.main) continue;
    if (!fs.existsSync(w.path)) {
      tryGit(["worktree", "prune"], main);
      continue;
    }
    const pr = w.branch ? (prs.get(w.branch) ?? null) : null;
    const decision = planPrune({
      branch: w.branch,
      dirty: isDirty(w.path),
      unpushed: w.branch ? unpushed(w.path, w.branch, pr?.headRefOid) : 0,
      current: here !== null && fs.realpathSync(w.path) === here,
      pr,
      lastCommitAt:
        Number(tryGit(["log", "-1", "--format=%ct"], w.path) ?? 0) * 1000,
      now: Date.now(),
      olderThanMs,
      staleMs: STALE_MS,
    });
    const name = path.basename(w.path);
    if (decision.action === "remove") {
      if (!flags.dryRun)
        removeWorktree(w, main, { force: false, merged: true });
      removed.push(`${name} — ${decision.reason}`);
    } else if (decision.attention) {
      attention.push(`${name} — ${decision.reason}`);
    } else if (!flags.quiet) {
      console.log(`оставлен ${name} — ${decision.reason}`);
    }
  }
  if (removed.length)
    console.log(
      `${flags.dryRun ? "Удалил бы" : "Удалены worktree влитых задач (сервер остановлен)"}:\n${removed.map((s) => `  - ${s}`).join("\n")}`,
    );
  if (attention.length)
    console.log(
      `Worktree требуют решения:\n${attention.map((s) => `  - ${s}`).join("\n")}`,
    );
  if (!flags.quiet && !removed.length && !attention.length)
    console.log("Удалять нечего");
}

interface Flags {
  name?: string;
  from?: string;
  path?: string;
  olderThan?: string;
  force: boolean;
  dryRun: boolean;
  quiet: boolean;
}

function parseArgs(argv: string[]): {
  command: string;
  args: string[];
  flags: Flags;
} {
  const flags: Flags = { force: false, dryRun: false, quiet: false };
  const args: string[] = [];
  const valueFlags: Record<string, keyof Flags> = {
    "--name": "name",
    "--from": "from",
    "--path": "path",
    "--older-than": "olderThan",
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const [key, inline] = a.split("=", 2);
    if (key in valueFlags) {
      const value = inline ?? argv[++i];
      if (!value) fail(`${key}: нужно значение`);
      (flags as unknown as Record<string, string>)[valueFlags[key]] = value;
    } else if (a === "--force") flags.force = true;
    else if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--quiet") flags.quiet = true;
    else if (a.startsWith("--")) fail(`неизвестный флаг ${a}`);
    else args.push(a);
  }
  return { command: argv[0] ?? "", args, flags };
}

async function main(): Promise<void> {
  const { command, args, flags } = parseArgs(process.argv.slice(2));
  const root = () =>
    flags.path ? resolveTarget(flags.path).path : resolveTarget(undefined).path;
  switch (command) {
    case "new":
      return cmdNew(args, flags);
    case "link": {
      const here = currentRoot();
      if (!here) fail("запустите внутри worktree");
      return link(here, mainRoot());
    }
    case "serve":
      return serve(root());
    case "stop":
      return stop(root());
    case "list":
      return cmdList();
    case "remove":
      return cmdRemove(args, flags);
    case "prune":
      return cmdPrune(flags);
    default:
      fail(
        "команды: new, link, serve, stop, list, remove, prune (см. .claude/skills/worktree/SKILL.md)",
      );
  }
}

main().catch((error) =>
  fail(error instanceof Error ? error.message : String(error)),
);
