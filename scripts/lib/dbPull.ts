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

/** Каталог ночных копий базы на VM (spec 0062). */
export const REMOTE_BACKUP_DIR = "/var/lib/binance/backups";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Команда на VM: ночная копия базы (spec 0062) распакованной в stdout — за дату или последняя. Имя выбранной копии —
 * в stderr. Каталог копий закрыт (700) — всё от пользователя сервиса.
 */
export function remoteBackupFetchCommand(
  date: string | null,
  dir = REMOTE_BACKUP_DIR,
  owner = REMOTE_DB_OWNER,
): string {
  if (date !== null && !DATE_RE.test(date))
    throw new Error(`дата копии — ГГГГ-ММ-ДД: ${date}`);
  const pick =
    date === null
      ? `f=$(sudo -u ${owner} find ${dir} -maxdepth 1 -name 'app-????-??-??.db.gz' | sort | tail -1)`
      : `f=${dir}/app-${date}.db.gz`;
  return [
    "set -e",
    pick,
    `[ -n "$f" ] && sudo -u ${owner} test -f "$f" || { echo "нет ночной копии \${f:-в ${dir}}" >&2; exit 3; }`,
    `echo "копия: $f" >&2`,
    `sudo -u ${owner} gunzip -c "$f"`,
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

export type DbPullArgs = {
  out: string;
  /** null — снимок живой базы; "latest" — последняя ночная копия; ГГГГ-ММ-ДД — копия этого дня. */
  backup: null | "latest" | string;
};

/**
 * Аргументы: `--out <файл>` (по умолчанию data/prod.db, с --backup — data/backup-<дата|latest>.db) и
 * `--backup [ГГГГ-ММ-ДД]` — ночная копия вместо снимка живой базы (spec 0062).
 */
export function parseDbPullArgs(
  argv: readonly string[],
  defaultOut: string,
): ({ ok: true } & DbPullArgs) | { ok: false; error: string } {
  let out: string | null = null;
  let backup: DbPullArgs["backup"] = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") {
      const v = argv[++i];
      if (!v) return { ok: false, error: "--out: нужен путь к файлу" };
      out = v;
    } else if (a.startsWith("--out=")) out = a.slice("--out=".length);
    else if (a === "--backup") {
      const v = argv[i + 1];
      if (v !== undefined && DATE_RE.test(v)) {
        backup = v;
        i++;
      } else backup = "latest";
    } else if (a.startsWith("--backup=")) {
      const v = a.slice("--backup=".length);
      if (!DATE_RE.test(v))
        return { ok: false, error: `--backup: дата ГГГГ-ММ-ДД, получено ${v}` };
      backup = v;
    } else
      return {
        ok: false,
        error: `неизвестный аргумент ${a} (есть --out <файл>, --backup [ГГГГ-ММ-ДД])`,
      };
  }
  const resolvedOut =
    out ??
    (backup === null
      ? defaultOut
      : path.join(path.dirname(defaultOut), `backup-${backup}.db`));
  return { ok: true, out: resolvedOut, backup };
}
