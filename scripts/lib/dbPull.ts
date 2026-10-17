// Чистая часть `pnpm db:pull` (spec 0059): откуда и как скачать снимок прод-базы с VM. Адрес VM, пользователь и
// ключ — из переменных окружения (.env.local), IP в репозитории не пишем.
import path from "node:path";

/** База приложения на VM (DATABASE_PATH в /etc/binance/app.env). */
export const REMOTE_DB_PATH = "/var/lib/binance/app.db";
/** Пользователь сервиса: владелец файла базы. */
export const REMOTE_DB_OWNER = "binance";

export interface DbPullConfig {
  host: string;
  user: string;
  keyFile: string;
}

/**
 * Куда ходить по SSH: APPS_TOKYO_HOST (обязателен), APPS_TOKYO_SSH_USER (по умолчанию claude — администратор VM),
 * APPS_TOKYO_SSH_KEY_FILE (по умолчанию ~/.ssh/lightsail_apps_tokyo).
 */
export function dbPullConfig(
  env: Record<string, string | undefined>,
  home: string,
): { ok: true; config: DbPullConfig } | { ok: false; error: string } {
  const host = env.APPS_TOKYO_HOST?.trim();
  if (!host)
    return {
      ok: false,
      error:
        "APPS_TOKYO_HOST не задан (.env.local, раздел «Своя VM»): адрес VM apps-tokyo — static IP из Lightsail → Networking",
    };
  const key =
    env.APPS_TOKYO_SSH_KEY_FILE?.trim() || "~/.ssh/lightsail_apps_tokyo";
  return {
    ok: true,
    config: {
      host,
      user: env.APPS_TOKYO_SSH_USER?.trim() || "claude",
      keyFile: key.startsWith("~/") ? path.join(home, key.slice(2)) : key,
    },
  };
}

/**
 * Команда на VM: согласованный снимок базы через `sqlite3 .backup` (с WAL, без остановки сервиса) во временный файл
 * пользователя сервиса, вывод файла в stdout и удаление. Пути — без пробелов, кавычки не нужны.
 */
export function remoteBackupCommand(
  dbPath = REMOTE_DB_PATH,
  owner = REMOTE_DB_OWNER,
): string {
  const as = `sudo -u ${owner}`;
  return [
    "set -e",
    `tmp=$(${as} mktemp /tmp/app-db-pull.XXXXXX)`,
    `trap '${as} rm -f "$tmp"' EXIT`,
    `${as} sqlite3 ${dbPath} ".backup '$tmp'"`,
    `${as} cat "$tmp"`,
  ].join("; ");
}

/** Аргументы ssh: только по ключу, без интерактивных вопросов. */
export function sshArgs(config: DbPullConfig, command: string): string[] {
  return [
    "-i",
    config.keyFile,
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=15",
    `${config.user}@${config.host}`,
    command,
  ];
}

/** Аргументы: `--out <файл>` (по умолчанию data/prod.db). */
export function parseDbPullArgs(
  argv: readonly string[],
  defaultOut: string,
): { ok: true; out: string } | { ok: false; error: string } {
  let out = defaultOut;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") {
      const v = argv[++i];
      if (!v) return { ok: false, error: "--out: нужен путь к файлу" };
      out = v;
    } else if (a.startsWith("--out=")) out = a.slice("--out=".length);
    else
      return {
        ok: false,
        error: `неизвестный аргумент ${a} (есть --out <файл>)`,
      };
  }
  return { ok: true, out };
}
