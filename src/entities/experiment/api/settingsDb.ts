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
  /** Новый стартовый бюджет всех экспериментов; не задан — бюджеты не меняются. */
  initialBudget?: number;
}

type Closes = ResetRunInput["closes"];

/** Закрыть открытые сделки эпохи runId по плану (manual); уже закрытые пропускаются. */
async function applyCloses(
  tx: Db,
  runId: number,
  closes: Closes,
): Promise<{ closed: number; closedWithoutPrice: number }> {
  let closed = 0;
  let closedWithoutPrice = 0;
  for (const { id, close, noPrice } of closes) {
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
          eq(paperTradesTable.runId, runId),
          isNull(paperTradesTable.closedAt),
        ),
      )
      .returning({ id: paperTradesTable.id });
    if (rows.length === 0) continue;
    closed++;
    if (noPrice) closedWithoutPrice++;
  }
  return { closed, closedWithoutPrice };
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

    const { closed, closedWithoutPrice } = await applyCloses(
      tx,
      input.fromRunId,
      input.closes,
    );

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

    if (input.initialBudget !== undefined)
      await tx.update(experimentsTable).set({
        initialBudget: input.initialBudget,
        resetAt: null,
        updatedAt: sql`now()`,
      });

    return { created: true, runId: run.id, closed, closedWithoutPrice };
  });
}

/** Дописать метки свечей в engine_state[barsKey], не трогая метки других экспериментов. */
async function mergeBars(
  tx: Db,
  barsKey: string,
  bars: Record<string, number>,
): Promise<void> {
  if (Object.keys(bars).length === 0) return;
  await tx
    .insert(engineStateTable)
    .values({ key: barsKey, value: bars })
    .onConflictDoUpdate({
      target: engineStateTable.key,
      set: {
        value: sql`${engineStateTable.value} || ${JSON.stringify(bars)}::jsonb`,
        updatedAt: sql`now()`,
      },
    });
}

/**
 * Сброс Paper группы активов — «эра группы» (spec 0038, решение 4): одной транзакцией для всех экспериментов
 * группы, включая выключенные, — закрыть их открытые сделки текущей эпохи по плану (manual), начать учёт заново
 * (reset_at = now) со стартового бюджета initialBudget и пометить их текущие свечи обработанными. Новой эпохи нет,
 * другие группы не меняются. Вызывать под блокировкой тика; closes и bars — только по экспериментам группы.
 */
export async function resetGroupRun(
  db: Db,
  input: {
    runId: number;
    market: string;
    closes: Closes;
    initialBudget: number;
    bars: Record<string, number>;
    barsKey: string;
  },
): Promise<{
  experiments: number;
  closed: number;
  closedWithoutPrice: number;
}> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(experimentsTable)
      .set({
        resetAt: sql`now()`,
        initialBudget: input.initialBudget,
        updatedAt: sql`now()`,
      })
      .where(eq(experimentsTable.market, input.market))
      .returning({ id: experimentsTable.id });
    if (rows.length === 0)
      return { experiments: 0, closed: 0, closedWithoutPrice: 0 };
    const result = await applyCloses(tx, input.runId, input.closes);
    const ids = new Set(rows.map((r) => r.id));
    await mergeBars(
      tx,
      input.barsKey,
      Object.fromEntries(
        Object.entries(input.bars).filter(([id]) => ids.has(id)),
      ),
    );
    return { experiments: rows.length, ...result };
  });
}

/**
 * Отдельный сброс paper-капитала эксперимента (решение пользователя 2026-10-11): закрыть его
 * открытые сделки текущей эпохи (manual), поставить experiments.reset_at = now — учёт эксперимента
 * начинается заново со стартового бюджета — и пометить его текущую свечу обработанной
 * (engine_state.bars[id]). Эпоха и другие эксперименты не меняются. Вызывать под блокировкой тика.
 */
export async function resetExperimentRun(
  db: Db,
  input: {
    runId: number;
    experimentId: string;
    closes: Closes;
    /** Метка последней обработанной свечи эксперимента; нет — не трогаем. */
    bar?: number;
    barsKey: string;
  },
): Promise<{ found: boolean; closed: number; closedWithoutPrice: number }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(experimentsTable)
      .set({ resetAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(experimentsTable.id, input.experimentId))
      .returning({ id: experimentsTable.id });
    if (rows.length === 0)
      return { found: false, closed: 0, closedWithoutPrice: 0 };
    const result = await applyCloses(tx, input.runId, input.closes);
    if (input.bar !== undefined)
      await mergeBars(tx, input.barsKey, { [input.experimentId]: input.bar });
    return { found: true, ...result };
  });
}
