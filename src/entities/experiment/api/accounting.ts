import { sql } from "drizzle-orm";
import { experimentsTable, paperTradesTable } from "../model/db.ts";

// Учёт paper-капитала с отдельным сбросом эксперимента (решение пользователя 2026-10-11): в эпохе
// считаются только сделки, открытые не раньше experiments.reset_at своего эксперимента.
// Без @/… и node:* — модуль грузит и Edge Function (Deno) через dbStore.

/** Самый ранний момент Date (мс) — «сброса не было», как '-infinity' в Postgres: время в SQLite — целые мс. */
export const MIN_TIME_MS = -8_640_000_000_000_000;

/** Условие WHERE для paper_trades: сделка входит в текущий учёт своего эксперимента. */
export const countedTrade = () =>
  sql`${paperTradesTable.openedAt} >= coalesce((select ${experimentsTable.resetAt} from ${experimentsTable} where ${experimentsTable.id} = ${paperTradesTable.experimentId}), ${MIN_TIME_MS})`;
