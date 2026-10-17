import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  type BetterSQLite3Database,
  drizzle,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { type DatabaseConfig, getDatabaseConfig } from "../config/env.server";
import { log } from "../lib/logger.server";
// Доменно-нейтральный слой: подключение и миграции. Таблицы живут в слайсах своих доменов
// (src/entities/*/model/db.ts) и передаются в запросы явно — db.select().from(table).
// База — файл SQLite (spec 0059): на VM /var/lib/binance/app.db, локально data/app.db, в тестах — в памяти.

/** БД приложения: SQLite через better-sqlite3 (запросы синхронные, транзакции — тоже). */
export type Db = BetterSQLite3Database;

interface Connection {
  db: Db;
  client: Database.Database;
  path: string;
}

const MIGRATIONS = { migrationsFolder: path.join(process.cwd(), "drizzle") };

/** Сколько ждать чужую блокировку записи (другой процесс: `pnpm lab:*`, `sqlite3 .backup`), мс. */
const BUSY_TIMEOUT_MS = 5000;

export const MEMORY_PATH = ":memory:";

/** Открывает файл (или базу в памяти) с настройками приложения: WAL, ожидание блокировки, внешние ключи. */
export function openSqlite(file: string): Connection {
  if (file !== MEMORY_PATH)
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const client = new Database(file);
  // WAL: читатели не ждут писателя, `.backup` и копия с VM — без остановки сервиса. В памяти WAL не бывает.
  if (file !== MEMORY_PATH) client.pragma("journal_mode = WAL");
  // FULL: каждая транзакция на диске до ответа — сбой питания не теряет закрытия и записи реального счёта; база
  // маленькая, цена незаметна.
  client.pragma("synchronous = FULL");
  client.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  client.pragma("foreign_keys = ON");
  return { db: drizzle(client), client, path: file };
}

// Одно подключение на процесс: в dev instrumentation и роуты — разные бандлы, поэтому в globalThis.
const key = Symbol.for("binance-dashboard.db");
type GlobalWithDb = typeof globalThis & { [key]?: Connection };
const g = globalThis as GlobalWithDb;

function connection(config: DatabaseConfig = getDatabaseConfig()): Connection {
  g[key] ??= openSqlite(config.path);
  return g[key];
}

/** БД приложения: файл SQLite из DATABASE_PATH (по умолчанию data/app.db). */
export const getDb = (): Db => connection().db;

/** Путь к файлу базы этого процесса (`:memory:` — в памяти) — для замера места и скриптов. */
export const getDbPath = (): string => connection().path;

/** Применяет миграции из `drizzle/`. Вызывается при старте сервера и `pnpm db:migrate`. */
export async function migrateDb(): Promise<void> {
  const conn = connection();
  const started = Date.now();
  migrate(conn.db, MIGRATIONS);
  log.info("db.migrate", "Миграции применены (sqlite)", {
    kind: "sqlite",
    ms: Date.now() - started,
  });
}

/** Закрывает подключение (скрипты, завершение процесса). */
export async function closeDb(): Promise<void> {
  const conn = g[key];
  g[key] = undefined;
  conn?.client.close();
}

/** Применяет миграции к уже открытой базе (скрипт переноса, тесты). */
export const migrateSqlite = (db: Db): void => migrate(db, MIGRATIONS);

/** Чистая БД в памяти с применёнными миграциями — для тестов. */
export async function createMemoryDb(): Promise<{
  db: Db;
  close: () => Promise<void>;
}> {
  const conn = openSqlite(MEMORY_PATH);
  migrate(conn.db, MIGRATIONS);
  return {
    db: conn.db,
    close: async () => {
      conn.client.close();
    },
  };
}
