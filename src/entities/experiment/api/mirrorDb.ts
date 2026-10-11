import { and, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import {
  demoMirrorOrdersTable,
  experimentsTable,
  paperTradesTable,
} from "../model/db";
import {
  ACTIVE_MIRROR_STATUSES,
  type MirrorStatus,
  OPEN_MIRROR_STATUSES,
} from "../model/mirror";

// Demo-зеркало (spec 008): какие paper-сделки повторить на Binance Demo и какие демо-позиции закрыть.
// Без @/… и node:* — как dbStore. Сделки с биржей делает композиция src/app/server/demoMirror.ts.

type Db = PgDatabase<PgQueryResultHKT>;

/** Paper-сделка, которую можно зеркалить. */
export interface MirrorCandidate {
  tradeId: string;
  experimentId: string;
  market: "spot" | "futures";
  symbol: string;
  direction: "long" | "short";
  openedAt: string;
  entryPrice: number;
  quantity: number;
  stop: number | null;
  takeProfit: number | null;
}

/** Открытая демо-позиция, чья paper-сделка уже закрылась. */
export interface MirrorToClose {
  tradeId: string;
  market: "spot" | "futures";
  symbol: string;
  direction: "long" | "short";
  /** Исполненное количество входа (для спота — сколько продавать). */
  quantity: number;
  exitReason: string | null;
}

export async function setExperimentDemoMirror(
  db: Db,
  id: string,
  demoMirror: boolean,
): Promise<boolean> {
  const rows = await db
    .update(experimentsTable)
    .set({ demoMirror, updatedAt: sql`now()` })
    .where(eq(experimentsTable.id, id))
    .returning({ id: experimentsTable.id });
  return rows.length > 0;
}

/**
 * Открытые paper-сделки экспериментов с включённым зеркалом, открытые не раньше `since`
 * и ещё не захваченные зеркалом. Старые сделки не зеркалим: цена ушла от входа.
 */
export async function listMirrorCandidates(
  db: Db,
  since: Date,
): Promise<MirrorCandidate[]> {
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
      demoMirrorOrdersTable,
      eq(demoMirrorOrdersTable.tradeId, paperTradesTable.id),
    )
    .where(
      and(
        eq(experimentsTable.demoMirror, true),
        isNull(paperTradesTable.closedAt),
        gte(paperTradesTable.openedAt, since),
        isNull(demoMirrorOrdersTable.tradeId),
      ),
    )
    .orderBy(paperTradesTable.openedAt);
  return rows.map((r) => ({
    ...r,
    market: r.market as MirrorCandidate["market"],
    direction: r.direction as MirrorCandidate["direction"],
    openedAt: r.openedAt.toISOString(),
  }));
}

/** Символы (market:symbol), по которым зеркало уже держит или открывает позицию. */
export async function activeMirrorSymbols(db: Db): Promise<Set<string>> {
  const rows = await db
    .select({
      market: demoMirrorOrdersTable.market,
      symbol: demoMirrorOrdersTable.symbol,
    })
    .from(demoMirrorOrdersTable)
    .where(inArray(demoMirrorOrdersTable.status, [...ACTIVE_MIRROR_STATUSES]));
  return new Set(rows.map((r) => `${r.market}:${r.symbol}`));
}

/** Захват сделки зеркалом (status pending). false — её уже захватил другой прогон. */
export async function claimMirror(
  db: Db,
  c: MirrorCandidate,
): Promise<boolean> {
  const rows = await db
    .insert(demoMirrorOrdersTable)
    .values({
      tradeId: c.tradeId,
      experimentId: c.experimentId,
      market: c.market,
      symbol: c.symbol,
      direction: c.direction,
      status: "pending" satisfies MirrorStatus,
    })
    .onConflictDoNothing()
    .returning({ tradeId: demoMirrorOrdersTable.tradeId });
  return rows.length > 0;
}

export async function updateMirror(
  db: Db,
  tradeId: string,
  patch: {
    status: MirrorStatus;
    message: string;
    steps: unknown[];
    demoRef?: string;
    entryPrice?: number | null;
    quantity?: number | null;
    exitPrice?: number | null;
    closed?: boolean;
  },
): Promise<void> {
  const { closed, ...fields } = patch;
  await db
    .update(demoMirrorOrdersTable)
    .set({
      ...fields,
      updatedAt: sql`now()`,
      ...(closed && { closedAt: sql`now()` }),
    })
    .where(eq(demoMirrorOrdersTable.tradeId, tradeId));
  if (patch.demoRef)
    await db
      .update(paperTradesTable)
      .set({ demoOrderRef: patch.demoRef })
      .where(eq(paperTradesTable.id, tradeId));
}

/**
 * Демо-позиции, которые надо закрыть: вход исполнен (protected/unprotected), а paper-сделка закрыта.
 * Захват на закрытие — тем же UPDATE … WHERE status: второй прогон строку уже не получит.
 */
export async function claimMirrorsToClose(db: Db): Promise<MirrorToClose[]> {
  const closedTrades = db
    .select({ id: paperTradesTable.id })
    .from(paperTradesTable)
    .where(isNotNull(paperTradesTable.closedAt));
  const rows = await db
    .update(demoMirrorOrdersTable)
    .set({ status: "closing" satisfies MirrorStatus, updatedAt: sql`now()` })
    .where(
      and(
        inArray(demoMirrorOrdersTable.status, [...OPEN_MIRROR_STATUSES]),
        inArray(demoMirrorOrdersTable.tradeId, closedTrades),
      ),
    )
    .returning();
  if (rows.length === 0) return [];
  const reasons = await db
    .select({ id: paperTradesTable.id, reason: paperTradesTable.exitReason })
    .from(paperTradesTable)
    .where(
      inArray(
        paperTradesTable.id,
        rows.map((r) => r.tradeId),
      ),
    );
  const reasonById = new Map(reasons.map((r) => [r.id, r.reason]));
  return rows.map((r) => ({
    tradeId: r.tradeId,
    market: r.market as MirrorToClose["market"],
    symbol: r.symbol,
    direction: r.direction as MirrorToClose["direction"],
    quantity: r.quantity ?? 0,
    exitReason: reasonById.get(r.tradeId) ?? null,
  }));
}

/** Статусы зеркала по сделкам — для таблицы сделок эксперимента. */
export async function mirrorStatuses(
  db: Db,
  tradeIds: string[],
): Promise<Map<string, { status: MirrorStatus; message: string }>> {
  if (tradeIds.length === 0) return new Map();
  const rows = await db
    .select({
      tradeId: demoMirrorOrdersTable.tradeId,
      status: demoMirrorOrdersTable.status,
      message: demoMirrorOrdersTable.message,
    })
    .from(demoMirrorOrdersTable)
    .where(inArray(demoMirrorOrdersTable.tradeId, tradeIds));
  return new Map(
    rows.map((r) => [
      r.tradeId,
      { status: r.status as MirrorStatus, message: r.message },
    ]),
  );
}

/** Демо-торговля эксперимента (spec 008): по строкам demo_mirror_orders с момента демо-сброса. */
export interface MirrorSummary {
  /** Сделок, вход которых исполнен на демо (открытые и закрытые). */
  trades: number;
  /** Сейчас открыто на демо (вход отправляется, позиция открыта или закрывается). */
  open: number;
  /** Закрыто на демо. */
  closed: number;
  /** Закрытые в плюс / в минус. */
  wins: number;
  losses: number;
  /** Не открылись: биржа или проверка заявки отказали. */
  rejected: number;
  /**
   * Пропущены зеркалом по своим правилам: по монете уже есть зеркальная позиция, вход старше
   * 10 минут, пара не к USDT. Биржа тут ни при чём.
   */
  skipped: number;
  /**
   * PnL закрытых демо-сделок, $, без комиссий: (выход − вход на демо) × количество на демо.
   * Выход — фактическая цена, если позицию закрыло зеркало по рынку, иначе (TP/SL биржи) —
   * цена выхода paper-сделки. Точная история — «Демо-сделки» на /signals.
   */
  pnl: number;
}

export const emptyMirrorSummary = (): MirrorSummary => ({
  trades: 0,
  open: 0,
  closed: 0,
  wins: 0,
  losses: 0,
  rejected: 0,
  skipped: 0,
  pnl: 0,
});

/**
 * Демо-сводка по экспериментам: все зеркала с момента experiments.demo_reset_at (без привязки к
 * эпохе paper — демо-счёт один на все эпохи).
 */
export async function mirrorSummaries(
  db: Db,
): Promise<Map<string, MirrorSummary>> {
  const rows = await db
    .select({
      experimentId: demoMirrorOrdersTable.experimentId,
      status: demoMirrorOrdersTable.status,
      direction: demoMirrorOrdersTable.direction,
      entryPrice: demoMirrorOrdersTable.entryPrice,
      quantity: demoMirrorOrdersTable.quantity,
      demoExit: demoMirrorOrdersTable.exitPrice,
      paperExit: paperTradesTable.exitPrice,
    })
    .from(demoMirrorOrdersTable)
    .innerJoin(
      paperTradesTable,
      eq(paperTradesTable.id, demoMirrorOrdersTable.tradeId),
    )
    .where(
      sql`${demoMirrorOrdersTable.createdAt} >= coalesce((select ${experimentsTable.demoResetAt} from ${experimentsTable} where ${experimentsTable.id} = ${demoMirrorOrdersTable.experimentId}), '-infinity'::timestamptz)`,
    );
  const out = new Map<string, MirrorSummary>();
  for (const r of rows) {
    let s = out.get(r.experimentId);
    if (!s) {
      s = emptyMirrorSummary();
      out.set(r.experimentId, s);
    }
    const status = r.status as MirrorStatus;
    if (status === "rejected") {
      s.rejected++;
      continue;
    }
    if (status === "skipped") {
      s.skipped++;
      continue;
    }
    s.trades++;
    if (status !== "closed") {
      s.open++;
      continue;
    }
    s.closed++;
    const exit = r.demoExit ?? r.paperExit;
    if (exit === null || r.entryPrice === null || r.quantity === null) continue;
    const pnl =
      (r.direction === "short" ? -1 : 1) * (exit - r.entryPrice) * r.quantity;
    s.pnl += pnl;
    if (pnl > 0) s.wins++;
    else s.losses++;
  }
  return out;
}

/**
 * Захватить открытые демо-позиции эксперимента (или всех, id = null) на закрытие — для демо-сброса.
 * Тот же переход статуса в closing, что и у крона: строку получит только один из них.
 */
export async function claimOpenMirrors(
  db: Db,
  experimentId: string | null,
): Promise<MirrorToClose[]> {
  const rows = await db
    .update(demoMirrorOrdersTable)
    .set({ status: "closing" satisfies MirrorStatus, updatedAt: sql`now()` })
    .where(
      and(
        inArray(demoMirrorOrdersTable.status, [...OPEN_MIRROR_STATUSES]),
        experimentId === null
          ? undefined
          : eq(demoMirrorOrdersTable.experimentId, experimentId),
      ),
    )
    .returning();
  return rows.map((r) => ({
    tradeId: r.tradeId,
    market: r.market as MirrorToClose["market"],
    symbol: r.symbol,
    direction: r.direction as MirrorToClose["direction"],
    quantity: r.quantity ?? 0,
    exitReason: "manual",
  }));
}

/** Отметка демо-сброса: статистика эксперимента (или всех) начинается заново. */
export async function markDemoReset(
  db: Db,
  experimentId: string | null,
): Promise<void> {
  await db
    .update(experimentsTable)
    .set({ demoResetAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      experimentId === null ? undefined : eq(experimentsTable.id, experimentId),
    );
}
