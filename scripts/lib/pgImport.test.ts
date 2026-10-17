import { getTableColumns } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { earnSnapshotsTable } from "@/entities/earn-offer";
import {
  demoMirrorOrdersTable,
  experimentsTable,
  paperTradesTable,
  runsTable,
} from "@/entities/experiment";
import { appLogsTable } from "@/entities/log-entry";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import {
  CHECK_QUERIES,
  compareChecks,
  IMPORT_TABLES,
  type PgRow,
  parseImportArgs,
  sqliteChecks,
  tableName,
  toSqliteRow,
  writeImport,
} from "./pgImport";

// Перенос Postgres → SQLite (spec 0059): строки — как их отдаёт postgres.js (snake_case, Date, bigint строкой,
// jsonb объектом), база — SQLite в памяти с миграциями drizzle/.
let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createMemoryDb());
});
afterEach(() => close());

/** Строка Postgres по колонкам таблицы: всё null, кроме заданного. */
const pgRow = (table: SQLiteTable, values: PgRow): PgRow => ({
  ...Object.fromEntries(
    Object.values(getTableColumns(table)).map((c) => [c.name, null]),
  ),
  ...values,
});

const OPENED = new Date("2026-10-10T01:02:03.456Z");

const experiment = pgRow(experimentsTable, {
  id: "S99",
  market: "spot",
  name: "Тест",
  hypothesis: "h",
  config: { timeframe: "1h", nested: { a: [1, 2] } },
  initial_budget: 1000,
  enabled: true,
  demo_mirror: false,
  demo_mirror_mode: "auto",
  live_mirror: false,
  live_mirror_mode: "off",
  live_loss_limit_usd: 15,
  live_loss_streak: 5,
  reset_at: null,
  created_at: OPENED,
  updated_at: OPENED,
});

const trade = (id: string, pnl: number | null) =>
  pgRow(paperTradesTable, {
    id,
    run_id: 7,
    experiment_id: "S99",
    market: "spot",
    symbol: "BTCUSDT",
    direction: "long",
    opened_at: OPENED,
    entry_price: 100,
    quantity: 2,
    atr: 1,
    extreme: 101,
    // bigint postgres.js отдаёт строкой.
    checked_until: "1792180187433",
    fees: 0.5,
    pnl,
    signal: { reason: "x" },
    entry_context: {},
  });

function sample(): Map<SQLiteTable, PgRow[]> {
  return new Map<SQLiteTable, PgRow[]>([
    [experimentsTable, [experiment]],
    [
      runsTable,
      [pgRow(runsTable, { id: 7, started_at: OPENED, note: "эпоха" })],
    ],
    [
      paperTradesTable,
      [trade("t1", 12.5), trade("t2", -2.25), trade("t3", null)],
    ],
    [
      demoMirrorOrdersTable,
      [
        pgRow(demoMirrorOrdersTable, {
          trade_id: "t1",
          experiment_id: "S99",
          market: "spot",
          symbol: "BTCUSDT",
          direction: "short",
          status: "closed",
          entry_price: 100,
          quantity: 2,
          exit_price: 90,
          message: "",
          steps: [{ step: 1 }],
          created_at: OPENED,
          updated_at: OPENED,
        }),
      ],
    ],
    [
      earnSnapshotsTable,
      [pgRow(earnSnapshotsTable, { id: 3, fetched_at: OPENED, offers: [] })],
    ],
    [
      appLogsTable,
      [
        pgRow(appLogsTable, {
          id: "41",
          ts: OPENED,
          level: "info",
          event: "e",
          message: "m",
          data: { path: "/x" },
          source: "vm",
        }),
      ],
    ],
  ]);
}

describe("writeImport", () => {
  it("типы Postgres → SQLite: даты, bigint строкой, jsonb, boolean; чтение возвращает те же значения", async () => {
    writeImport(db, sample());
    const [e] = await db.select().from(experimentsTable);
    expect(e?.config).toEqual({ timeframe: "1h", nested: { a: [1, 2] } });
    expect(e?.enabled).toBe(true);
    expect(e?.createdAt.toISOString()).toBe(OPENED.toISOString());
    const trades = await db.select().from(paperTradesTable);
    expect(trades.map((t) => t.checkedUntil)).toEqual([
      1792180187433, 1792180187433, 1792180187433,
    ]);
    expect(trades[0]?.openedAt.getTime()).toBe(OPENED.getTime());
    const [log] = await db.select().from(appLogsTable);
    expect(log).toMatchObject({
      id: 41,
      ts: OPENED.toISOString(),
      data: { path: "/x" },
    });
    const [snap] = await db.select().from(earnSnapshotsTable);
    expect(snap?.fetchedAt).toBe(OPENED.toISOString());
  });

  it("счётчики id продолжаются после максимального перенесённого", async () => {
    writeImport(db, sample());
    const [run] = await db
      .insert(runsTable)
      .values({ note: "после переноса" })
      .returning({ id: runsTable.id });
    expect(run?.id).toBe(8);
    const [log] = await db
      .insert(appLogsTable)
      .values({
        ts: OPENED.toISOString(),
        level: "info",
        event: "e",
        message: "m",
        source: "vm",
      })
      .returning({ id: appLogsTable.id });
    expect(log?.id).toBe(42);
  });

  it("ошибка в любой строке — в базе ничего нет (одна транзакция)", async () => {
    const data = sample();
    data.set(paperTradesTable, [
      trade("t1", 1),
      { ...trade("t2", 1), opened_at: "не дата" },
    ]);
    expect(() => writeImport(db, data)).toThrow(
      /paper_trades.opened_at: не дата/,
    );
    expect(await db.select().from(experimentsTable)).toHaveLength(0);
    expect(await db.select().from(runsTable)).toHaveLength(0);
  });

  it("сделка без родителя — ошибка внешнего ключа, ничего не записано", async () => {
    const data = sample();
    data.set(runsTable, []);
    expect(() => writeImport(db, data)).toThrow(/FOREIGN KEY/);
    expect(await db.select().from(experimentsTable)).toHaveLength(0);
  });
});

describe("сверка", () => {
  it("итоги SQLite совпадают с итогами исходных строк", () => {
    writeImport(db, sample());
    const sqlite = sqliteChecks(db);
    expect(sqlite.get("paper_trades: строк")).toBe(3);
    expect(sqlite.get("paper_trades: сумма pnl")).toBe(10.25);
    // short: (90 − 100) × 2 × −1 = 20.
    expect(
      sqlite.get("demo_mirror_orders: PnL по ценам (выход − вход) × объём"),
    ).toBe(20);
    expect(sqlite.get("app_logs: строк")).toBe(1);
    const lines = compareChecks(new Map(sqlite), sqlite);
    expect(lines.every((l) => l.ok)).toBe(true);
  });

  it("расхождение строк или сумм — строка с ok = false", () => {
    const a = new Map(CHECK_QUERIES.map((q) => [q.label, 1]));
    const b = new Map(a);
    b.set("paper_trades: строк", 2);
    b.set("paper_trades: сумма pnl", 1 + 1e-12);
    const bad = compareChecks(a, b).filter((l) => !l.ok);
    expect(bad.map((l) => l.label)).toEqual(["paper_trades: строк"]);
  });

  it("сверка охватывает все 12 таблиц", () => {
    expect(IMPORT_TABLES).toHaveLength(12);
    for (const t of IMPORT_TABLES)
      expect(
        CHECK_QUERIES.some((q) => q.label === `${tableName(t)}: строк`),
      ).toBe(true);
  });
});

describe("toSqliteRow", () => {
  it("колонки нет в Postgres — понятная ошибка", () => {
    const { reset_at: _, ...row } = experiment;
    expect(() => toSqliteRow(experimentsTable, row)).toThrow(
      "experiments.reset_at: колонки нет в Postgres",
    );
  });
});

describe("parseImportArgs", () => {
  it("--to обязателен, --force — по желанию", () => {
    expect(parseImportArgs(["--to", "data/import.db"])).toEqual({
      ok: true,
      args: { to: "data/import.db", force: false },
    });
    expect(parseImportArgs(["--to=x.db", "--force"])).toEqual({
      ok: true,
      args: { to: "x.db", force: true },
    });
    expect(parseImportArgs([]).ok).toBe(false);
    expect(parseImportArgs(["--to"]).ok).toBe(false);
    expect(parseImportArgs(["--to", "x.db", "--prod"]).ok).toBe(false);
  });
});
