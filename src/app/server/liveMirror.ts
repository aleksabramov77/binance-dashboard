// Композиция реального зеркала в приложении (spec 0049): хранилище для воркера реального счёта (маршруты
// /api/live/mirror/*, Bearer LIVE_WORKER_SECRET), переключатель «Реальный счёт» эксперимента, аварийный стоп,
// журнал live.* и уведомления — категория «Сделки» (spec 0067). Ордеров здесь нет — их отправляет только воркер.
// Только сервер.
import { eq } from "drizzle-orm";
import {
  claimAllLiveOpen,
  claimLiveMirror,
  claimLiveToClose,
  closeLiveWithAuto,
  countLiveActive,
  countLiveSkipsSince,
  type ExperimentLiveMode,
  experimentsTable,
  getLiveMirror,
  type LiveCloseRequest,
  type LiveFilledRequest,
  type LiveLegsRequest,
  type LiveMirrorMode,
  type LiveMirrorState,
  type LiveOpenRequest,
  type LiveReconcileRequest,
  type LiveToClose,
  listLiveCandidates,
  listLiveToClose,
  listOpenLiveLegs,
  listStaleLivePending,
  liveActiveRows,
  liveDailyPnl,
  liveEnabledExperiments,
  type MirrorStatus,
  markLiveCloseFailed,
  markLiveFilled,
  paperTradesTable,
  recentLiveClosed,
  setExperimentLiveMode,
  setExperimentLiveThresholds,
  setLiveCardNotifyRef,
  skipLiveMirror,
  updateLiveMirror,
} from "@/entities/experiment";
import {
  deriveLiveStatus,
  LIVE,
  LIVE_MODE_LABEL,
  LIVE_SKIP,
  type LiveBalance,
  type LiveCardEntry,
  type LiveCardStatus,
  type LiveHaltAction,
  type LiveTradeSubject,
  type LiveTrading,
  liveAdviceText,
  liveAutoDisableText,
  liveCardText,
  liveCardUrgent,
  liveCloseAllDoneText,
  liveDailyLimitText,
  liveHaltText,
  liveModeText,
  loadLiveHalt,
  lossStreakText,
  nextUtcMidnight,
  requestLiveCloseAll,
  saveLiveCloseAllRun,
  setLiveStopped,
  thresholdUsd,
  utcDayStart,
} from "@/entities/live-account";
import { getLiveSilentAfterMs } from "@/shared/config/env.server";
import { getDb } from "@/shared/db/client.server";
import { log } from "@/shared/lib/logger.server";
import { type NotifyRef, notifyRefSchema } from "@/shared/notify";
import { actorLabel, type EngineToggleActor } from "./engineToggleNotice";
import { liveNotice, liveTradeNotice, loadLastLiveState } from "./liveAccount";
import {
  liveAutoLogData,
  liveAutoOffReason,
  liveAutoReasonOf,
  runLiveAuto,
} from "./liveAuto";
import { cachedTickerPrices } from "./tickerPrices";

/** Свежие paper-входы за этот срок — кандидаты (окно свежести проверяет сам прогон: 10 минут, как у демо). */
const CANDIDATES_WINDOW_MS = 60 * 60_000;
/** Уведомление о том же уже было — запись без отправки (итог skipped с этой причиной). */
const REPEAT = "повтор (сообщение было)";
const OPEN_STATUSES = ["protected", "unprotected", "close_failed"] as const;

/** Как называется карточка сделки в журнале («карточка заменена»). */
const CARD = "карточка";

type LiveRow = NonNullable<Awaited<ReturnType<typeof getLiveMirror>>>;

/** Ключ текущей карточки сделки; не задан (сделка до 0068, карточки ещё не было) — null. */
const cardRefOf = (row: LiveRow): NotifyRef | null => {
  const ref = notifyRefSchema.safeParse(row.cardNotifyRef);
  return ref.success ? ref.data : null;
};

const RAISED = ["minNotional", "minQty", "spotStop"] as const;
const raisedOf = (v: string | null) => RAISED.find((r) => r === v) ?? null;

/** Данные входа карточки — из строки сделки (одинаковые во всех статусах). */
const cardEntryOf = (row: LiveRow): LiveCardEntry => ({
  notionalUsd: row.notionalUsd,
  raised: raisedOf(row.sizeRaised),
  entryPrice: row.entryPrice,
  stopLoss: row.stopLoss,
  takeProfit: row.takeProfit,
  openedAt: (row.filledAt ?? row.createdAt).toISOString(),
});

/**
 * Новая карточка сделки (spec 0068, вариант B): журнал и уведомление одним вызовом, звук — по статусу, прежняя
 * карточка заменяется (канал отправляет новую, потом удаляет прежнюю); ключ новой — в строку сделки. Не отправлено —
 * ключ прежней остаётся: следующая карточка заменит её.
 */
async function announceCard(
  row: LiveRow,
  status: LiveCardStatus,
  entry: {
    level: "info" | "warn" | "error";
    event: string;
    data: Record<string, unknown>;
    skip?: string;
  },
): Promise<void> {
  const ref = cardRefOf(row);
  const text = liveCardText(subjectOf(row), cardEntryOf(row), status);
  const sent = await log.notify({
    level: entry.level,
    event: entry.event,
    message: text,
    // Для /logs без канала: была ли прежняя карточка (B6).
    data: { ...entry.data, card: status.kind, previousCard: ref !== null },
    category: "trades",
    urgent: liveCardUrgent(status),
    ...liveTradeNotice(text, row.experimentId),
    replaces: { ref, label: CARD },
    skip: entry.skip,
  });
  if (sent.ref) await setLiveCardNotifyRef(getDb(), row.tradeId, sent.ref);
}

/** «12:40 UTC» — время пульса для баланса из него. */
const utcClock = (iso: string) => `${iso.slice(11, 16)} UTC`;

/**
 * Баланс субсчёта рынка сделки для итога (spec 0068, AC4): от воркера после закрытия, иначе — последний пульс с его
 * временем (USDⓈ-M — wallet balance, Spot — equity в $); нет и пульса — null («нет данных»).
 */
async function exitBalance(
  market: LiveTradeSubject["market"],
  balanceUsd: number | null | undefined,
): Promise<LiveBalance | null> {
  if (balanceUsd != null) return { usd: balanceUsd, asOf: null };
  const state = await loadLastLiveState().catch(() => null);
  const hb = state?.heartbeat;
  const usd = market === "usdm" ? hb?.usdm?.walletBalance : hb?.spot?.equityUsd;
  return state && usd != null
    ? { usd, asOf: utcClock(state.receivedAt) }
    : null;
}

const subjectOf = (row: {
  experimentId: string;
  symbol: string;
  market: string;
  direction: string;
}): LiveTradeSubject => ({
  experimentId: row.experimentId,
  symbol: row.symbol,
  market: row.market === "usdm" ? "usdm" : "spot",
  direction: row.direction === "short" ? "short" : "long",
});

// ——— API воркера ———

/** Состояние прогона воркера одним запросом: стоп, кандидаты, активные позиции, дневной PnL, закрытия, ноги. */
export async function liveMirrorState(
  now = Date.now(),
): Promise<LiveMirrorState> {
  const db = getDb();
  const dayStart = utcDayStart(now);
  const [halt, candidates, active, daily, toClose, openLegs, stalePending] =
    await Promise.all([
      loadLiveHalt(db),
      listLiveCandidates(db, new Date(now - CANDIDATES_WINDOW_MS)),
      liveActiveRows(db),
      liveDailyPnl(db, dayStart),
      listLiveToClose(db),
      listOpenLiveLegs(db),
      listStaleLivePending(db),
    ]);
  return {
    halt: {
      stopped: halt.stopped,
      closeAllRequested: halt.closeAllRequestedAt !== null,
    },
    candidates,
    active: active.map((a) => ({
      tradeId: a.tradeId,
      experimentId: a.experimentId,
      market: a.market,
      symbol: a.symbol,
      direction: a.direction,
      status: a.status,
      openedAt: a.openedAt,
      entryPrice: a.entryPrice,
      quantity: a.quantity,
      stopLoss: a.stopLoss,
    })),
    dailyPnl: Object.fromEntries(daily),
    dayStart: dayStart.toISOString(),
    toClose,
    stalePending,
    openLegs,
  };
}

/** Paper-сделка и эксперимент — данные строки зеркала и включён ли «Реальный счёт». */
async function candidateOf(tradeId: string) {
  const [row] = await getDb()
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
      liveMirror: experimentsTable.liveMirror,
    })
    .from(paperTradesTable)
    .innerJoin(
      experimentsTable,
      eq(experimentsTable.id, paperTradesTable.experimentId),
    )
    .where(eq(paperTradesTable.id, tradeId));
  if (!row) return null;
  const market: "spot" | "usdm" | null =
    row.market === "spot" || row.market === "usdm" ? row.market : null;
  if (!market) return null;
  return {
    ...row,
    market,
    direction: (row.direction === "short" ? "short" : "long") as
      | "long"
      | "short",
    openedAt: row.openedAt.toISOString(),
  };
}

/**
 * Захват сделки перед входом: стоп входов читается из БД перед каждым входом (не прочитали — исключение, вход не
 * идёт), «Реальный счёт» эксперимента ещё включён, позиций меньше 5; одна активная позиция на монету — уникальный
 * индекс в БД.
 */
export async function claimLive(tradeId: string): Promise<{
  claimed: boolean;
  reason: "taken" | "halted" | "disabled" | "limit" | null;
}> {
  const db = getDb();
  const halt = await loadLiveHalt(db);
  if (halt.stopped) return { claimed: false, reason: "halted" };
  const c = await candidateOf(tradeId);
  if (!c?.liveMirror) return { claimed: false, reason: "disabled" };
  if ((await liveActiveRows(db)).length >= LIVE.maxOpenPositions)
    return { claimed: false, reason: "limit" };
  const claimed = await claimLiveMirror(db, c);
  return { claimed, reason: claimed ? null : "taken" };
}

/** Пропуск входа: строка skipped, запись live.skipped; дневной лимит — уведомление один раз за сутки на эксперимент. */
export async function skipLive(
  tradeId: string,
  reason: string,
  now = Date.now(),
): Promise<void> {
  const db = getDb();
  const c = await candidateOf(tradeId);
  if (!c) return;
  if (!(await skipLiveMirror(db, c, reason))) return;
  const daily = reason.startsWith(LIVE_SKIP.daily);
  log[daily ? "warn" : "info"](
    "live.skipped",
    `${c.experimentId} ${c.symbol}: реальный вход пропущен — ${reason}`,
    { experimentId: c.experimentId, tradeId, symbol: c.symbol, reason },
  );
  if (!daily) return;
  const dayStart = utcDayStart(now);
  if (
    (await countLiveSkipsSince(
      db,
      c.experimentId,
      LIVE_SKIP.daily,
      dayStart,
    )) !== 1
  )
    return;
  const pnl = (await liveDailyPnl(db, dayStart)).get(c.experimentId) ?? 0;
  const text = liveDailyLimitText(c.experimentId, pnl);
  await log.notify({
    level: "warn",
    event: "live.limit",
    message: text,
    data: { experimentId: c.experimentId, dailyPnl: pnl },
    category: "trades",
    urgent: true,
    ...liveNotice(text),
  });
}

/**
 * Вход исполнен, защита ещё ставится (spec 0068, B1): карточка ⏳, тихо. Только из pending и один раз: повтор или
 * опоздавшее после итога входа сообщение второй карточки не даёт.
 */
export async function saveLiveFilled(body: LiveFilledRequest): Promise<void> {
  const db = getDb();
  const changed = await markLiveFilled(db, body.tradeId, {
    entryPrice: body.entryPrice,
    quantity: body.quantity,
    stopLoss: body.order.stopLoss > 0 ? body.order.stopLoss : null,
    takeProfit: body.order.takeProfit,
    sizeRaised: body.order.raised,
  });
  if (!changed) return;
  const row = await getLiveMirror(db, body.tradeId);
  if (!row) return;
  await announceCard(
    row,
    { kind: "filled" },
    {
      level: "info",
      event: "live.filled",
      data: {
        experimentId: row.experimentId,
        tradeId: body.tradeId,
        symbol: row.symbol,
        entryPrice: body.entryPrice,
        quantity: body.quantity,
      },
    },
  );
}

/**
 * Итог входа: строка, журнал и карточка — 🟡 защищена (тихо) или ⚠️ без защиты (со звуком). Не открылся после
 * карточки ⏳ — карточка «вход отменён». Сообщение «исполнен» потерялось — итог всё равно даёт правильную карточку (B1).
 */
export async function saveLiveOpen(body: LiveOpenRequest): Promise<void> {
  const db = getDb();
  const r = body.result;
  const notionalUsd =
    r.entryPrice !== null && r.filledQuantity !== null
      ? r.entryPrice * r.filledQuantity
      : null;
  // Только из pending: повтор того же итога (ответ потерялся по таймауту, досылка outbox после сверки) не пишет
  // журнал и не шлёт карточку второй раз.
  const changed = await updateLiveMirror(
    db,
    body.tradeId,
    {
      status: r.status,
      message: r.message,
      steps: r.steps,
      liveRef: r.id,
      noProtection: r.status === "unprotected",
      entryPrice: r.entryPrice,
      quantity: r.filledQuantity,
      notionalUsd: notionalUsd ?? body.order.notionalUsd,
      stopLoss: body.order.stopLoss > 0 ? body.order.stopLoss : null,
      takeProfit: body.order.takeProfit,
      sizeRaised: body.order.raised,
      protectRefs: r.protectRefs,
    },
    ["pending"],
  );
  if (!changed) return;
  const row = await getLiveMirror(db, body.tradeId);
  if (!row) return;
  const data = {
    experimentId: row.experimentId,
    tradeId: body.tradeId,
    symbol: row.symbol,
    status: r.status,
    entryPrice: r.entryPrice,
    quantity: r.filledQuantity,
    liveRef: r.id,
    steps: r.steps,
  };
  if (r.status === "rejected") {
    // Карточки ⏳ не было — вход просто не состоялся, как раньше: только журнал.
    if (!cardRefOf(row)) {
      log.warn(
        "live.rejected",
        `${row.experimentId} ${row.symbol}: реальный вход не открылся — ${r.message}`,
        data,
      );
      return;
    }
    await announceCard(
      row,
      { kind: "cancelled", message: r.message },
      { level: "warn", event: "live.rejected", data },
    );
    return;
  }
  await announceCard(
    row,
    r.status === "unprotected"
      ? { kind: "unprotected", message: r.message }
      : { kind: "protected" },
    r.status === "unprotected"
      ? { level: "error", event: "live.unprotected", data }
      : { level: "info", event: "live.entry", data },
  );
}

export async function claimLiveClose(
  tradeId: string,
): Promise<LiveToClose | null> {
  return claimLiveToClose(getDb(), tradeId);
}

/**
 * Итог сделки (spec 0068): карточка 🟢/🔴/⚪ со звуком заменяет прежнюю. Повтор итога сюда не доходит — его отсекает
 * переход статуса строки (closeLiveWithAuto).
 */
async function announceExit(
  tradeId: string,
  exit: LiveCloseRequest["exit"],
  attempts: number,
): Promise<void> {
  const row = await getLiveMirror(getDb(), tradeId);
  if (!row) return;
  const balance = await exitBalance(subjectOf(row).market, exit.balanceUsd);
  const opened = row.filledAt ?? row.createdAt;
  await announceCard(
    row,
    {
      kind: "closed",
      exit: {
        ...exit,
        heldMs: row.closedAt ? row.closedAt.getTime() - opened.getTime() : null,
        balance,
        attempts,
      },
    },
    {
      level: "info",
      event: "live.exit",
      data: {
        experimentId: row.experimentId,
        tradeId,
        symbol: row.symbol,
        exitPrice: exit.exitPrice,
        feesUsd: exit.feesUsd,
        realizedPnl: exit.realizedPnl,
        pnlEstimated: exit.pnlEstimated,
        closedBy: exit.closedBy,
        leftover: exit.leftover,
        balance,
        attempts,
        steps: exit.steps,
      },
    },
  );
}

/** Поля закрытой строки из итога по исполнениям. */
const closedPatch = (e: LiveCloseRequest["exit"]) => ({
  status: "closed" as const,
  message: e.message,
  steps: e.steps,
  exitPrice: e.exitPrice,
  feesUsd: e.feesUsd,
  realizedPnl: e.realizedPnl,
  pnlEstimated: e.pnlEstimated,
  closedBy: e.closedBy,
  leftoverQty: e.leftover?.qty ?? null,
  leftoverUsd: e.leftover?.usd ?? null,
  closed: true,
});

/**
 * Закрытие строки и пороги эксперимента одной транзакцией (spec 0053, AC3): «Авто» / «Вкл + автовыкл» — выключить
 * (положение «Выкл» с причиной), ручное «Вкл» — подсказка. Потом — уведомления о закрытии, о выключении и подсказка.
 * Повтор того же итога (строка уже не в from) ничего не пишет и не шлёт.
 */
async function closeAndCheck(
  tradeId: string,
  e: LiveCloseRequest["exit"],
  from: readonly MirrorStatus[],
): Promise<void> {
  const db = getDb();
  const before = await getLiveMirror(db, tradeId);
  const r = await closeLiveWithAuto(
    db,
    tradeId,
    closedPatch(e),
    from,
    liveAutoOffReason,
  );
  if (!r.closed) return;
  await announceExit(tradeId, e, (before?.closeAttempts ?? 0) + 1);
  if (e.realizedPnl === null && before)
    log.warn(
      "live.advice",
      `${before.experimentId} ${before.symbol}: PnL неизвестен — в порогах автовыключения сделка считается убыточной (сумма — по своему стопу${before.stopLoss === null ? ", стоп неизвестен — 0" : ""})`,
      { experimentId: before.experimentId, tradeId },
    );
  const auto = r.auto;
  if (!auto) return;
  if (auto.disabledReason !== null) {
    const text = liveAutoDisableText(
      auto.experimentId,
      auto.mode,
      auto.disabledReason,
    );
    await log.notify({
      level: "info",
      event: "live.auto",
      message: text,
      data: {
        ...liveAutoLogData(
          auto.experimentId,
          auto.mode,
          auto.plan,
          auto.disabledReason,
        ),
        tradeId,
      },
      category: "trades",
      urgent: true,
      ...liveNotice(text),
    });
    return;
  }
  const reason = auto.advised
    ? liveAutoReasonOf(auto.plan, auto.thresholds)
    : null;
  if (reason) {
    const text = liveAdviceText(auto.experimentId, reason);
    await log.notify({
      level: "info",
      event: "live.advice",
      message: text,
      data: {
        ...liveAutoLogData(auto.experimentId, auto.mode, auto.plan, null),
        tradeId,
      },
      category: "trades",
      ...liveNotice(text),
    });
  }
}

/**
 * Итог попытки закрытия. closed — строка закрыта с PnL по исполнениям, уведомление (после неудачных попыток — «закрыто
 * после N попыток»). failed — строка снова в очереди и повторяется каждый прогон: close_failed, или «без защиты», если
 * свои TP/SL уже сняты. Уведомление о неудаче — один раз на позицию (первая неудача или снятие защиты), журнал —
 * каждый раз.
 */
export async function saveLiveClose(body: LiveCloseRequest): Promise<void> {
  const db = getDb();
  const e = body.exit;
  if (body.status === "closed") {
    await closeAndCheck(body.tradeId, e, ["closing"]);
    return;
  }
  const failed = await markLiveCloseFailed(db, body.tradeId, {
    protectionRemoved: body.protectionRemoved,
    message: e.message,
    steps: e.steps,
  });
  if (failed === null) return;
  const row = await getLiveMirror(db, body.tradeId);
  if (!row) return;
  const unprotected = failed.status === "unprotected";
  // Карточка — один раз на позицию: первая неудача или защита снята именно сейчас; журнал — каждый раз.
  const notify = failed.attempts === 1 || body.protectionRemoved;
  await announceCard(
    row,
    unprotected
      ? {
          kind: "unprotected",
          message: `${e.message} ${body.protectionRemoved ? "Свои TP/SL уже сняты" : "Своего стопа нет"} — закрытие повторяется каждый прогон.`,
        }
      : { kind: "close_failed", message: e.message },
    {
      level: "error",
      event: unprotected ? "live.unprotected" : "live.close_failed",
      data: {
        experimentId: row.experimentId,
        tradeId: body.tradeId,
        symbol: row.symbol,
        attempts: failed.attempts,
        steps: e.steps,
      },
      skip: notify ? undefined : REPEAT,
    },
  );
}

/** Сверка ног: позицию закрыла биржа (вторая нога снята) или нога сработала до входа (без защиты — в очередь закрытия). */
export async function saveLiveLegs(body: LiveLegsRequest): Promise<void> {
  const db = getDb();
  for (const item of body.items) {
    const e = item.exit;
    if (item.outcome === "closed") {
      await closeAndCheck(item.tradeId, e, OPEN_STATUSES);
      continue;
    }
    if (
      await updateLiveMirror(
        db,
        item.tradeId,
        {
          status: "unprotected",
          noProtection: true,
          message: e.message,
          steps: e.steps,
        },
        ["protected", "close_failed"],
      )
    ) {
      const row = await getLiveMirror(db, item.tradeId);
      if (!row) continue;
      await announceCard(
        row,
        { kind: "unprotected", message: e.message },
        {
          level: "error",
          event: "live.unprotected",
          data: { experimentId: row.experimentId, tradeId: item.tradeId },
        },
      );
    }
  }
}

/** Исходный стоп paper-сделки (стоп реального входа ставится по нему). */
async function paperInitialStop(tradeId: string): Promise<number | null> {
  const [t] = await getDb()
    .select({
      initialStop: paperTradesTable.initialStop,
      stop: paperTradesTable.stop,
    })
    .from(paperTradesTable)
    .where(eq(paperTradesTable.id, tradeId));
  const stop = t?.initialStop ?? t?.stop ?? null;
  return stop !== null && stop > 0 ? stop : null;
}

/**
 * Итог сверки «потерянного» входа (pending дольше LIVE_PENDING_STALE_S) с биржей: вход нашёлся — строка открыта
 * (стоп стоит, карточка 🟡) или «без защиты» (⚠️, очередь закрытия); входа нет — пропуск с причиной. Только из pending.
 */
export async function saveLiveReconcile(
  body: LiveReconcileRequest,
): Promise<void> {
  const db = getDb();
  const changed = await updateLiveMirror(
    db,
    body.tradeId,
    body.outcome === "skipped"
      ? { status: "skipped", message: body.message, steps: [] }
      : {
          status: body.outcome === "open" ? "protected" : "unprotected",
          noProtection: body.outcome === "unprotected",
          message: body.message,
          steps: [],
          entryPrice: body.entryPrice,
          quantity: body.quantity,
          notionalUsd:
            body.entryPrice !== null && body.quantity !== null
              ? body.entryPrice * body.quantity
              : null,
          protectRefs: body.protectRefs,
          // Свой стоп — для оценки PnL и порогов (spec 0053): с биржи, иначе исходный стоп paper-сделки.
          stopLoss: body.stopLoss ?? (await paperInitialStop(body.tradeId)),
        },
    ["pending"],
  );
  if (!changed) return;
  const row = await getLiveMirror(db, body.tradeId);
  if (!row) return;
  const data = {
    experimentId: row.experimentId,
    tradeId: body.tradeId,
    symbol: row.symbol,
    outcome: body.outcome,
  };
  if (body.outcome === "unprotected") {
    await announceCard(
      row,
      { kind: "unprotected", message: body.message },
      { level: "error", event: "live.reconcile", data },
    );
    return;
  }
  // Вход нашёлся со стопом — карточка 🟡 (итог входа потерялся, а сделка открыта); после ⏳ входа не оказалось —
  // карточка «вход отменён», чтобы ⏳ не висела.
  if (body.outcome === "open" || cardRefOf(row)) {
    await announceCard(
      row,
      body.outcome === "open"
        ? { kind: "protected" }
        : { kind: "cancelled", message: body.message },
      { level: "warn", event: "live.reconcile", data },
    );
    return;
  }
  log.warn(
    "live.reconcile",
    `${row.experimentId} ${row.symbol}: сверка «потерянного» входа — ${body.message}`,
    data,
  );
}

/**
 * «Закрыть всё»: захват всех открытых позиций (claim) и итог прогона воркера (done). Позиции остались — запрос
 * держится и повторяется следующим прогоном; уведомление — при первом прогоне с остатком и когда закрыто всё.
 */
export async function liveCloseAll(
  body:
    | { phase: "claim" }
    | { phase: "done"; closed: number; failed: number; errors: string[] },
): Promise<LiveToClose[]> {
  const db = getDb();
  if (body.phase === "claim") return claimAllLiveOpen(db);
  const halt = await loadLiveHalt(db);
  // Прогоны этого запроса: итог прошлого прогона того же запроса — после времени запроса.
  const sameRequest =
    halt.closeAllRequestedAt !== null &&
    halt.closeAllDoneAt !== null &&
    halt.closeAllDoneAt >= halt.closeAllRequestedAt;
  const runs = (sameRequest ? (halt.closeAllResult?.runs ?? 0) : 0) + 1;
  const result = {
    closed: body.closed,
    failed: body.failed,
    errors: body.errors,
    remaining: await countLiveActive(db),
    runs,
  };
  await saveLiveCloseAllRun(db, result);
  const text = liveCloseAllDoneText(result);
  const notify = result.remaining === 0 || runs === 1;
  await log.notify({
    level: result.remaining ? "error" : "info",
    event: "live.halt",
    message: text,
    data: result,
    category: "trades",
    // «Закрыть всё» выполнено — тихо; позиции остались (не закрылись) — со звуком, как сбой закрытия.
    urgent: result.remaining > 0,
    ...liveNotice(text, "live-stop"),
    skip: notify ? undefined : REPEAT,
  });
  return [];
}

// ——— Пользователь: переключатель и аварийный стоп ———

export type LiveToggleResult =
  | { ok: true; id: string; mode: LiveMirrorMode; liveMirror: boolean }
  | { ok: false; status: number; error: string };

/**
 * Переключатель «Реальный счёт» эксперимента: «Выкл · Авто · Вкл · Вкл + автовыкл» (spec 0049, 0053). Всё, кроме «Выкл», —
 * только со словом подтверждения, при ключе «✅ годится» и не для COIN-M; пороги — для «Авто» и «Вкл + автовыкл».
 * «Выкл» не закрывает открытые реальные позиции: они доживают со своими TP/SL. «Авто» сразу проверяется автоматом.
 */
export async function setLiveMode(
  input: ExperimentLiveMode,
  actor: EngineToggleActor,
  now = Date.now(),
): Promise<LiveToggleResult> {
  const db = getDb();
  const [exp] = await db
    .select({
      id: experimentsTable.id,
      market: experimentsTable.market,
      lossUsd: experimentsTable.liveLossLimitUsd,
      streak: experimentsTable.liveLossStreak,
      mode: experimentsTable.liveMirrorMode,
      liveMirror: experimentsTable.liveMirror,
    })
    .from(experimentsTable)
    .where(eq(experimentsTable.id, input.id));
  if (!exp)
    return { ok: false, status: 404, error: `Эксперимента ${input.id} нет` };
  const by = actorLabel(actor);
  // То же «Авто» / «Вкл + автовыкл» — только новые пороги: флаг, окно и решение автомата не трогаем.
  if (
    input.mode === exp.mode &&
    (input.mode === "auto" || input.mode === "on_autooff")
  ) {
    if (input.confirm?.trim().toUpperCase() !== LIVE.confirmWord)
      return {
        ok: false,
        status: 400,
        error: `Чтобы сохранить, введите слово «${LIVE.confirmWord}»`,
      };
    if (!input.thresholds)
      return { ok: false, status: 400, error: "Пороги не заданы" };
    await setExperimentLiveThresholds(db, input.id, input.thresholds);
    const text = `${input.id}: пороги реального счёта (${LIVE_MODE_LABEL[input.mode]}) — ${thresholdUsd(input.thresholds.lossUsd)} или ${lossStreakText(input.thresholds.streak)} (${by})`;
    log.info("live.toggle", text, {
      experimentId: input.id,
      mode: input.mode,
      thresholds: input.thresholds,
      by,
    });
    // Порог ниже уже набранного убытка выключает сразу, а не при следующем закрытии (ревью PR #95).
    return {
      ok: true,
      id: input.id,
      mode: input.mode,
      liveMirror: await applyLiveAutoNow(input.id, exp.liveMirror),
    };
  }
  if (input.mode !== "off") {
    if (exp.market === "coinm")
      return {
        ok: false,
        status: 400,
        error: "COIN-M на реальном счёте не торгуется",
      };
    if (input.confirm?.trim().toUpperCase() !== LIVE.confirmWord)
      return {
        ok: false,
        status: 400,
        error: `Чтобы включить, введите слово «${LIVE.confirmWord}»`,
      };
    const status = deriveLiveStatus(
      await loadLastLiveState(),
      now,
      getLiveSilentAfterMs(),
    );
    if (status.kind !== "ok")
      return {
        ok: false,
        status: 409,
        error: `Ключ реального счёта не годится (${status.kind === "blocked" ? status.reasons.join("; ") : status.kind === "silent" ? "воркер молчит" : status.kind === "no-key" ? "ключ не задан" : "воркер не подключён"}) — включить нельзя`,
      };
  }
  const thresholds =
    input.mode === "auto" || input.mode === "on_autooff"
      ? input.thresholds
      : undefined;
  const row = await setExperimentLiveMode(
    db,
    input.id,
    input.mode,
    thresholds,
    by,
  );
  if (!row) return { ok: false, status: 400, error: "Не удалось переключить" };
  const text = liveModeText(
    input.id,
    input.mode,
    by,
    thresholds ?? { lossUsd: exp.lossUsd, streak: exp.streak },
  );
  await log.notify({
    level: "info",
    event: "live.toggle",
    message: text,
    data: {
      experimentId: input.id,
      mode: input.mode,
      liveMirror: row.liveMirror,
      by,
      ...(thresholds && { thresholds }),
    },
    category: "trades",
    ...liveNotice(text),
  });
  // Перевод в «Авто» — правило сразу, без ожидания суток (AC4).
  const liveMirror =
    input.mode === "auto"
      ? await applyLiveAutoNow(input.id, row.liveMirror)
      : row.liveMirror;
  return { ok: true, id: input.id, mode: input.mode, liveMirror };
}

/** Правило режимов для одного эксперимента сразу; итог — флаг после проверки. Сбой — положение остаётся, решит суточная проверка. */
async function applyLiveAutoNow(
  id: string,
  liveMirror: boolean,
): Promise<boolean> {
  try {
    const auto = await runLiveAuto({ ids: [id] });
    const change = auto.changes.find((c) => c.id === id)?.change;
    return change === undefined ? liveMirror : change === "enable";
  } catch (error) {
    log.warn(
      "live.auto",
      `${id}: проверка режима реального счёта не удалась — решит суточная проверка`,
      {
        experimentId: id,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return liveMirror;
  }
}

/** «Стоп входов» / «Возобновить» / «Закрыть всё» — состояние в БД, журнал live.halt и уведомление со звуком. */
export async function liveHaltAction(
  action: LiveHaltAction,
  actor: EngineToggleActor,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const db = getDb();
  const by = actorLabel(actor);
  // Возобновить посреди «Закрыть всё» — прогон закрыл бы всё и тут же открыл новые сделки (комиссии, запрос не дойдёт до 0).
  if (
    action === "resume" &&
    (await loadLiveHalt(db)).closeAllRequestedAt !== null
  )
    return {
      ok: false,
      status: 409,
      error:
        "Идёт «Закрыть всё» — возобновить входы можно, когда реальных позиций не останется",
    };
  if (action === "close_all") await requestLiveCloseAll(db, by);
  else await setLiveStopped(db, action === "stop", by);
  const text = liveHaltText(action, by);
  await log.notify({
    level: "warn",
    event: "live.halt",
    message: text,
    data: { action, by },
    category: "trades",
    urgent: true,
    ...liveNotice(text, "live-stop"),
  });
  return { ok: true };
}

/** Торговля реального счёта для карточки и полосы /experiments: стоп, позиции (PnL ≈), дневные лимиты. */
export async function getLiveTradingView(
  now = Date.now(),
): Promise<LiveTrading> {
  const db = getDb();
  const dayStart = utcDayStart(now);
  const until = nextUtcMidnight(now).toISOString();
  const [halt, active, daily, enabled, closed] = await Promise.all([
    loadLiveHalt(db),
    liveActiveRows(db),
    liveDailyPnl(db, dayStart),
    liveEnabledExperiments(db),
    recentLiveClosed(db, 5),
  ]);
  const recent = closed.flatMap((r) =>
    r.closedAt
      ? [
          {
            tradeId: r.tradeId,
            experimentId: r.experimentId,
            symbol: r.symbol,
            closedAt: r.closedAt.toISOString(),
            realizedPnl: r.realizedPnl,
            pnlEstimated: r.pnlEstimated,
            closedBy: r.closedBy,
            leftoverQty: r.leftoverQty,
            leftoverUsd: r.leftoverUsd,
          },
        ]
      : [],
  );
  const prices = new Map<"spot" | "usdm", Map<string, number> | null>();
  for (const market of new Set(active.map((a) => a.market)))
    prices.set(market, await cachedTickerPrices(market).catch(() => null));
  const positions = active.map((a) => {
    const price = prices.get(a.market)?.get(a.symbol);
    const pnlUsd =
      price !== undefined && a.entryPrice !== null && a.quantity !== null
        ? (price - a.entryPrice) *
          a.quantity *
          (a.direction === "long" ? 1 : -1)
        : null;
    return { ...a, pnlUsd };
  });
  const names = new Map(enabled.map((e) => [e.id, e]));
  const ids = new Set([...enabled.map((e) => e.id), ...daily.keys()]);
  const experiments = [...ids].sort().map((id) => {
    const pnl = daily.get(id) ?? 0;
    return {
      id,
      name: names.get(id)?.name ?? id,
      market: names.get(id)?.market ?? "",
      dailyPnl: pnl,
      limitHit: pnl <= -LIVE.dailyLossUsd,
      until,
    };
  });
  return { halt, positions, recent, experiments };
}
