// Типы колонок SQLite без подключения к базе (spec 0059): их импортируют схемы таблиц в src/entities/*/model/db.ts.
import { customType } from "drizzle-orm/sqlite-core";

/**
 * Момент как ISO-строка в коде и целое число миллисекунд UTC в SQLite: сортировка и сравнения — числом. Для таблиц,
 * где время в коде строкой (журнал, снимки Earn, alert_state); остальные — `integer(..., { mode: "timestamp_ms" })`.
 */
export const isoTimestamp = customType<{ data: string; driverData: number }>({
  dataType: () => "integer",
  toDriver: (iso) => {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) throw new Error(`не дата: ${iso}`);
    return ms;
  },
  fromDriver: (ms) => new Date(ms).toISOString(),
});
