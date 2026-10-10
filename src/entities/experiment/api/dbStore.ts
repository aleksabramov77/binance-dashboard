import {
  type Experiment,
  experimentSchema,
  type PaperTrade,
  paperTradeSchema,
} from "@binance-dashboard/trading-core";
import { and, asc, desc, eq, isNotNull, isNull, sql, sum } from "drizzle-orm";
import {
  engineStateTable,
  experimentsTable,
  type PaperTradeRow,
  paperTradesTable,
  runsTable,
} from "../model/db.ts";
import type { ExperimentDb } from "./tickLock.ts";

// Хранилище лаборатории на Drizzle. Структурно совпадает с ExperimentStore движка
// (features/paper-engine): сущность фичу не импортирует, сверку типов делает композиция
// (src/app/server). Без @/… и node:* — тот же код подойдёт Edge Function Supabase (Deno).

type Db = ExperimentDb;

const toTrade = (r: PaperTradeRow): PaperTrade =>
  paperTradeSchema.parse({
    ...r,
    openedAt: r.openedAt.toISOString(),
    closedAt: r.closedAt?.toISOString() ?? null,
  });

const toDate = (iso: string | null) => (iso === null ? null : new Date(iso));

/** Текущая эпоха — runs с наибольшим id; нет ни одной — создаёт первую. */
export async function ensureRun(db: Db): Promise<number> {
  const [last] = await db
    .select({ id: runsTable.id })
    .from(runsTable)
    .orderBy(desc(runsTable.id))
    .limit(1);
  if (last) return last.id;
  const [created] = await db
    .insert(runsTable)
    .values({ note: "Первая эпоха" })
    .returning({ id: runsTable.id });
  return created.id;
}

/**
 * Сид каталога: upsert по id. Обновляет описание и конфиг из кода; включённость, demo-зеркало и
 * стартовый бюджет — настройки пользователя — пишутся только при первой вставке.
 */
export async function seedExperiments(
  db: Db,
  catalog: Experiment[],
): Promise<void> {
  for (const e of catalog)
    await db
      .insert(experimentsTable)
      .values({
        id: e.id,
        market: e.market,
        name: e.name,
        hypothesis: e.hypothesis,
        config: e.config,
        initialBudget: e.initialBudget,
        enabled: e.enabled,
        demoMirror: e.demoMirror,
      })
      .onConflictDoUpdate({
        target: experimentsTable.id,
        set: {
          market: e.market,
          name: e.name,
          hypothesis: e.hypothesis,
          config: e.config,
          updatedAt: sql`now()`,
        },
      });
}

/** Хранилище движка лаборатории поверх таблиц домена. */
export function createDbExperimentStore(db: Db) {
  return {
    async listExperiments(): Promise<Experiment[]> {
      const rows = await db
        .select()
        .from(experimentsTable)
        .orderBy(asc(experimentsTable.id));
      return rows.map((r) => experimentSchema.parse(r));
    },

    currentRunId: () => ensureRun(db),

    async openTrades(runId: number): Promise<PaperTrade[]> {
      const rows = await db
        .select()
        .from(paperTradesTable)
        .where(
          and(
            eq(paperTradesTable.runId, runId),
            isNull(paperTradesTable.closedAt),
          ),
        )
        .orderBy(asc(paperTradesTable.openedAt));
      return rows.map(toTrade);
    },

    async realizedPnl(runId: number): Promise<Record<string, number>> {
      const rows = await db
        .select({
          experimentId: paperTradesTable.experimentId,
          pnl: sum(paperTradesTable.pnl).mapWith(Number),
        })
        .from(paperTradesTable)
        .where(
          and(
            eq(paperTradesTable.runId, runId),
            isNotNull(paperTradesTable.closedAt),
          ),
        )
        .groupBy(paperTradesTable.experimentId);
      return Object.fromEntries(rows.map((r) => [r.experimentId, r.pnl ?? 0]));
    },

    async insertTrade(t: PaperTrade): Promise<void> {
      await db
        .insert(paperTradesTable)
        .values({
          ...t,
          openedAt: new Date(t.openedAt),
          closedAt: toDate(t.closedAt),
        })
        .onConflictDoNothing({ target: paperTradesTable.id });
    },

    async updateTrade(
      id: string,
      p: Pick<PaperTrade, "stop" | "extreme" | "checkedUntil">,
    ): Promise<void> {
      await db
        .update(paperTradesTable)
        .set({ stop: p.stop, extreme: p.extreme, checkedUntil: p.checkedUntil })
        .where(eq(paperTradesTable.id, id));
    },

    async closeTrade(
      id: string,
      c: Pick<
        PaperTrade,
        "exitPrice" | "exitReason" | "fees" | "pnl" | "rMultiple"
      > & { closedAt: string },
    ): Promise<void> {
      await db
        .update(paperTradesTable)
        .set({ ...c, closedAt: new Date(c.closedAt) })
        .where(eq(paperTradesTable.id, id));
    },

    async getState(key: string): Promise<unknown> {
      const [row] = await db
        .select({ value: engineStateTable.value })
        .from(engineStateTable)
        .where(eq(engineStateTable.key, key));
      return row?.value;
    },

    async setState(key: string, value: unknown): Promise<void> {
      await db
        .insert(engineStateTable)
        .values({ key, value })
        .onConflictDoUpdate({
          target: engineStateTable.key,
          set: { value, updatedAt: sql`now()` },
        });
    },
  };
}

export type DbExperimentStore = ReturnType<typeof createDbExperimentStore>;
