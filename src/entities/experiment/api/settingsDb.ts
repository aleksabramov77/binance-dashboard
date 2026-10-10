import type { PaperTrade } from "@binance-dashboard/trading-core";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import {
  engineStateTable,
  experimentsTable,
  paperTradesTable,
  runsTable,
} from "../model/db";
import type { Epoch } from "../model/settings";

// Запросы /settings лаборатории (spec 003, задача 3d): эпоха, тумблеры экспериментов, атомарный
// сброс. Без @/… и node:* — как dbStore. Чистую часть сброса (цены, PnL, метки свечей) считает
// движок (features/paper-engine → planReset), сюда приходит готовый план.

type Db = PgDatabase<PgQueryResultHKT>;

/** Сводка эпохи: номер, начало, сколько сделок (всего и открытых). */
export async function getEpoch(db: Db, runId: number): Promise<Epoch> {
  const [run] = await db
    .select()
    .from(runsTable)
    .where(eq(runsTable.id, runId));
  if (!run) throw new Error(`Эпоха ${runId} не найдена`);
  const [all] = await db
    .select({ n: count() })
    .from(paperTradesTable)
    .where(eq(paperTradesTable.runId, runId));
  const [open] = await db
    .select({ n: count() })
    .from(paperTradesTable)
    .where(
      and(eq(paperTradesTable.runId, runId), isNull(paperTradesTable.closedAt)),
    );
  return {
    id: run.id,
    startedAt: run.startedAt.toISOString(),
    note: run.note,
    trades: all?.n ?? 0,
    openTrades: open?.n ?? 0,
  };
}

/** Вкл/выкл эксперимента. false — неизвестный id. */
export async function setExperimentEnabled(
  db: Db,
  id: string,
  enabled: boolean,
): Promise<boolean> {
  const rows = await db
    .update(experimentsTable)
    .set({ enabled, updatedAt: sql`now()` })
    .where(eq(experimentsTable.id, id))
    .returning({ id: experimentsTable.id });
  return rows.length > 0;
}

export interface ResetRunInput {
  /** Эпоха, которую сбрасываем; уже не текущая — ничего не делаем (идемпотентность). */
  fromRunId: number;
  note?: string;
  /** Закрытия открытых сделок эпохи fromRunId (exit_reason manual). */
  closes: {
    id: string;
    close: Pick<
      PaperTrade,
      "exitPrice" | "exitReason" | "fees" | "pnl" | "rMultiple"
    > & { closedAt: string };
    noPrice: boolean;
  }[];
  /** Ключи engine_state, которые записать вместе с новой эпохой (метки свечей). */
  state: Record<string, unknown>;
  /** Новый бюджет рынка: делится поровну между экспериментами рынка; не задан — бюджеты не меняются. */
  marketBudget?: number;
}

export type ResetRunOutcome =
  | { created: false; runId: number }
  | {
      created: true;
      runId: number;
      closed: number;
      closedWithoutPrice: number;
    };

/**
 * Сброс тестовых капиталов одной транзакцией: закрыть открытые сделки эпохи, начать новую эпоху,
 * записать метки свечей и бюджет. Старые сделки остаются со своим run_id. Строка текущей эпохи
 * блокируется (FOR UPDATE) — параллельный сброс ждёт и видит, что эпоха уже сменилась.
 */
export async function resetRun(
  db: Db,
  input: ResetRunInput,
): Promise<ResetRunOutcome> {
  return db.transaction(async (tx) => {
    const [last] = await tx
      .select({ id: runsTable.id })
      .from(runsTable)
      .orderBy(desc(runsTable.id))
      .limit(1)
      .for("update");
    if (!last || last.id !== input.fromRunId)
      return { created: false, runId: last?.id ?? 0 };

    let closed = 0;
    let closedWithoutPrice = 0;
    for (const { id, close, noPrice } of input.closes) {
      const rows = await tx
        .update(paperTradesTable)
        .set({
          ...close,
          closedAt: new Date(close.closedAt),
          ...(noPrice
            ? {
                signal: sql`${paperTradesTable.signal} || '{"resetWithoutPrice": true}'::jsonb`,
              }
            : {}),
        })
        .where(
          and(
            eq(paperTradesTable.id, id),
            eq(paperTradesTable.runId, input.fromRunId),
            isNull(paperTradesTable.closedAt),
          ),
        )
        .returning({ id: paperTradesTable.id });
      if (rows.length === 0) continue;
      closed++;
      if (noPrice) closedWithoutPrice++;
    }

    const [run] = await tx
      .insert(runsTable)
      .values({ note: input.note?.trim() || "Сброс тестовых капиталов" })
      .returning({ id: runsTable.id });

    for (const [key, value] of Object.entries(input.state))
      await tx
        .insert(engineStateTable)
        .values({ key, value })
        .onConflictDoUpdate({
          target: engineStateTable.key,
          set: { value, updatedAt: sql`now()` },
        });

    if (input.marketBudget !== undefined) {
      const markets = await tx
        .select({ market: experimentsTable.market, n: count() })
        .from(experimentsTable)
        .groupBy(experimentsTable.market);
      for (const { market, n } of markets)
        await tx
          .update(experimentsTable)
          .set({ initialBudget: input.marketBudget / n, updatedAt: sql`now()` })
          .where(eq(experimentsTable.market, market));
    }

    return { created: true, runId: run.id, closed, closedWithoutPrice };
  });
}
