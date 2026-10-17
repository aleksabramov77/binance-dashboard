// `pnpm db:import-pg --to <файл> [--force]` — перенос базы из Supabase Postgres в новый файл SQLite (spec 0059).
// Источник — DATABASE_URL из .env.local; читается только чтением: соединение с default_transaction_read_only и одна
// транзакция READ ONLY с REPEATABLE READ — все таблицы и итоги из одного снимка. Цель — новый файл с миграциями
// drizzle/, все строки одной транзакцией. Затем сверка: число строк каждой таблицы и суммы PnL в Postgres и SQLite.
// Пишется во временный `<файл>.part`, переименовывается только после совпадения сверки; расхождение — код выхода 1,
// `.part` остаётся для разбора. Существующий файл без --force не трогаем.
import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import postgres from "postgres";
import { migrateSqlite, openSqlite } from "@/shared/db/client.server";
import {
  CHECK_QUERIES,
  compareChecks,
  IMPORT_TABLES,
  type PgRow,
  parseImportArgs,
  sqliteChecks,
  tableName,
  writeImport,
} from "./lib/pgImport";

function fail(message: string): never {
  console.error(`[db:import-pg] ${message}`);
  process.exit(1);
}

const removeDb = (file: string) => {
  for (const f of [file, `${file}-wal`, `${file}-shm`])
    rmSync(f, { force: true });
};

/** Хост без пользователя и пароля — для вывода. */
function describePg(url: string): string {
  try {
    const u = new URL(url);
    return `Postgres ${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "Postgres (DATABASE_URL)";
  }
}

async function readPostgres(url: string) {
  // prepare: false — пулер Supabase в режиме transaction; default_transaction_read_only — запись невозможна в принципе.
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    connection: { default_transaction_read_only: true },
  });
  try {
    return await sql.begin(
      "isolation level repeatable read read only",
      async (tx) => {
        const data = new Map<(typeof IMPORT_TABLES)[number], PgRow[]>();
        for (const table of IMPORT_TABLES) {
          const rows = await tx.unsafe(`select * from ${tableName(table)}`);
          data.set(table, rows as PgRow[]);
        }
        const checks = new Map<string, number>();
        for (const q of CHECK_QUERIES) {
          const [row] = await tx.unsafe(q.sql);
          checks.set(q.label, Number(row?.v ?? 0));
        }
        const [tables] = await tx.unsafe(
          "select string_agg(table_name, ',' order by table_name) as names from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
        );
        return { data, checks, publicTables: String(tables?.names ?? "") };
      },
    );
  } finally {
    await sql.end();
  }
}

async function main() {
  const parsed = parseImportArgs(process.argv.slice(2));
  if (!parsed.ok) fail(parsed.error);
  const { to, force } = parsed.args;
  const part = `${to}.part`;
  if (existsSync(to) && !force)
    fail(`${to} уже есть — не перезаписываю. Другой путь или --force.`);

  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) fail("DATABASE_URL не задан (.env.local) — читать неоткуда");
  console.log(`Источник: ${describePg(url)} (только чтение)`);
  console.log(`Цель: SQLite ${to}`);

  const started = Date.now();
  const pg = await readPostgres(url);
  const known = new Set(IMPORT_TABLES.map(tableName));
  const extra = pg.publicTables.split(",").filter((t) => t && !known.has(t));
  if (extra.length)
    console.warn(
      `[db:import-pg] в Postgres есть таблицы вне схемы приложения — не переносятся: ${extra.join(", ")}`,
    );

  removeDb(part);
  const conn = openSqlite(part);
  let lines: ReturnType<typeof compareChecks>;
  try {
    migrateSqlite(conn.db);
    writeImport(conn.db, pg.data);
    lines = compareChecks(pg.checks, sqliteChecks(conn.db));
    // WAL — в основной файл: на VM загружается один файл.
    conn.client.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    conn.client.close();
  }

  const width = Math.max(...lines.map((l) => l.label.length));
  for (const l of lines)
    console.log(
      `${l.ok ? "✓" : "✗"} ${l.label.padEnd(width)}  Postgres ${l.postgres}  SQLite ${l.sqlite}`,
    );
  const bad = lines.filter((l) => !l.ok);
  if (bad.length)
    fail(
      `сверка не сошлась (${bad.length}) — файл ${part} оставлен для разбора, ${to} не создан`,
    );

  if (force) removeDb(to);
  renameSync(part, to);
  console.log(
    `Готово за ${((Date.now() - started) / 1000).toFixed(1)} с: ${to}, ${(statSync(to).size / 1024 / 1024).toFixed(1)} МБ. Исходная база не менялась.`,
  );
}

main().catch((error) => {
  console.error(
    "[db:import-pg]",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
