import { count, inArray, isNull } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { demoMirrorOrdersTable, paperTradesTable } from "../model/db";
import type { EngineExposure } from "../model/exposure";
import { ACTIVE_MIRROR_STATUSES } from "../model/mirror";

type Db = BaseSQLiteDatabase<"sync", unknown>;

/**
 * Сколько позиций перестанет проверяться, если выключить движок (spec 0044): открытые paper-сделки
 * и демо-позиции зеркала в активных статусах. Только чтение.
 */
export async function readEngineExposure(db: Db): Promise<EngineExposure> {
  const [[paper], [demo]] = await Promise.all([
    db
      .select({ n: count() })
      .from(paperTradesTable)
      .where(isNull(paperTradesTable.closedAt)),
    db
      .select({ n: count() })
      .from(demoMirrorOrdersTable)
      .where(
        inArray(demoMirrorOrdersTable.status, [...ACTIVE_MIRROR_STATUSES]),
      ),
  ]);
  return { openPaper: paper?.n ?? 0, openDemo: demo?.n ?? 0 };
}
