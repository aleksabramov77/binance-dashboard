import { and, asc, desc, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import {
  demoTradeR,
  type LiveAutoPlan,
  type LiveClosedTrade,
  planLiveAuto,
  stopLossPnl,
} from "../lib/liveAuto";
import { DEMO_MIRROR_MARKETS, type Market } from "../model/assetGroup";
import {
  demoMirrorOrdersTable,
  experimentsTable,
  liveMirrorOrdersTable,
  paperTradesTable,
  runsTable,
} from "../model/db";
import {
  type LiveAutoSnapshot,
  type LiveMirrorMode,
  type LiveThresholds,
  type LiveTrip,
  liveAutoSnapshotSchema,
} from "../model/liveAuto";
import type { MirrorStatus } from "../model/mirror";
import { type LiveMirrorPatch, updateLiveMirrorSync } from "./liveMirrorDb";
import type { ExperimentDb } from "./tickLock";

// Режимы реального счёта в БД (spec 0053): положение переключателя, данные для решения автомата и запись решения.
// Решение — чистая функция (lib/liveAuto.ts); композиции — src/app/server/liveAuto.ts (суточная проверка, перевод в
// «Авто») и src/app/server/liveMirror.ts (пороги — атомарно в сохранении закрытия). Без @/… и node:* — как mirrorDb.

type Db = ExperimentDb;

/** Кто переключил, если переключил автомат (experiments.live_mirror_by). */
export const LIVE_AUTO_BY = "автомат";

/** Эксперимент для решения автомата. */
export interface LiveAutoRow {
  id: string;
  market: Market;
  enabled: boolean;
  liveOn: boolean;
  mode: LiveMirrorMode;
  advice: LiveTrip | null;
  thresholds: LiveThresholds;
  /** Когда «Реальный счёт» включили (начало окна порогов); null — не переключали. */
  since: Date | null;
  demoMirror: boolean;
  demoMirrorSince: Date | null;
  demoResetAt: Date | null;
}

type ExperimentRow = typeof experimentsTable.$inferSelect;

const toRow = (e: ExperimentRow): LiveAutoRow => ({
  id: e.id,
  market: e.market as Market,
  enabled: e.enabled,
  liveOn: e.liveMirror,
  mode: e.liveMirrorMode,
  advice: e.liveMirrorAdvice ?? null,
  thresholds: { lossUsd: e.liveLossLimitUsd, streak: e.liveLossStreak },
  since: e.liveMirrorSince,
  demoMirror: e.demoMirror,
  demoMirrorSince: e.demoMirrorSince,
  demoResetAt: e.demoResetAt,
});

export const parseLiveAutoSnapshot = (
  raw: unknown,
): LiveAutoSnapshot | null => {
  const parsed = liveAutoSnapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

/**
 * Эксперименты групп с реальным счётом (Spot, USDⓈ-M) не в «Выкл» — их проверяет автомат; ids — только эти.
 * runStartedAt — начало текущей эпохи (окно демо); null — эпохи ещё нет.
 */
export async function readLiveAutoRows(
  db: Db,
  ids?: string[],
): Promise<{ runStartedAt: Date | null; rows: LiveAutoRow[] }> {
  const [run] = await db
    .select({ startedAt: runsTable.startedAt })
    .from(runsTable)
    .orderBy(desc(runsTable.id))
    .limit(1);
  const rows = await db
    .select()
    .from(experimentsTable)
    .where(
      and(
        inArray(experimentsTable.market, [...DEMO_MIRROR_MARKETS]),
        ne(experimentsTable.liveMirrorMode, "off"),
        ids ? inArray(experimentsTable.id, ids) : undefined,
      ),
    )
    .orderBy(asc(experimentsTable.id));
  return { runStartedAt: run?.startedAt ?? null, rows: rows.map(toRow) };
}

/** Закрытая демо-сделка эксперимента с R (AC5). */
export interface LiveDemoTrade {
  createdAt: Date;
  r: number;
}

/**
 * Закрытые демо-сделки экспериментов, созданные не раньше `from`, с R по цене выхода демо (иначе paper — как сводка
 * демо) и исходному стопу paper-сделки; в порядке закрытия. Сделки без R не возвращаются.
 */
export async function liveDemoTrades(
  db: Db,
  ids: string[],
  from: Date | null,
): Promise<Map<string, LiveDemoTrade[]>> {
  const out = new Map<string, LiveDemoTrade[]>();
  if (!ids.length) return out;
  const rows = await db
    .select({
      experimentId: demoMirrorOrdersTable.experimentId,
      createdAt: demoMirrorOrdersTable.createdAt,
      direction: demoMirrorOrdersTable.direction,
      demoEntry: demoMirrorOrdersTable.entryPrice,
      demoExit: demoMirrorOrdersTable.exitPrice,
      paperExit: paperTradesTable.exitPrice,
      paperEntry: paperTradesTable.entryPrice,
      initialStop: paperTradesTable.initialStop,
    })
    .from(demoMirrorOrdersTable)
    .innerJoin(
      paperTradesTable,
      eq(paperTradesTable.id, demoMirrorOrdersTable.tradeId),
    )
    .where(
      and(
        inArray(demoMirrorOrdersTable.experimentId, ids),
        eq(demoMirrorOrdersTable.status, "closed" satisfies MirrorStatus),
        from ? gte(demoMirrorOrdersTable.createdAt, from) : undefined,
      ),
    )
    .orderBy(
      asc(demoMirrorOrdersTable.closedAt),
      asc(demoMirrorOrdersTable.tradeId),
    );
  for (const t of rows) {
    const r = demoTradeR({
      direction: t.direction === "short" ? "short" : "long",
      demoEntry: t.demoEntry,
      exit: t.demoExit ?? t.paperExit,
      paperEntry: t.paperEntry,
      initialStop: t.initialStop,
    });
    if (r === null) continue;
    const list = out.get(t.experimentId) ?? [];
    list.push({ createdAt: t.createdAt, r });
    out.set(t.experimentId, list);
  }
  return out;
}

/** Закрытые реальные сделки эксперимента с момента включения (since; null — все), в порядке закрытия. */
export async function liveClosedSince(
  db: Db,
  experimentId: string,
  since: Date | null,
): Promise<LiveClosedTrade[]> {
  return liveClosedSinceSync(db, experimentId, since);
}

/** То же синхронно — внутри транзакции SQLite (closeLiveWithAuto). */
function liveClosedSinceSync(
  db: Db,
  experimentId: string,
  since: Date | null,
): LiveClosedTrade[] {
  const rows = db
    .select({
      realizedPnl: liveMirrorOrdersTable.realizedPnl,
      direction: liveMirrorOrdersTable.direction,
      entryPrice: liveMirrorOrdersTable.entryPrice,
      stopLoss: liveMirrorOrdersTable.stopLoss,
      quantity: liveMirrorOrdersTable.quantity,
    })
    .from(liveMirrorOrdersTable)
    .where(
      and(
        eq(liveMirrorOrdersTable.experimentId, experimentId),
        eq(liveMirrorOrdersTable.status, "closed" satisfies MirrorStatus),
        since ? gte(liveMirrorOrdersTable.closedAt, since) : undefined,
      ),
    )
    .orderBy(
      asc(liveMirrorOrdersTable.closedAt),
      asc(liveMirrorOrdersTable.tradeId),
    )
    .all();
  return rows.map((r) => ({
    realizedPnl: r.realizedPnl,
    stopPnl: stopLossPnl({
      direction: r.direction === "short" ? "short" : "long",
      entryPrice: r.entryPrice,
      stopLoss: r.stopLoss,
      quantity: r.quantity,
    }),
  }));
}

/**
 * Положение переключателя пользователем: флаг live_mirror (`on` / `on_autooff` — включён, `off` / `auto` — выключен,
 * «Авто» включит автомат), начало окна порогов — сейчас, пороги (если заданы). Ручное переключение очищает пометку
 * автовыключения, подсказку и снимок «Авто». Не «Выкл» — только Spot и USDⓈ-M (COIN-M — null, как и неизвестный id).
 */
export async function setExperimentLiveMode(
  db: Db,
  id: string,
  mode: LiveMirrorMode,
  thresholds: LiveThresholds | undefined,
  by: string,
): Promise<{ id: string; liveMirror: boolean } | null> {
  const liveMirror = mode === "on" || mode === "on_autooff";
  const now = new Date();
  const [row] = await db
    .update(experimentsTable)
    .set({
      liveMirrorMode: mode,
      liveMirror,
      liveMirrorSince: now,
      liveMirrorBy: by,
      ...(thresholds && {
        liveLossLimitUsd: thresholds.lossUsd,
        liveLossStreak: thresholds.streak,
      }),
      liveAutoOffAt: null,
      liveAutoOffReason: null,
      liveMirrorAdvice: null,
      liveMirrorAuto: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(experimentsTable.id, id),
        mode === "off"
          ? undefined
          : inArray(experimentsTable.market, [...DEMO_MIRROR_MARKETS]),
      ),
    )
    .returning({
      id: experimentsTable.id,
      liveMirror: experimentsTable.liveMirror,
    });
  return row ?? null;
}

/** Новые пороги эксперимента без смены положения (модалка порогов у активного «Авто» / «Вкл + автовыкл»). */
export async function setExperimentLiveThresholds(
  db: Db,
  id: string,
  t: LiveThresholds,
): Promise<boolean> {
  const rows = await db
    .update(experimentsTable)
    .set({
      liveLossLimitUsd: t.lossUsd,
      liveLossStreak: t.streak,
      updatedAt: new Date(),
    })
    .where(eq(experimentsTable.id, id))
    .returning({ id: experimentsTable.id });
  return rows.length > 0;
}

/** Что записать по решению автомата. */
export interface LiveAutoPatch {
  /** Включить (флаг, окно порогов — сейчас) или выключить (положение → «Выкл» с причиной). */
  change?: { kind: "enable" } | { kind: "disable"; reason: string };
  snapshot?: LiveAutoSnapshot;
  /** Новая подсказка; пишется, только если в БД всё ещё прочитанная `from`. */
  advice?: { from: LiveTrip | null; to: LiveTrip | null };
}

/**
 * Запись решения автомата — только если положение и флаг всё ещё прочитанные (переключатель могли сменить, пока шла
 * проверка) и подсказку не сменила параллельная проверка. false — ничего не записано: решение устарело.
 */
export async function saveLiveAuto(
  db: Db,
  row: Pick<LiveAutoRow, "id" | "mode" | "liveOn">,
  patch: LiveAutoPatch,
): Promise<boolean> {
  return saveLiveAutoSync(db, row, patch);
}

/** То же синхронно — внутри транзакции SQLite (closeLiveWithAuto). */
function saveLiveAutoSync(
  db: Db,
  row: Pick<LiveAutoRow, "id" | "mode" | "liveOn">,
  patch: LiveAutoPatch,
): boolean {
  const change = patch.change;
  const now = new Date();
  const rows = db
    .update(experimentsTable)
    .set({
      ...(change?.kind === "enable" && {
        liveMirror: true,
        liveMirrorSince: now,
        liveMirrorBy: LIVE_AUTO_BY,
        updatedAt: now,
      }),
      ...(change?.kind === "disable" && {
        liveMirrorMode: "off" as const,
        liveMirror: false,
        liveMirrorSince: now,
        liveMirrorBy: LIVE_AUTO_BY,
        liveAutoOffAt: now,
        liveAutoOffReason: change.reason,
        updatedAt: now,
      }),
      ...(patch.snapshot && { liveMirrorAuto: { ...patch.snapshot } }),
      ...(patch.advice && { liveMirrorAdvice: patch.advice.to }),
    })
    .where(
      and(
        eq(experimentsTable.id, row.id),
        eq(experimentsTable.liveMirrorMode, row.mode),
        eq(experimentsTable.liveMirror, row.liveOn),
        patch.advice
          ? patch.advice.from === null
            ? isNull(experimentsTable.liveMirrorAdvice)
            : eq(experimentsTable.liveMirrorAdvice, patch.advice.from)
          : undefined,
      ),
    )
    .returning({ id: experimentsTable.id })
    .all();
  return rows.length > 0;
}

/** Решение по порогам, принятое при сохранении закрытия: что записано — для журнала и Telegram. */
export interface LiveCloseAuto {
  experimentId: string;
  mode: LiveMirrorMode;
  thresholds: LiveThresholds;
  plan: LiveAutoPlan;
  /** Положение ушло в «Выкл» с этой причиной; null — не выключали. */
  disabledReason: string | null;
  /** Ручному «Вкл» записана новая подсказка. */
  advised: boolean;
}

/**
 * Закрытие реальной сделки и пороги эксперимента — одной транзакцией (AC3): строка закрыта (только из `from`), затем
 * по закрытым сделкам с момента включения — выключить «Авто» / «Вкл + автовыкл» (положение → «Выкл» с причиной
 * `reasonOf`) или подсказать ручному «Вкл». closed = false — строка уже не закрывалась (повтор итога): ничего не решали.
 */
export async function closeLiveWithAuto(
  db: Db,
  tradeId: string,
  patch: LiveMirrorPatch,
  from: readonly MirrorStatus[],
  reasonOf: (plan: LiveAutoPlan, thresholds: LiveThresholds) => string,
): Promise<{ closed: boolean; auto: LiveCloseAuto | null }> {
  // Транзакция SQLite синхронная и берёт блокировку записи сразу (BEGIN IMMEDIATE): чтение эксперимента и запись
  // решения идут под одной блокировкой, параллельное закрытие другой сделки ждёт (вместо SELECT … FOR UPDATE).
  return db.transaction(
    (tx): { closed: boolean; auto: LiveCloseAuto | null } => {
      if (!updateLiveMirrorSync(tx, tradeId, patch, from))
        return { closed: false, auto: null };
      const trade = tx
        .select({ experimentId: liveMirrorOrdersTable.experimentId })
        .from(liveMirrorOrdersTable)
        .where(eq(liveMirrorOrdersTable.tradeId, tradeId))
        .get();
      if (!trade) return { closed: true, auto: null };
      const exp = tx
        .select()
        .from(experimentsTable)
        .where(eq(experimentsTable.id, trade.experimentId))
        .get();
      if (!exp || exp.liveMirrorMode === "off")
        return { closed: true, auto: null };
      const row = toRow(exp);
      const plan = planLiveAuto({
        mode: row.mode,
        liveOn: row.liveOn,
        enabled: row.enabled,
        advice: row.advice,
        thresholds: row.thresholds,
        closed: liveClosedSinceSync(tx, row.id, row.since),
        demo: null,
      });
      if (!plan) return { closed: true, auto: null };
      const disabledReason =
        plan.change === "disable" ? reasonOf(plan, row.thresholds) : null;
      const wrote =
        (plan.change === "disable" || plan.adviceState !== undefined) &&
        saveLiveAutoSync(tx, row, {
          ...(disabledReason !== null && {
            change: { kind: "disable", reason: disabledReason },
          }),
          ...(plan.adviceState !== undefined && {
            advice: { from: row.advice, to: plan.adviceState },
          }),
        });
      return {
        closed: true,
        auto: {
          experimentId: row.id,
          mode: row.mode,
          thresholds: row.thresholds,
          plan,
          disabledReason: wrote ? disabledReason : null,
          advised: wrote && plan.sendAdvice !== null,
        },
      };
    },
    { behavior: "immediate" },
  );
}

/** Последнее автовыключение эксперимента для пометки у «Выкл». */
export const liveAutoOffOf = (e: ExperimentRow) =>
  e.liveAutoOffAt && e.liveAutoOffReason
    ? { at: e.liveAutoOffAt.toISOString(), reason: e.liveAutoOffReason }
    : null;
