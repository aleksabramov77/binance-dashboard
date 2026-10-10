import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { type DatabaseConfig, getDatabaseConfig } from "../config/env.server";
import { log } from "../lib/logger.server";
// Доменно-нейтральный слой: подключение и миграции. Таблицы живут в слайсах своих доменов
// (src/entities/*/model/db.ts) и передаются в запросы явно — db.select().from(table).

/** Общий тип для Postgres и PGlite: запросы Drizzle одинаковые. */
export type Db = PgDatabase<PgQueryResultHKT>;

interface Connection {
  db: Db;
  kind: DatabaseConfig["kind"];
  migrate: () => Promise<void>;
  close: () => Promise<void>;
}

const MIGRATIONS = { migrationsFolder: path.join(process.cwd(), "drizzle") };

function connect(config: DatabaseConfig): Connection {
  if (config.kind === "postgres") {
    // prepare: false — пулер Supabase в режиме transaction не держит prepared statements.
    const client = postgres(config.url, { max: 5, prepare: false });
    const db = drizzlePostgres(client);
    return {
      db: db as unknown as Db,
      kind: "postgres",
      migrate: () => migratePostgres(db, MIGRATIONS),
      close: () => client.end(),
    };
  }
  // PGlite создаёт только последний каталог пути — родительские (data/) готовим сами.
  mkdirSync(config.dir, { recursive: true });
  return pgliteConnection(new PGlite(config.dir));
}

function pgliteConnection(client: PGlite): Connection {
  const db = drizzlePglite(client);
  return {
    db: db as unknown as Db,
    kind: "pglite",
    migrate: () => migratePglite(db, MIGRATIONS),
    close: () => client.close(),
  };
}

// Одно подключение на процесс: в dev instrumentation и роуты — разные бандлы, поэтому в globalThis.
const key = Symbol.for("binance-dashboard.db");
type GlobalWithDb = typeof globalThis & { [key]?: Connection };
const g = globalThis as GlobalWithDb;

function connection(): Connection {
  g[key] ??= connect(getDatabaseConfig());
  return g[key];
}

/** БД приложения: Postgres по DATABASE_URL или локальный PGlite. */
export const getDb = (): Db => connection().db;

/** Применяет миграции из `drizzle/`. Вызывается при старте сервера и `pnpm db:migrate`. */
export async function migrateDb(): Promise<void> {
  const conn = connection();
  const started = Date.now();
  await conn.migrate();
  log.info("db.migrate", `Миграции применены (${conn.kind})`, {
    kind: conn.kind,
    ms: Date.now() - started,
  });
}

/** Закрывает подключение (скрипты, завершение процесса). */
export async function closeDb(): Promise<void> {
  const conn = g[key];
  g[key] = undefined;
  await conn?.close();
}

/** Чистая БД в памяти с применёнными миграциями — для тестов. */
export async function createMemoryDb(): Promise<{
  db: Db;
  close: () => Promise<void>;
}> {
  const conn = pgliteConnection(new PGlite());
  await conn.migrate();
  return { db: conn.db, close: conn.close };
}
