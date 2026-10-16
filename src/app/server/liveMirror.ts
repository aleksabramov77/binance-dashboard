// Композиция реального зеркала в приложении (spec 0049): хранилище для воркера реального счёта (маршруты
// /api/live/mirror/*, Bearer LIVE_WORKER_SECRET), переключатель «Реальный счёт» эксперимента, аварийный стоп,
// журнал live.* и Telegram. Ордеров здесь нет — их отправляет только воркер. Только сервер.
import { eq } from "drizzle-orm";
import {
  claimAllLiveOpen,
  claimLiveMirror,
  claimLiveToClose,
  countLiveActive,
  countLiveSkipsSince,
  experimentsTable,
  getLiveMirror,
  type LiveCloseRequest,
  type LiveLegsRequest,
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
  markLiveCloseFailed,
  paperTradesTable,
  recentLiveClosed,
  setExperimentLiveMirror,
  skipLiveMirror,
  updateLiveMirror,
} from "@/entities/experiment";
import {
  deriveLiveStatus,
  LIVE,
  LIVE_SKIP,
  type LiveHaltAction,
  type LiveTradeSubject,
  type LiveTrading,
  liveCloseAllDoneText,
  liveCloseFailedText,
  liveDailyLimitText,
  liveEntryText,
  liveExitText,
  liveHaltText,
  liveToggleText,
  liveUnprotectedText,
  loadLiveHalt,
  nextUtcMidnight,
  requestLiveCloseAll,
  saveLiveCloseAllRun,
  setLiveStopped,
  utcDayStart,
} from "@/entities/live-account";
import { getLiveSilentAfterMs } from "@/shared/config/env.server";
import { getDb } from "@/shared/db/client.server";
import { log } from "@/shared/lib/logger.server";
import { actorLabel, type EngineToggleActor } from "./engineToggleNotice";
import { loadLastLiveState, notifyLive } from "./liveAccount";
import { cachedTickerPrices } from "./tickerPrices";

/** Свежие paper-входы за этот срок — кандидаты (окно свежести проверяет сам прогон: 10 минут, как у демо). */
const CANDIDATES_WINDOW_MS = 60 * 60_000;
const OPEN_STATUSES = ["protected", "unprotected", "close_failed"] as const;

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

/** Пропуск входа: строка skipped, запись live.skipped; дневной лимит — Telegram один раз за сутки на эксперимент. */
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
  const telegram = await notifyLive(text);
  log.warn("live.limit", text, {
    experimentId: c.experimentId,
    dailyPnl: pnl,
    telegram,
  });
}

/** Итог входа: строка, журнал, Telegram (вход; без защиты — ⚠️). */
export async function saveLiveOpen(body: LiveOpenRequest): Promise<void> {
  const db = getDb();
  const r = body.result;
  const notionalUsd =
    r.entryPrice !== null && r.filledQuantity !== null
      ? r.entryPrice * r.filledQuantity
      : null;
  await updateLiveMirror(
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
      notionalUsd,
      protectRefs: r.protectRefs,
    },
    ["pending"],
  );
  const row = await getLiveMirror(db, body.tradeId);
  if (!row) return;
  const s = subjectOf(row);
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
    log.warn(
      "live.rejected",
      `${row.experimentId} ${row.symbol}: реальный вход не открылся — ${r.message}`,
      data,
    );
    return;
  }
  if (r.status === "unprotected") {
    const text = liveUnprotectedText(s, r.message);
    log.error("live.unprotected", text, {
      ...data,
      telegram: await notifyLive(text),
    });
    return;
  }
  const text = liveEntryText(s, {
    notionalUsd: notionalUsd ?? body.order.notionalUsd,
    raised: body.order.raised,
    stopLoss: body.order.stopLoss,
    takeProfit: body.order.takeProfit,
  });
  log.info("live.entry", text, { ...data, telegram: await notifyLive(text) });
}

export async function claimLiveClose(
  tradeId: string,
): Promise<LiveToClose | null> {
  return claimLiveToClose(getDb(), tradeId);
}

async function announceExit(
  tradeId: string,
  exit: LiveCloseRequest["exit"],
  attempts: number,
): Promise<void> {
  const row = await getLiveMirror(getDb(), tradeId);
  if (!row) return;
  const text = liveExitText(subjectOf(row), { ...exit, attempts });
  log.info("live.exit", text, {
    experimentId: row.experimentId,
    tradeId,
    symbol: row.symbol,
    exitPrice: exit.exitPrice,
    feesUsd: exit.feesUsd,
    realizedPnl: exit.realizedPnl,
    pnlEstimated: exit.pnlEstimated,
    closedBy: exit.closedBy,
    leftover: exit.leftover,
    attempts,
    steps: exit.steps,
    telegram: await notifyLive(text),
  });
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
 * Итог попытки закрытия. closed — строка закрыта с PnL по исполнениям, Telegram (после неудачных попыток — «закрыто
 * после N попыток»). failed — строка снова в очереди и повторяется каждый прогон: close_failed, или «без защиты», если
 * свои TP/SL уже сняты. Telegram о неудаче — один раз на позицию (первая неудача или снятие защиты), журнал — каждый раз.
 */
export async function saveLiveClose(body: LiveCloseRequest): Promise<void> {
  const db = getDb();
  const e = body.exit;
  if (body.status === "closed") {
    const before = await getLiveMirror(db, body.tradeId);
    if (await updateLiveMirror(db, body.tradeId, closedPatch(e), ["closing"]))
      await announceExit(body.tradeId, e, (before?.closeAttempts ?? 0) + 1);
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
  const s = subjectOf(row);
  const unprotected = failed.status === "unprotected";
  const text = unprotected
    ? liveUnprotectedText(
        s,
        `${e.message} ${body.protectionRemoved ? "Свои TP/SL уже сняты" : "Своего стопа нет"} — закрытие повторяется каждый прогон.`,
      )
    : liveCloseFailedText(s, e.message);
  // Один раз на позицию: первая неудача или защита снята именно сейчас.
  const notify = failed.attempts === 1 || body.protectionRemoved;
  log.error(unprotected ? "live.unprotected" : "live.close_failed", text, {
    experimentId: row.experimentId,
    tradeId: body.tradeId,
    symbol: row.symbol,
    attempts: failed.attempts,
    steps: e.steps,
    telegram: notify
      ? await notifyLive(text)
      : "не отправлен: повтор (сообщение было)",
  });
}

/** Сверка ног: позицию закрыла биржа (вторая нога снята) или нога сработала до входа (без защиты — в очередь закрытия). */
export async function saveLiveLegs(body: LiveLegsRequest): Promise<void> {
  const db = getDb();
  for (const item of body.items) {
    const e = item.exit;
    if (item.outcome === "closed") {
      const before = await getLiveMirror(db, item.tradeId);
      if (
        await updateLiveMirror(db, item.tradeId, closedPatch(e), OPEN_STATUSES)
      )
        await announceExit(item.tradeId, e, (before?.closeAttempts ?? 0) + 1);
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
      const text = liveUnprotectedText(subjectOf(row), e.message);
      log.error("live.unprotected", text, {
        experimentId: row.experimentId,
        tradeId: item.tradeId,
        telegram: await notifyLive(text),
      });
    }
  }
}

/**
 * Итог сверки «потерянного» входа (pending дольше LIVE_PENDING_STALE_S) с биржей: вход нашёлся — строка открыта
 * (стоп стоит) или «без защиты» (⚠️, очередь закрытия); входа нет — пропуск с причиной. Только из pending.
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
    const text = liveUnprotectedText(subjectOf(row), body.message);
    log.error("live.reconcile", text, {
      ...data,
      telegram: await notifyLive(text),
    });
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
 * держится и повторяется следующим прогоном; Telegram — при первом прогоне с остатком и когда закрыто всё.
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
  log[result.remaining ? "error" : "info"]("live.halt", text, {
    ...result,
    telegram: notify
      ? await notifyLive(text, null, "live-stop")
      : "не отправлен: повтор (сообщение было)",
  });
  return [];
}

// ——— Пользователь: переключатель и аварийный стоп ———

export type LiveToggleResult =
  | { ok: true; id: string; liveMirror: boolean }
  | { ok: false; status: number; error: string };

/**
 * Переключатель «Реальный счёт» эксперимента. Включение — только со словом подтверждения, при ключе «✅ годится» и не
 * для COIN-M. Выключение не закрывает открытые реальные позиции: они доживают со своими TP/SL.
 */
export async function setLiveMirror(
  input: { id: string; liveMirror: boolean; confirm?: string },
  actor: EngineToggleActor,
  now = Date.now(),
): Promise<LiveToggleResult> {
  const db = getDb();
  const [exp] = await db
    .select({ id: experimentsTable.id, market: experimentsTable.market })
    .from(experimentsTable)
    .where(eq(experimentsTable.id, input.id));
  if (!exp)
    return { ok: false, status: 404, error: `Эксперимента ${input.id} нет` };
  if (input.liveMirror) {
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
  const by = actorLabel(actor);
  const row = await setExperimentLiveMirror(db, input.id, input.liveMirror, by);
  if (!row) return { ok: false, status: 400, error: "Не удалось переключить" };
  const text = liveToggleText(input.id, input.liveMirror, by);
  log.info("live.toggle", text, {
    experimentId: input.id,
    liveMirror: input.liveMirror,
    by,
    telegram: await notifyLive(text),
  });
  return { ok: true, id: input.id, liveMirror: input.liveMirror };
}

/** «Стоп входов» / «Возобновить» / «Закрыть всё» — состояние в БД, журнал live.halt и Telegram. */
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
  log.warn("live.halt", text, {
    action,
    by,
    telegram: await notifyLive(text, null, "live-stop"),
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
