import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import {
  DEMO_MIRROR_MARKETS,
  demoMirrorMarketSchema,
} from "../model/assetGroup";
import {
  experimentsTable,
  liveMirrorOrdersTable,
  paperTradesTable,
} from "../model/db";
import {
  ACTIVE_MIRROR_STATUSES,
  type MirrorProtectRefs,
  type MirrorStatus,
  mirrorProtectRefsSchema,
  OPEN_MIRROR_STATUSES,
} from "../model/mirror";
import type { MirrorCandidate, MirrorToClose } from "./mirrorDb";

// Реальное зеркало (spec 0049): какие paper-сделки повторить на торговом субсчёте и какие реальные позиции закрыть.
// Таблица live_mirror_orders — по образцу demo_mirror_orders; ордера отправляет только воркер реального счёта,
// эти запросы вызывает композиция src/app/server/liveMirror.ts по его API. Без @/… и node:* — как mirrorDb.

type Db = PgDatabase<PgQueryResultHKT>;

const parseProtectRefs = (raw: unknown): MirrorProtectRefs | null => {
  const parsed = mirrorProtectRefsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

/** Реальная позиция на закрытие: как у демо + когда открыта (окно исполнений для PnL). */
export interface LiveMirrorToClose extends MirrorToClose {
  experimentId: string;
  entryPrice: number | null;
  openedAt: string;
}

const toClose = (
  r: typeof liveMirrorOrdersTable.$inferSelect,
  exitReason: string | null,
): LiveMirrorToClose => ({
  tradeId: r.tradeId,
  experimentId: r.experimentId,
  market: demoMirrorMarketSchema.parse(r.market),
  symbol: r.symbol,
  direction: r.direction as MirrorToClose["direction"],
  quantity: r.quantity ?? 0,
  exitReason,
  protectRefs: parseProtectRefs(r.protectRefs),
  entryPrice: r.entryPrice,
  openedAt: r.createdAt.toISOString(),
});

/**
 * Переключатель «Реальный счёт». Включить можно только Spot и USDⓈ-M (DEMO_MIRROR_MARKETS): COIN-M — null, как и
 * неизвестный id. Возвращает market эксперимента.
 */
export async function setExperimentLiveMirror(
  db: Db,
  id: string,
  liveMirror: boolean,
  by: string,
): Promise<{ id: string; market: string } | null> {
  const [row] = await db
    .update(experimentsTable)
    .set({
      liveMirror,
      liveMirrorSince: sql`now()`,
      liveMirrorBy: by,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(experimentsTable.id, id),
        liveMirror
          ? inArray(experimentsTable.market, [...DEMO_MIRROR_MARKETS])
          : undefined,
      ),
    )
    .returning({ id: experimentsTable.id, market: experimentsTable.market });
  return row ?? null;
}

/** Открытые paper-сделки экспериментов с включённым «Реальным счётом», не раньше `since`, ещё без строки зеркала. */
export async function listLiveCandidates(
  db: Db,
  since: Date,
): Promise<(MirrorCandidate & { experimentId: string })[]> {
  const rows = await db
    .select({
      tradeId: paperTradesTable.id,
      experimentId: paperTradesTable.experimentId,
      market: paperTradesTable.market,
      symbol: paperTradesTable.symbol,
      direction: paperTradesTable.direction,
      openedAt: paperTradesTable.openedAt,
      entryPrice: paperTradesTable.entryPrice,
      quantity: paperTradesTable.quantity,
      stop: paperTradesTable.stop,
      takeProfit: paperTradesTable.takeProfit,
    })
    .from(paperTradesTable)
    .innerJoin(
      experimentsTable,
      eq(experimentsTable.id, paperTradesTable.experimentId),
    )
    .leftJoin(
      liveMirrorOrdersTable,
      eq(liveMirrorOrdersTable.tradeId, paperTradesTable.id),
    )
    .where(
      and(
        eq(experimentsTable.liveMirror, true),
        inArray(paperTradesTable.market, [...DEMO_MIRROR_MARKETS]),
        isNull(paperTradesTable.closedAt),
        gte(paperTradesTable.openedAt, since),
        isNull(liveMirrorOrdersTable.tradeId),
      ),
    )
    .orderBy(paperTradesTable.openedAt);
  return rows.map((r) => ({
    ...r,
    market: demoMirrorMarketSchema.parse(r.market),
    direction: r.direction as MirrorCandidate["direction"],
    openedAt: r.openedAt.toISOString(),
  }));
}

/** Реальная позиция, которая держит или открывает монету (активные статусы). */
export interface LiveActiveRow {
  tradeId: string;
  experimentId: string;
  market: "spot" | "usdm";
  symbol: string;
  direction: "long" | "short";
  status: MirrorStatus;
  entryPrice: number | null;
  quantity: number | null;
  notionalUsd: number | null;
  openedAt: string;
}

/** Активные реальные позиции (лимит 5 и одна на монету, список в карточке). */
export async function liveActiveRows(db: Db): Promise<LiveActiveRow[]> {
  const rows = await db
    .select()
    .from(liveMirrorOrdersTable)
    .where(inArray(liveMirrorOrdersTable.status, [...ACTIVE_MIRROR_STATUSES]))
    .orderBy(liveMirrorOrdersTable.createdAt);
  return rows.map((r) => ({
    tradeId: r.tradeId,
    experimentId: r.experimentId,
    market: demoMirrorMarketSchema.parse(r.market),
    symbol: r.symbol,
    direction: r.direction as LiveActiveRow["direction"],
    status: r.status as MirrorStatus,
    entryPrice: r.entryPrice,
    quantity: r.quantity,
    notionalUsd: r.notionalUsd,
    openedAt: r.createdAt.toISOString(),
  }));
}

/** Реализованный PnL реальных сделок по экспериментам с начала суток `dayStart` (закрытые не раньше). */
export async function liveDailyPnl(
  db: Db,
  dayStart: Date,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      experimentId: liveMirrorOrdersTable.experimentId,
      pnl: sql<number>`coalesce(sum(${liveMirrorOrdersTable.realizedPnl}), 0)`.mapWith(
        Number,
      ),
    })
    .from(liveMirrorOrdersTable)
    .where(
      and(
        isNotNull(liveMirrorOrdersTable.closedAt),
        gte(liveMirrorOrdersTable.closedAt, dayStart),
      ),
    )
    .groupBy(liveMirrorOrdersTable.experimentId);
  return new Map(rows.map((r) => [r.experimentId, r.pnl]));
}

/** Эксперименты с включённым «Реальным счётом». */
export async function liveEnabledExperiments(
  db: Db,
): Promise<
  { id: string; name: string; market: string; since: string | null }[]
> {
  const rows = await db
    .select({
      id: experimentsTable.id,
      name: experimentsTable.name,
      market: experimentsTable.market,
      since: experimentsTable.liveMirrorSince,
    })
    .from(experimentsTable)
    .where(eq(experimentsTable.liveMirror, true))
    .orderBy(experimentsTable.id);
  return rows.map((r) => ({ ...r, since: r.since?.toISOString() ?? null }));
}

/**
 * Захват сделки для входа (status pending). false — её уже захватил другой прогон или монета рынка уже занята
 * активной реальной позицией (уникальный индекс live_mirror_orders_active_coin_uq).
 */
export async function claimLiveMirror(
  db: Db,
  c: MirrorCandidate & { experimentId: string },
): Promise<boolean> {
  const rows = await db
    .insert(liveMirrorOrdersTable)
    .values({
      tradeId: c.tradeId,
      experimentId: c.experimentId,
      market: c.market,
      symbol: c.symbol,
      direction: c.direction,
      status: "pending" satisfies MirrorStatus,
    })
    .onConflictDoNothing()
    .returning({ tradeId: liveMirrorOrdersTable.tradeId });
  return rows.length > 0;
}

/** Пропуск сделки (строка skipped с причиной). false — строка по сделке уже есть. */
export async function skipLiveMirror(
  db: Db,
  c: MirrorCandidate & { experimentId: string },
  reason: string,
): Promise<boolean> {
  const rows = await db
    .insert(liveMirrorOrdersTable)
    .values({
      tradeId: c.tradeId,
      experimentId: c.experimentId,
      market: c.market,
      symbol: c.symbol,
      direction: c.direction,
      status: "skipped" satisfies MirrorStatus,
      message: reason,
    })
    .onConflictDoNothing()
    .returning({ tradeId: liveMirrorOrdersTable.tradeId });
  return rows.length > 0;
}

/** Сколько пропусков с причиной, начинающейся с `prefix`, у эксперимента с начала суток (Telegram — один раз). */
export async function countLiveSkipsSince(
  db: Db,
  experimentId: string,
  prefix: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(liveMirrorOrdersTable)
    .where(
      and(
        eq(liveMirrorOrdersTable.experimentId, experimentId),
        eq(liveMirrorOrdersTable.status, "skipped"),
        gte(liveMirrorOrdersTable.createdAt, since),
        sql`${liveMirrorOrdersTable.message} like ${`${prefix}%`}`,
      ),
    );
  return row?.n ?? 0;
}

export interface LiveMirrorPatch {
  status: MirrorStatus;
  message: string;
  steps: unknown[];
  liveRef?: string;
  entryPrice?: number | null;
  quantity?: number | null;
  notionalUsd?: number | null;
  exitPrice?: number | null;
  feesUsd?: number | null;
  realizedPnl?: number | null;
  pnlEstimated?: boolean;
  closedBy?: string | null;
  noProtection?: boolean;
  leftoverQty?: number | null;
  leftoverUsd?: number | null;
  protectRefs?: MirrorProtectRefs | null;
  closed?: boolean;
}

/** Обновить строку реального зеркала; только из статусов `from` (если заданы). false — строка не в них. */
export async function updateLiveMirror(
  db: Db,
  tradeId: string,
  patch: LiveMirrorPatch,
  from?: readonly MirrorStatus[],
): Promise<boolean> {
  const { closed, ...fields } = patch;
  const rows = await db
    .update(liveMirrorOrdersTable)
    .set({
      ...fields,
      updatedAt: sql`now()`,
      ...(closed && { closedAt: sql`now()` }),
    })
    .where(
      and(
        eq(liveMirrorOrdersTable.tradeId, tradeId),
        from ? inArray(liveMirrorOrdersTable.status, [...from]) : undefined,
      ),
    )
    .returning({ tradeId: liveMirrorOrdersTable.tradeId });
  return rows.length > 0;
}

/** Строка по сделке: эксперимент и монета — для журнала и Telegram. */
export async function getLiveMirror(
  db: Db,
  tradeId: string,
): Promise<typeof liveMirrorOrdersTable.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(liveMirrorOrdersTable)
    .where(eq(liveMirrorOrdersTable.tradeId, tradeId));
  return row ?? null;
}

/**
 * Пауза между повторами неудачного закрытия (spec 0049): не чаще раза в прогон воркера (раз в минуту). При 429/418
 * запрос и так не уходит — пауза на хост общая (fetchRetry).
 */
export const LIVE_CLOSE_RETRY_PAUSE_S = 50;
/** Строка «closing» дольше этого — прогон оборвался после захвата: закрытие берётся снова. */
export const LIVE_CLOSING_STUCK_S = 300;

/**
 * Какие реальные позиции закрывать: paper-сделка закрылась; закрытие уже не удалось (close_failed) или позиция без
 * защиты (unprotected) — повтор каждый прогон, пока не закроется; «закрывается» дольше 5 минут — прогон оборвался.
 */
function closeDue(db: Db) {
  const closedTrades = db
    .select({ id: paperTradesTable.id })
    .from(paperTradesTable)
    .where(isNotNull(paperTradesTable.closedAt));
  return or(
    and(
      inArray(liveMirrorOrdersTable.status, ["protected"]),
      inArray(liveMirrorOrdersTable.tradeId, closedTrades),
    ),
    and(
      inArray(liveMirrorOrdersTable.status, ["unprotected", "close_failed"]),
      lt(
        liveMirrorOrdersTable.updatedAt,
        sql`now() - make_interval(secs => ${LIVE_CLOSE_RETRY_PAUSE_S})`,
      ),
    ),
    and(
      eq(liveMirrorOrdersTable.status, "closing"),
      lt(
        liveMirrorOrdersTable.updatedAt,
        sql`now() - make_interval(secs => ${LIVE_CLOSING_STUCK_S})`,
      ),
    ),
  );
}

/** Реальные позиции на закрытие: id без захвата (захват — по одной). */
export async function listLiveToClose(db: Db): Promise<string[]> {
  const rows = await db
    .select({ tradeId: liveMirrorOrdersTable.tradeId })
    .from(liveMirrorOrdersTable)
    .where(closeDue(db))
    .orderBy(liveMirrorOrdersTable.updatedAt);
  return rows.map((r) => r.tradeId);
}

/** Захват одной реальной позиции на закрытие (UPDATE … WHERE). null — её уже взяли или закрывать не нужно. */
export async function claimLiveToClose(
  db: Db,
  tradeId: string,
): Promise<LiveMirrorToClose | null> {
  const [row] = await db
    .update(liveMirrorOrdersTable)
    .set({ status: "closing" satisfies MirrorStatus, updatedAt: sql`now()` })
    .where(and(eq(liveMirrorOrdersTable.tradeId, tradeId), closeDue(db)))
    .returning();
  if (!row) return null;
  const [paper] = await db
    .select({ reason: paperTradesTable.exitReason })
    .from(paperTradesTable)
    .where(eq(paperTradesTable.id, tradeId));
  return toClose(row, paper?.reason ?? null);
}

/** «Закрыть всё»: захват всех открытых реальных позиций на закрытие (closing), в том числе неудачных прошлых. */
export async function claimAllLiveOpen(db: Db): Promise<LiveMirrorToClose[]> {
  const rows = await db
    .update(liveMirrorOrdersTable)
    .set({ status: "closing" satisfies MirrorStatus, updatedAt: sql`now()` })
    .where(
      or(
        inArray(liveMirrorOrdersTable.status, [...OPEN_MIRROR_STATUSES]),
        and(
          eq(liveMirrorOrdersTable.status, "closing"),
          lt(
            liveMirrorOrdersTable.updatedAt,
            sql`now() - make_interval(secs => ${LIVE_CLOSING_STUCK_S})`,
          ),
        ),
      ),
    )
    .returning();
  return rows.map((r) => toClose(r, null));
}

/** Сколько реальных позиций ещё держит субсчёт (активные строки): «Закрыть всё» держится, пока не 0. */
export async function countLiveActive(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(liveMirrorOrdersTable)
    .where(inArray(liveMirrorOrdersTable.status, [...ACTIVE_MIRROR_STATUSES]));
  return row?.n ?? 0;
}

/**
 * Закрытие не удалось: строка снова в очереди, попытка засчитана. Статус — «без защиты», если свои TP/SL сняты в этой
 * попытке или позиция уже была без защиты (no_protection — повторная неудача не понижает до close_failed), иначе
 * close_failed. Только из closing. null — строка уже не закрывалась.
 */
export async function markLiveCloseFailed(
  db: Db,
  tradeId: string,
  patch: { protectionRemoved: boolean; message: string; steps: unknown[] },
): Promise<{
  attempts: number;
  status: "close_failed" | "unprotected";
} | null> {
  const noProtection = sql`(${liveMirrorOrdersTable.noProtection} or ${patch.protectionRemoved})`;
  const [row] = await db
    .update(liveMirrorOrdersTable)
    .set({
      status: sql`case when ${noProtection} then 'unprotected' else 'close_failed' end`,
      noProtection: sql`${noProtection}`,
      message: patch.message,
      steps: patch.steps,
      closeAttempts: sql`${liveMirrorOrdersTable.closeAttempts} + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(liveMirrorOrdersTable.tradeId, tradeId),
        eq(liveMirrorOrdersTable.status, "closing"),
      ),
    )
    .returning({
      attempts: liveMirrorOrdersTable.closeAttempts,
      status: liveMirrorOrdersTable.status,
    });
  return row
    ? {
        attempts: row.attempts,
        status: row.status === "unprotected" ? "unprotected" : "close_failed",
      }
    : null;
}

/** Вход дольше этого в pending (воркер упал или итог не дошёл) — сверка с биржей по своему clientOrderId. */
export const LIVE_PENDING_STALE_S = 180;

/** «Потерянные» входы: pending дольше LIVE_PENDING_STALE_S. */
export async function listStaleLivePending(db: Db): Promise<
  {
    tradeId: string;
    experimentId: string;
    market: "spot" | "usdm";
    symbol: string;
    direction: "long" | "short";
    openedAt: string;
  }[]
> {
  const rows = await db
    .select()
    .from(liveMirrorOrdersTable)
    .where(
      and(
        eq(liveMirrorOrdersTable.status, "pending"),
        lt(
          liveMirrorOrdersTable.createdAt,
          sql`now() - make_interval(secs => ${LIVE_PENDING_STALE_S})`,
        ),
      ),
    );
  return rows.map((r) => ({
    tradeId: r.tradeId,
    experimentId: r.experimentId,
    market: demoMirrorMarketSchema.parse(r.market),
    symbol: r.symbol,
    direction: r.direction === "short" ? "short" : "long",
    openedAt: r.createdAt.toISOString(),
  }));
}

/** Открытые фьючерсные реальные позиции со своими ссылками — для сверки ног. */
export async function listOpenLiveLegs(db: Db): Promise<
  {
    tradeId: string;
    symbol: string;
    status: MirrorStatus;
    protectRefs: MirrorProtectRefs;
  }[]
> {
  const rows = await db
    .select({
      tradeId: liveMirrorOrdersTable.tradeId,
      symbol: liveMirrorOrdersTable.symbol,
      status: liveMirrorOrdersTable.status,
      protectRefs: liveMirrorOrdersTable.protectRefs,
    })
    .from(liveMirrorOrdersTable)
    .where(
      and(
        inArray(liveMirrorOrdersTable.status, [...OPEN_MIRROR_STATUSES]),
        eq(liveMirrorOrdersTable.market, "usdm"),
        isNotNull(liveMirrorOrdersTable.protectRefs),
      ),
    );
  return rows.flatMap((r) => {
    const protectRefs = parseProtectRefs(r.protectRefs);
    return protectRefs
      ? [
          {
            tradeId: r.tradeId,
            symbol: r.symbol,
            status: r.status as MirrorStatus,
            protectRefs,
          },
        ]
      : [];
  });
}

/** Последние закрытые реальные сделки — для карточки (не больше `limit`). */
export async function recentLiveClosed(
  db: Db,
  limit = 10,
): Promise<(typeof liveMirrorOrdersTable.$inferSelect)[]> {
  return db
    .select()
    .from(liveMirrorOrdersTable)
    .where(isNotNull(liveMirrorOrdersTable.closedAt))
    .orderBy(desc(liveMirrorOrdersTable.closedAt))
    .limit(limit);
}
