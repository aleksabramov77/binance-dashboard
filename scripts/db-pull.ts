// `pnpm db:pull [--out <файл>]` — свежий снимок прод-базы с VM в data/prod.db (spec 0059): по SSH на VM
// `sqlite3 .backup` (согласованная копия с WAL, сервис не останавливается) → stdout → локальный файл. Проверка
// целостности (`quick_check`) до замены прежнего снимка. Только чтение прода. Адрес VM и ключ — .env.local
// (APPS_TOKYO_HOST, APPS_TOKYO_SSH_USER, APPS_TOKYO_SSH_KEY_FILE). Вход для `pnpm lab:report --prod`.
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  dbPullConfig,
  parseDbPullArgs,
  remoteBackupCommand,
  sshArgs,
} from "./lib/dbPull";
import { PROD_SNAPSHOT_PATH } from "./lib/dbTarget";

function fail(message: string): never {
  console.error(`[db:pull] ${message}`);
  process.exit(1);
}

function main() {
  const args = parseDbPullArgs(process.argv.slice(2), PROD_SNAPSHOT_PATH);
  if (!args.ok) fail(args.error);
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const cfg = dbPullConfig(process.env, homedir());
  if (!cfg.ok) fail(cfg.error);

  const out = args.out;
  const part = `${out}.part`;
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const fd = openSync(part, "w");
  const started = Date.now();
  const ssh = spawnSync("ssh", sshArgs(cfg.config, remoteBackupCommand()), {
    stdio: ["ignore", fd, "inherit"],
  });
  closeSync(fd);
  if (ssh.error || ssh.status !== 0) {
    rmSync(part, { force: true });
    fail(
      `ssh не удался (${ssh.error?.message ?? `код ${ssh.status}`}) — снимок не скачан, прежний ${out} не тронут`,
    );
  }

  const check = new Database(part, { readonly: true });
  let ok: unknown;
  let experiments: unknown;
  try {
    ok = check.pragma("quick_check", { simple: true });
    experiments = check.prepare("select count(*) as n from experiments").get();
  } finally {
    check.close();
  }
  if (ok !== "ok") {
    rmSync(part, { force: true });
    fail(
      `снимок повреждён (quick_check: ${String(ok)}) — прежний ${out} не тронут`,
    );
  }
  for (const f of [out, `${out}-wal`, `${out}-shm`]) rmSync(f, { force: true });
  renameSync(part, out);
  const n = (experiments as { n?: number } | undefined)?.n ?? 0;
  console.log(
    `Снимок прод-базы: ${out}, ${(statSync(out).size / 1024 / 1024).toFixed(1)} МБ, экспериментов ${n}, за ${((Date.now() - started) / 1000).toFixed(1)} с`,
  );
}

main();
