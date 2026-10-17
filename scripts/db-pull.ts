// `pnpm db:pull [--out <файл>] [--backup [ГГГГ-ММ-ДД]]` — свежий снимок прод-базы с VM в data/prod.db (spec 0059); с
// --backup — ночная копия (spec 0062, по умолчанию последняя) в data/backup-<дата|latest>.db. Снимок: по SSH на VM
// `sqlite3 .backup` (согласованная копия с WAL, сервис не останавливается) → stdout → локальный файл. Проверка
// целостности (`quick_check`) до замены прежнего снимка. Только чтение прода. Адрес VM и ключ — .env.local
// (APPS_TOKYO_HOST, APPS_TOKYO_SSH_USER, APPS_TOKYO_SSH_KEY_FILE). Вход для `pnpm lab:report --prod`.
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  dbPullConfig,
  parseDbPullArgs,
  remoteBackupCommand,
  remoteBackupFetchCommand,
  sshArgs,
} from "./lib/dbPull";
import { installSnapshot } from "./lib/dbSnapshot";
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
  const command =
    args.backup === null
      ? remoteBackupCommand()
      : remoteBackupFetchCommand(args.backup === "latest" ? null : args.backup);
  const ssh = spawnSync("ssh", sshArgs(cfg.config, command), {
    stdio: ["ignore", fd, "inherit"],
  });
  closeSync(fd);
  if (ssh.error || ssh.status !== 0) {
    rmSync(part, { force: true });
    fail(
      `ssh не удался (${ssh.error?.message ?? `код ${ssh.status}`}) — ${args.backup === null ? "снимок" : "ночная копия"} не скачан${args.backup === null ? "" : "а"}, прежний ${out} не тронут`,
    );
  }

  let experiments: number;
  try {
    ({ experiments } = installSnapshot(part, out));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  console.log(
    `${args.backup === null ? "Снимок прод-базы" : "Ночная копия базы"}: ${out}, ${(statSync(out).size / 1024 / 1024).toFixed(1)} МБ, экспериментов ${experiments}, за ${((Date.now() - started) / 1000).toFixed(1)} с`,
  );
}

main();
