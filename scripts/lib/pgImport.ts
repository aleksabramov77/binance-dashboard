// Чистая часть `pnpm db:import-pg` (spec 0059): перенос 12 таблиц из Supabase Postgres в файл SQLite. Здесь —
// порядок таблиц, приведение типов строк Postgres к колонкам SQLite, запись одной транзакцией и сверка итогов.
// Чтение Postgres и файлы — в scripts/db-import-pg.ts.
import { getTableColumns, getTableName } from "drizzle-orm";
import type { BaseSQLiteDatabase, SQLiteTable } from "drizzle-orm/sqlite-core";
import { earnSnapshotsTable } from "@/entities/earn-offer";
import {
  demoMirrorOrdersTable,
  engineStateTable,
  experimentsTable,
  liveMirrorOrdersTable,
  paperTradesTable,
  runsTable,
  skippedSignalsTable,
} from "@/entities/experiment";
import {
  liveTradingHaltTable,
  liveWorkerStateTable,
} from "@/entities/live-account";
import { alertStateTable, appLogsTable } from "@/entities/log-entry";

type Db = BaseSQLiteDatabase<"sync", unknown>;

/** Все таблицы приложения в порядке, безопасном для внешних ключей (родители раньше детей). */
export const IMPORT_TABLES: readonly SQLiteTable[] = [
  experimentsTable,
  runsTable,
  paperTradesTable,
  skippedSignalsTable,
  engineStateTable,
  demoMirrorOrdersTable,
  liveMirrorOrdersTable,
  earnSnapshotsTable,
  liveWorkerStateTable,
  liveTradingHaltTable,
  appLogsTable,
  alertStateTable,
];

export const tableName = (t: SQLiteTable): string => getTableName(t);

/** Строка Postgres как её отдаёт postgres.js: имена колонок в snake_case. */
export type PgRow = Record<string, unknown>;

type Column = ReturnType<typeof getTableColumns<SQLiteTable>>[string];

function toDate(raw: unknown, where: string): Date {
  const d = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(d.getTime())) throw new Error(`${where}: не дата (${raw})`);
  return d;
}

function toNumber(raw: unknown, where: string, integer: boolean): number {
  // postgres.js отдаёт bigint/bigserial и numeric строкой.
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${where}: не число (${raw})`);
  if (integer && !Number.isSafeInteger(n))
    throw new Error(`${where}: целое вне безопасного диапазона (${raw})`);
  return n;
}

/**
 * Значение Postgres → значение колонки Drizzle SQLite (дальше Drizzle сам переводит Date в мс, boolean в 1/0, объект
 * в JSON-текст). null остаётся null.
 */
export function convertValue(
  column: Column,
  raw: unknown,
  where: string,
): unknown {
  if (raw === null || raw === undefined) return null;
  switch (column.columnType) {
    case "SQLiteTimestamp":
      return toDate(raw, where);
    // Момент в коде строкой (журнал, снимки Earn, alert_state): ISO, в базе — мс.
    case "SQLiteCustomColumn":
      return toDate(raw, where).toISOString();
    case "SQLiteInteger":
      return toNumber(raw, where, true);
    case "SQLiteReal":
      return toNumber(raw, where, false);
    case "SQLiteBoolean":
      if (typeof raw !== "boolean")
        throw new Error(`${where}: не boolean (${raw})`);
      return raw;
    case "SQLiteTextJson":
      // jsonb postgres.js уже разобрал; строка — значит JSON-строка как значение.
      return raw;
    case "SQLiteText":
      return String(raw);
    default:
      throw new Error(`${where}: неизвестный тип колонки ${column.columnType}`);
  }
}

/** Строка Postgres → значения для insert Drizzle (ключи — имена полей таблицы). Колонки нет в Postgres — ошибка. */
export function toSqliteRow(
  table: SQLiteTable,
  row: PgRow,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(getTableColumns(table))) {
    const where = `${tableName(table)}.${column.name}`;
    if (!(column.name in row))
      throw new Error(`${where}: колонки нет в Postgres`);
    out[key] = convertValue(column, row[column.name], where);
  }
  return out;
}

/** SQLite принимает до 32 766 параметров в запросе — вставляем пачками с запасом. */
const MAX_PARAMS = 30_000;

/**
 * Пишет все строки в пустую базу одной синхронной транзакцией: ошибка в любой строке — в базе ничего нет.
 * Счётчики AUTOINCREMENT (runs, earn_snapshots, app_logs) SQLite сам ставит на максимальный вставленный id.
 */
export function writeImport(db: Db, data: Map<SQLiteTable, PgRow[]>): void {
  db.transaction(
    (tx) => {
      for (const table of IMPORT_TABLES) {
        const rows = (data.get(table) ?? []).map((r) => toSqliteRow(table, r));
        const perBatch = Math.max(
          1,
          Math.floor(MAX_PARAMS / Object.keys(getTableColumns(table)).length),
        );
        for (let i = 0; i < rows.length; i += perBatch)
          tx.insert(table)
            .values(rows.slice(i, i + perBatch))
            .run();
      }
    },
    { behavior: "immediate" },
  );
}

/** Итоги для сверки: число строк каждой таблицы и суммы денег. Тот же SQL в Postgres и SQLite. */
export const CHECK_QUERIES: { label: string; sql: string }[] = [
  ...IMPORT_TABLES.map((t) => ({
    label: `${tableName(t)}: строк`,
    sql: `select count(*) as v from ${tableName(t)}`,
  })),
  {
    label: "paper_trades: сумма pnl",
    sql: "select coalesce(sum(pnl), 0) as v from paper_trades",
  },
  {
    label: "paper_trades: сумма fees",
    sql: "select coalesce(sum(fees), 0) as v from paper_trades",
  },
  {
    // В demo_mirror_orders нет столбца PnL: PnL демо считается по ценам входа и выхода — сверяем его же.
    label: "demo_mirror_orders: PnL по ценам (выход − вход) × объём",
    sql: "select coalesce(sum((case when direction = 'short' then -1 else 1 end) * (exit_price - entry_price) * quantity), 0) as v from demo_mirror_orders where exit_price is not null and entry_price is not null and quantity is not null",
  },
  {
    label: "demo_mirror_orders: объём входа, $",
    sql: "select coalesce(sum(entry_price * quantity), 0) as v from demo_mirror_orders where entry_price is not null and quantity is not null",
  },
  {
    label: "live_mirror_orders: сумма realized_pnl",
    sql: "select coalesce(sum(realized_pnl), 0) as v from live_mirror_orders",
  },
];

export interface CheckLine {
  label: string;
  postgres: number;
  sqlite: number;
  ok: boolean;
}

/** Совпадают ли итоги: счётчики — точно, суммы — с точностью до порядка сложения чисел с плавающей точкой. */
export function compareChecks(
  postgres: Map<string, number>,
  sqlite: Map<string, number>,
): CheckLine[] {
  return CHECK_QUERIES.map(({ label }) => {
    const a = postgres.get(label) ?? Number.NaN;
    const b = sqlite.get(label) ?? Number.NaN;
    const ok = Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
    return { label, postgres: a, sqlite: b, ok };
  });
}

/** Итоги из SQLite (тем же SQL, что в Postgres). */
export function sqliteChecks(db: Db): Map<string, number> {
  return new Map(
    CHECK_QUERIES.map(({ label, sql }) => [label, readValue(db, sql)]),
  );
}

function readValue(db: Db, query: string): number {
  const row = db.get<{ v: number | null }>(query);
  return Number(row?.v ?? 0);
}

export interface ImportArgs {
  to: string;
  force: boolean;
}

/** Аргументы: `--to <файл>` (обязателен), `--force` — перезаписать существующий файл. */
export function parseImportArgs(
  argv: readonly string[],
): { ok: true; args: ImportArgs } | { ok: false; error: string } {
  let to: string | undefined;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") force = true;
    else if (a === "--to") to = argv[++i];
    else if (a.startsWith("--to=")) to = a.slice("--to=".length);
    else
      return {
        ok: false,
        error: `неизвестный аргумент ${a} (есть --to <файл>, --force)`,
      };
  }
  if (!to)
    return {
      ok: false,
      error: "нужен --to <файл SQLite>, например --to data/import.db",
    };
  return { ok: true, args: { to, force } };
}
