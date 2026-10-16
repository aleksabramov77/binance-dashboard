import { and, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { computeDemoStats } from "../lib/stats";
import {
  DEMO_MIRROR_MARKETS,
  type DemoMirrorMarket,
  demoMirrorMarketSchema,
} from "../model/assetGroup";
import {
  demoMirrorOrdersTable,
  experimentsTable,
  paperTradesTable,
} from "../model/db";
import {
  ACTIVE_MIRROR_STATUSES,
  type MirrorProtectRefs,
  type MirrorStatus,
  mirrorProtectRefsSchema,
  OPEN_MIRROR_STATUSES,
} from "../model/mirror";
import type { DemoSummary } from "../model/view";

// Demo-зеркало (spec 008): какие paper-сделки повторить на Binance Demo и какие демо-позиции закрыть.
// Без @/… и node:* — как dbStore. Сделки с биржей делает композиция src/app/server/demoMirror.ts.

type Db = PgDatabase<PgQueryResultHKT>;

/** Paper-сделка, которую можно зеркалить. */
export interface MirrorCandidate {
  tradeId: string;
  experimentId: string;
  market: DemoMirrorMarket;
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
  market: DemoMirrorMarket;
  symbol: string;
  direction: "long" | "short";
  /** Исполненное количество входа (для спота — сколько продавать). */
  quantity: number;
  exitReason: string | null;
  /** Свои защитные ордера; null — строка до PR 2b (закрытие снимает все ордера символа). */
  protectRefs: MirrorProtectRefs | null;
}

/** jsonb из БД → ссылки; битые/старые — null (закрытие по-старому, а не падение прогона). */
const parseProtectRefs = (raw: unknown): MirrorProtectRefs | null => {
  const parsed = mirrorProtectRefsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

const toClose = (
  r: typeof demoMirrorOrdersTable.$inferSelect,
  exitReason: string | null,
): MirrorToClose => ({
  tradeId: r.tradeId,
  market: demoMirrorMarketSchema.parse(r.market),
  symbol: r.symbol,
  direction: r.direction as MirrorToClose["direction"],
  quantity: r.quantity ?? 0,
  exitReason,
  protectRefs: parseProtectRefs(r.protectRefs),
});

/**
 * Тумблер зеркала. Включить можно только в группе, которую зеркало умеет (DEMO_MIRROR_MARKETS):
 * COIN-M — false, как и неизвестный id (композиция различает их по market эксперимента).
 */
export async function setExperimentDemoMirror(
  db: Db,
  id: string,
  demoMirror: boolean,
): Promise<boolean> {
  const rows = await db
    .update(experimentsTable)
    .set({ demoMirror, updatedAt: sql`now()` })
    .where(
      and(
        eq(experimentsTable.id, id),
        demoMirror
          ? inArray(experimentsTable.market, [...DEMO_MIRROR_MARKETS])
          : undefined,
      ),
    )
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
        // COIN-M на демо не зеркалим (spec 0023) — даже если флаг включили в обход тумблера.
        inArray(paperTradesTable.market, [...DEMO_MIRROR_MARKETS]),
        isNull(paperTradesTable.closedAt),
        gte(paperTradesTable.openedAt, since),
        isNull(demoMirrorOrdersTable.tradeId),
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

/** Зеркало, которое держит или открывает позицию на демо. */
export interface ActiveMirrorRow {
  market: "spot" | "usdm";
  symbol: string;
  direction: "long" | "short";
  /**
   * Строка нового учёта: свои ссылки на стоп/тейк (protect_refs) и, у фьючерсов, ноги на свой объём
   * (legs "quantity", с PR 2c), или вход ещё отправляется (pending — ссылки запишет этот же код).
   * false — строка до PR 2b (без ссылок: её закрытие снимает защитные ордера своей стороны) или
   * фьючерсы 2b (ноги с closePosition: сработавшая закроет всю сторону) — второе зеркало на монету
   * при ней не открываем.
   */
  hasRefs: boolean;
}

/**
 * Строка нового учёта: свои ссылки есть и ноги — на свой объём. Фьючерсы без метки legs "quantity" —
 * входы 2b (ноги с closePosition): сработавшая закроет всю сторону вместе с соседями — legacy.
 */
function ownLegsOnly(market: string, raw: unknown): boolean {
  const refs = parseProtectRefs(raw);
  if (!refs) return false;
  return (
    market !== "usdm" || (refs.market === "usdm" && refs.legs === "quantity")
  );
}

/**
 * Зеркала, которые держат или открывают позицию: монета и сторона — для лимита на монету и
 * встречных позиций в One-way (spec 0012, PR 2d).
 */
export async function activeMirrors(db: Db): Promise<ActiveMirrorRow[]> {
  const rows = await db
    .select({
      market: demoMirrorOrdersTable.market,
      symbol: demoMirrorOrdersTable.symbol,
      direction: demoMirrorOrdersTable.direction,
      status: demoMirrorOrdersTable.status,
      protectRefs: demoMirrorOrdersTable.protectRefs,
    })
    .from(demoMirrorOrdersTable)
    .where(inArray(demoMirrorOrdersTable.status, [...ACTIVE_MIRROR_STATUSES]));
  return rows.map((r) => {
    const market = demoMirrorMarketSchema.parse(r.market);
    return {
      market,
      symbol: r.symbol,
      direction: r.direction as ActiveMirrorRow["direction"],
      hasRefs:
        r.status === ("pending" satisfies MirrorStatus) ||
        ownLegsOnly(market, r.protectRefs),
    };
  });
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
    protectRefs?: MirrorProtectRefs | null;
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
 * Демо-позиции, которые надо закрыть: вход исполнен (protected/unprotected/close_failed), а
 * paper-сделка закрыта. Только id, без захвата: захват — по одной (claimMirrorToClose), чтобы
 * прогон с исчерпанным бюджетом времени не держал строки в closing.
 */
export async function listMirrorsToClose(db: Db): Promise<string[]> {
  const rows = await db
    .select({ tradeId: demoMirrorOrdersTable.tradeId })
    .from(demoMirrorOrdersTable)
    .innerJoin(
      paperTradesTable,
      eq(paperTradesTable.id, demoMirrorOrdersTable.tradeId),
    )
    .where(
      and(
        inArray(demoMirrorOrdersTable.status, [...OPEN_MIRROR_STATUSES]),
        isNotNull(paperTradesTable.closedAt),
      ),
    )
    .orderBy(demoMirrorOrdersTable.updatedAt);
  return rows.map((r) => r.tradeId);
}

/**
 * Захват одной демо-позиции на закрытие — UPDATE … WHERE status: второй прогон строку уже не
 * получит (null). null и если paper-сделка снова открыта (не бывает) или статус уже другой.
 */
export async function claimMirrorToClose(
  db: Db,
  tradeId: string,
): Promise<MirrorToClose | null> {
  const closedTrades = db
    .select({ id: paperTradesTable.id })
    .from(paperTradesTable)
    .where(isNotNull(paperTradesTable.closedAt));
  const [row] = await db
    .update(demoMirrorOrdersTable)
    .set({ status: "closing" satisfies MirrorStatus, updatedAt: sql`now()` })
    .where(
      and(
        eq(demoMirrorOrdersTable.tradeId, tradeId),
        inArray(demoMirrorOrdersTable.status, [...OPEN_MIRROR_STATUSES]),
        inArray(demoMirrorOrdersTable.tradeId, closedTrades),
      ),
    )
    .returning();
  if (!row) return null;
  const [paper] = await db
    .select({ reason: paperTradesTable.exitReason })
    .from(paperTradesTable)
    .where(eq(paperTradesTable.id, tradeId));
  return toClose(row, paper?.reason ?? null);
}

/**
 * Открытые фьючерсные зеркала со своими ссылками — для сверки ног (своя нога сработала — снять вторую).
 */
export async function listOpenMirrorLegs(db: Db): Promise<
  {
    tradeId: string;
    symbol: string;
    status: MirrorStatus;
    protectRefs: MirrorProtectRefs;
  }[]
> {
  const rows = await db
    .select({
      tradeId: demoMirrorOrdersTable.tradeId,
      symbol: demoMirrorOrdersTable.symbol,
      status: demoMirrorOrdersTable.status,
      protectRefs: demoMirrorOrdersTable.protectRefs,
    })
    .from(demoMirrorOrdersTable)
    .where(
      and(
        inArray(demoMirrorOrdersTable.status, [...OPEN_MIRROR_STATUSES]),
        eq(demoMirrorOrdersTable.market, "usdm"),
        isNotNull(demoMirrorOrdersTable.protectRefs),
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

/**
 * Позицию зеркала закрыла биржа его стопом/тейком (вторая нога снята): строка закрыта сразу, не
 * дожидаясь paper-сделки, с фактической ценой выхода (для демо-PnL). Только из открытых статусов —
 * захваченную на закрытие строку не трогаем. false — строка уже не открыта.
 */
export async function markMirrorClosedByExchange(
  db: Db,
  tradeId: string,
  patch: { message: string; steps: unknown[]; exitPrice: number | null },
): Promise<boolean> {
  const rows = await db
    .update(demoMirrorOrdersTable)
    .set({
      status: "closed" satisfies MirrorStatus,
      message: patch.message,
      steps: patch.steps,
      exitPrice: patch.exitPrice,
      updatedAt: sql`now()`,
      closedAt: sql`now()`,
    })
    .where(
      and(
        eq(demoMirrorOrdersTable.tradeId, tradeId),
        inArray(demoMirrorOrdersTable.status, [...OPEN_MIRROR_STATUSES]),
      ),
    )
    .returning({ tradeId: demoMirrorOrdersTable.tradeId });
  return rows.length > 0;
}

/**
 * Своя нога сработала раньше, чем исполнился вход (объём 0): позиция открыта без стопа — строка
 * unprotected. Только из открытых статусов: «Сбросить Demo» и ручное закрытие идут мимо замка прогона
 * и могли уже перевести строку в closing/closed. false — строка уже не открыта.
 */
export async function markMirrorUnprotected(
  db: Db,
  tradeId: string,
  patch: { message: string; steps: unknown[] },
): Promise<boolean> {
  const rows = await db
    .update(demoMirrorOrdersTable)
    .set({
      status: "unprotected" satisfies MirrorStatus,
      message: patch.message,
      steps: patch.steps,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(demoMirrorOrdersTable.tradeId, tradeId),
        inArray(demoMirrorOrdersTable.status, [...OPEN_MIRROR_STATUSES]),
      ),
    )
    .returning({ tradeId: demoMirrorOrdersTable.tradeId });
  return rows.length > 0;
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
   * Пропущены зеркалом по своим правилам: встречная позиция без Hedge mode (до PR 2d — «монета занята»), монеты нет на
   * демо-рынке, вход старше 10 минут, пара не к USDT. Запроса на вход не было.
   */
  skipped: number;
  /**
   * PnL закрытых демо-сделок, $, без комиссий: (выход − вход на демо) × количество на демо.
   * Выход — фактическая цена, если позицию закрыло зеркало по рынку, иначе (TP/SL биржи) —
   * цена выхода paper-сделки. Точная история — «Демо-сделки» на /signals.
   */
  pnl: number;
  /** PnL закрытых сделок в порядке закрытия (для PF/DD/equity, spec 0016); без цены выхода — не входит. */
  pnls: number[];
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
  pnls: [],
});

/**
 * Какие зеркала сводить (spec 0046): current — с момента experiments.demo_reset_at (без привязки к эпохе paper —
 * демо-счёт один на все эпохи); all — все зеркала, демо-сбросы историю не отсекают; { runId } — зеркала
 * paper-сделок этой эпохи (прошлая эпоха на /experiments).
 */
export type MirrorScope = "current" | "all" | { runId: number };

/** Демо-сводка по экспериментам за scope (по умолчанию — с последнего демо-сброса). */
export async function mirrorSummaries(
  db: Db,
  scope: MirrorScope = "current",
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
      closedAt: demoMirrorOrdersTable.closedAt,
    })
    .from(demoMirrorOrdersTable)
    .innerJoin(
      paperTradesTable,
      eq(paperTradesTable.id, demoMirrorOrdersTable.tradeId),
    )
    .where(
      scope === "current"
        ? sql`${demoMirrorOrdersTable.createdAt} >= coalesce((select ${experimentsTable.demoResetAt} from ${experimentsTable} where ${experimentsTable.id} = ${demoMirrorOrdersTable.experimentId}), '-infinity'::timestamptz)`
        : scope === "all"
          ? undefined
          : eq(paperTradesTable.runId, scope.runId),
    );
  // Порядок закрытия — для просадки от пика; незакрытые (null) в pnls не попадают.
  const closedTime = (r: (typeof rows)[number]) =>
    r.closedAt ? new Date(r.closedAt).getTime() : 0;
  rows.sort((a, b) => closedTime(a) - closedTime(b));
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
    s.pnls.push(pnl);
    if (pnl > 0) s.wins++;
    else s.losses++;
  }
  return out;
}

/** Сводка для API страниц: счётчики + PF/DD/equity по формулам paper (spec 0016). */
export function toDemoSummary(
  summary: MirrorSummary,
  initialBudget: number,
): DemoSummary {
  const { pnls, ...counts } = summary;
  return { ...counts, ...computeDemoStats(pnls, initialBudget) };
}

/**
 * Что сбрасывает демо-сброс: id эксперимента, группа активов ({ market } — все её эксперименты, spec 0038)
 * или null — все эксперименты.
 */
export type DemoResetScope = string | { market: string } | null;

/**
 * Захватить открытые демо-позиции эксперимента, группы или всех (null) на закрытие — для демо-сброса.
 * Тот же переход статуса в closing, что и у крона: строку получит только один из них.
 */
export async function claimOpenMirrors(
  db: Db,
  scope: DemoResetScope,
): Promise<MirrorToClose[]> {
  const rows = await db
    .update(demoMirrorOrdersTable)
    .set({ status: "closing" satisfies MirrorStatus, updatedAt: sql`now()` })
    .where(
      and(
        inArray(demoMirrorOrdersTable.status, [...OPEN_MIRROR_STATUSES]),
        scope === null
          ? undefined
          : typeof scope === "string"
            ? eq(demoMirrorOrdersTable.experimentId, scope)
            : inArray(
                demoMirrorOrdersTable.experimentId,
                db
                  .select({ id: experimentsTable.id })
                  .from(experimentsTable)
                  .where(eq(experimentsTable.market, scope.market)),
              ),
      ),
    )
    .returning();
  return rows.map((r) => toClose(r, "manual"));
}

/** Отметка демо-сброса: статистика эксперимента, группы или всех начинается заново. Возвращает, скольких. */
export async function markDemoReset(
  db: Db,
  scope: DemoResetScope,
): Promise<number> {
  const rows = await db
    .update(experimentsTable)
    .set({ demoResetAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      scope === null
        ? undefined
        : typeof scope === "string"
          ? eq(experimentsTable.id, scope)
          : eq(experimentsTable.market, scope.market),
    )
    .returning({ id: experimentsTable.id });
  return rows.length;
}
