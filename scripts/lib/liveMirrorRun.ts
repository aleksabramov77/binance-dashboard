// Прогон реального зеркала в воркере (spec 0049): тот же runMirror, что у демо-зеркала (features/demo-mirror), но
// биржа — площадка реального счёта (клиент Live с белым списком), а хранилище — API приложения /api/live/mirror/*
// (у воркера нет БД). Проверки входа — createLiveGate (features/live-mirror): стоп, 5 позиций, дневной лимит
// эксперимента, объём $10, средства. Сеть и API внедряются — прогон покрыт тестами без биржи и приложения.
import { createHash } from "node:crypto";
import type { z } from "zod";
import {
  type LiveCloseRequest,
  type LiveLegsRequest,
  type LiveMirrorState,
  type LiveOpenRequest,
  type LiveReconcileRequest,
  type LiveToClose,
  liveClaimCloseReplySchema,
  liveClaimReplySchema,
  liveCloseAllReplySchema,
  liveMirrorStateSchema,
  liveOkSchema,
} from "@/entities/experiment";
import {
  createLiveGate,
  type FillLike,
  fillsPnl,
  LIVE,
  LIVE_SKIP,
  liveUsd,
} from "@/entities/live-account";
import type { TradeRequest, TradeResult } from "@/entities/trade";
import {
  type MirrorDecision,
  type MirrorPlanPolicy,
  type MirrorRunResult,
  runMirror,
} from "@/features/demo-mirror";
import {
  algoTriggered,
  type CloseDemoRequest,
  type EntrySize,
  type OpenMirrorLegs,
  type SweptMirror,
  tradeClientIds,
} from "@/features/execute-trade";

type Market = "spot" | "usdm";

/** Реальное зеркало: одна позиция на монету рынка, свои тексты пропусков. */
export const LIVE_MIRROR_POLICY: MirrorPlanPolicy = {
  maxPerCoin: 1,
  marketName: { spot: "реальном споте", usdm: "реальных фьючерсах" },
  name: "реальное зеркало",
  coinBusy: () => LIVE_SKIP.coin,
};

/** Маршруты API приложения для воркера (Bearer LIVE_WORKER_SECRET). */
export type MirrorPost = <T extends z.ZodType>(
  path: string,
  body: unknown,
  schema: T,
) => Promise<z.infer<T>>;

export function mirrorApi(post: MirrorPost) {
  return {
    state: () => post("/api/live/mirror/state", {}, liveMirrorStateSchema),
    claim: (tradeId: string) =>
      post("/api/live/mirror/claim", { tradeId }, liveClaimReplySchema),
    skip: (tradeId: string, reason: string) =>
      post("/api/live/mirror/skip", { tradeId, reason }, liveOkSchema),
    open: (body: LiveOpenRequest) =>
      post("/api/live/mirror/open", body, liveOkSchema),
    claimClose: async (tradeId: string) =>
      (
        await post(
          "/api/live/mirror/claim-close",
          { tradeId },
          liveClaimCloseReplySchema,
        )
      ).item,
    close: (body: LiveCloseRequest) =>
      post("/api/live/mirror/close", body, liveOkSchema),
    legs: (body: LiveLegsRequest) =>
      post("/api/live/mirror/legs", body, liveOkSchema),
    closeAllClaim: async () =>
      (
        await post(
          "/api/live/mirror/close-all",
          { phase: "claim" },
          liveCloseAllReplySchema,
        )
      ).items,
    closeAllDone: (r: { closed: number; failed: number; errors: string[] }) =>
      post("/api/live/mirror/close-all", { phase: "done", ...r }, liveOkSchema),
    reconcile: (body: LiveReconcileRequest) =>
      post("/api/live/mirror/reconcile", body, liveOkSchema),
  };
}
export type MirrorApi = ReturnType<typeof mirrorApi>;

/**
 * Неотправленный итог для приложения: вход, закрытие, сверка ног или «потерянного» входа. Ордер на бирже уже прошёл —
 * итог нельзя терять: воркер держит его в памяти и досылает следующим прогоном до новых входов.
 */
export type OutboxItem =
  | { kind: "open"; body: LiveOpenRequest }
  | { kind: "close"; body: LiveCloseRequest }
  | { kind: "legs"; body: LiveLegsRequest }
  | { kind: "reconcile"; body: LiveReconcileRequest };

/** Отправить итог: несколько попыток с паузой, не вышло — в outbox (без исключения: прогон идёт дальше). */
export type Deliver = (
  item: OutboxItem,
  send: () => Promise<unknown>,
) => Promise<unknown>;

/** Паузы между попытками отправить итог в приложение. */
export const DELIVER_RETRY_MS = [1_000, 3_000] as const;

export function createDeliver(
  outbox: OutboxItem[],
  sleep: (ms: number) => Promise<void>,
  onLost: (item: OutboxItem, error: unknown) => void = () => {},
): Deliver {
  return async (item, send) => {
    let lastError: unknown;
    for (const pause of [0, ...DELIVER_RETRY_MS]) {
      if (pause) await sleep(pause);
      try {
        return await send();
      } catch (error) {
        lastError = error;
      }
    }
    outbox.push(item);
    onLost(item, lastError);
  };
}

const sendItem = (api: MirrorApi, item: OutboxItem) => {
  switch (item.kind) {
    case "open":
      return api.open(item.body);
    case "close":
      return api.close(item.body);
    case "legs":
      return api.legs(item.body);
    case "reconcile":
      return api.reconcile(item.body);
  }
};

/** Дослать неотправленные итоги прошлых прогонов. Не дошло — остаётся в outbox. Возвращает, сколько отправлено. */
export async function flushOutbox(
  api: MirrorApi,
  outbox: OutboxItem[],
): Promise<number> {
  const pending = outbox.splice(0, outbox.length);
  let sent = 0;
  for (const item of pending)
    try {
      await sendItem(api, item);
      sent++;
    } catch {
      outbox.push(item);
    }
  return sent;
}

/** Биржа реального счёта для прогона (площадка Live): ордера — общая логика execute-trade. */
export interface LiveExchange {
  /** Вход: seed — основа своих clientOrderId (liveOrderSeed из id paper-сделки). */
  placeTrade: (req: TradeRequest, seed: string) => Promise<TradeResult>;
  /** Свой ордер спота по clientOrderId; null — такого нет. */
  spotOrder: (
    symbol: string,
    clientOrderId: string,
  ) => Promise<{
    orderId: number;
    orderListId: number;
    status: string;
    executedQty: number;
    cummulativeQuoteQty: number;
    /** Цена срабатывания стопа; нет — 0. */
    stopPrice?: number;
  } | null>;
  /** Свой ордер фьючерсов по clientOrderId; null — такого нет. */
  futuresOrder: (
    symbol: string,
    clientOrderId: string,
  ) => Promise<{
    orderId: number;
    status: string;
    executedQty: number;
    avgPrice: number;
  } | null>;
  /** Свой algo-ордер (стоп/тейк фьючерсов) по clientAlgoId; null — такого нет. */
  algoOrder: (clientAlgoId: string) => Promise<{
    algoId: number;
    algoStatus: string;
    actualOrderId: number | null;
    /** Цена срабатывания; нет — 0. */
    triggerPrice?: number;
  } | null>;
  closePosition: (req: CloseDemoRequest) => Promise<{
    status: "closed" | "failed";
    message: string;
    steps: { label: string; ok: boolean; detail: string }[];
    exitPrice: number | null;
    /** Свои TP/SL в этой попытке сняты (closeDemoPosition). */
    protectionRemoved?: boolean;
  }>;
  sweepLegs: (
    legs: OpenMirrorLegs[],
    overBudget: () => boolean,
  ) => Promise<SweptMirror[]>;
  /** Правила символа; null — символа нет на рынке. */
  symbolRules: (
    market: Market,
    symbol: string,
  ) => Promise<{
    minQty: number;
    minNotional: number;
    stepSize: string;
  } | null>;
  price: (market: Market, symbol: string) => Promise<number>;
  balances: () => Promise<{ spot: number; usdm: number }>;
  positionMode: () => Promise<"oneway" | "hedge">;
  /** Счёт фьючерсов пуст (нет позиций и ордеров) — можно переключить режим. */
  futuresBusy: () => Promise<boolean>;
  enableOneway: () => Promise<unknown>;
  fills: (market: Market, symbol: string) => Promise<FillLike[]>;
  sizeEntry: (input: {
    price: number;
    rules: { minQty: number; minNotional: number; stepSize: string };
    targetUsd: number;
    maxUsd: number;
    spotStop: number | null;
  }) => EntrySize;
  spotSlippage: number;
}

/** «Остаток 0.00000986 BTC ≈ $0,81 остался на субсчёте». */
const leftoverText = (l: { qty: number; asset: string; usd: number }) =>
  `Остаток ${l.qty.toFixed(8).replace(/\.?0+$/, "")} ${l.asset} ≈ ${liveUsd(l.usd)} остался на субсчёте`;

/** Чем закрыта позиция по пути закрытия: биржа (TP/SL — по знаку PnL) или само зеркало. */
export function closedByOf(
  message: string,
  realizedPnl: number | null,
  fallback: "mirror" | "close_all",
): LiveCloseRequest["exit"]["closedBy"] {
  if (/сработал (TP\/SL|стоп\/тейк)/.test(message) && realizedPnl !== null)
    return realizedPnl >= 0 ? "tp" : "sl";
  return fallback;
}

/**
 * Основа своих clientOrderId реальной сделки (`bd<seed>-…`) из id paper-сделки: детерминированная — «потерянный» вход
 * и исполнения своих ордеров находятся на бирже по строке. sha256 — id paper-сделки длиннее 24 символов, а обрезка
 * склеила бы разные сделки одной монеты.
 */
export const liveOrderSeed = (paperTradeId: string): string =>
  createHash("sha256").update(paperTradeId).digest("hex").slice(0, 24);

/** Комиссия taker для оценки PnL, когда исполнения не прочитаны. */
const FEE_RATE: Record<Market, number> = { spot: 0.001, usdm: 0.0005 };

/**
 * Свои ордера сделки на бирже (по своим clientOrderId): вход, свои TP/SL, своё закрытие — их исполнения и есть сделка.
 * Ошибка чтения — исключение (PnL тогда — оценка).
 */
export async function ownOrderIds(
  ex: LiveExchange,
  item: Pick<LiveToClose, "tradeId" | "market" | "symbol">,
): Promise<Set<number>> {
  const ids = tradeClientIds(liveOrderSeed(item.tradeId));
  const out = new Set<number>();
  if (item.market === "spot") {
    for (const cid of [
      ids.working,
      ids.market,
      ids.stop,
      ids.takeProfit,
      ids.protectStop,
      ids.protectTakeProfit,
      ids.close,
    ]) {
      const o = await ex.spotOrder(item.symbol, cid);
      if (o && o.executedQty > 0) out.add(o.orderId);
    }
    return out;
  }
  for (const cid of [ids.market, ids.close]) {
    const o = await ex.futuresOrder(item.symbol, cid);
    if (o && o.executedQty > 0) out.add(o.orderId);
  }
  for (const cid of [ids.stop, ids.takeProfit]) {
    const o = await ex.algoOrder(cid);
    if (o?.actualOrderId) out.add(o.actualOrderId);
  }
  return out;
}

type ExitFigures = {
  exitPrice: number | null;
  feesUsd: number | null;
  realizedPnl: number | null;
  pnlEstimated: boolean;
  leftover: LiveCloseRequest["exit"]["leftover"];
  note: string | null;
};

/** Оценка PnL по ценам входа и выхода с комиссией по ставке — когда исполнения не прочитаны (не 0 в дневном лимите). */
export function estimateExit(
  item: Pick<LiveToClose, "market" | "direction" | "entryPrice" | "quantity">,
  exitPrice: number | null,
  reason: string,
  /** Цена выхода не известна — взят худший случай (свой стоп или текущая цена): пометка в тексте. */
  priceSource: string | null = null,
): ExitFigures {
  if (item.entryPrice === null || exitPrice === null || item.quantity <= 0)
    return {
      exitPrice,
      feesUsd: null,
      realizedPnl: null,
      pnlEstimated: false,
      leftover: null,
      note: `PnL не посчитан: ${reason}`,
    };
  const sign = item.direction === "long" ? 1 : -1;
  const fees =
    item.quantity * (item.entryPrice + exitPrice) * FEE_RATE[item.market];
  return {
    exitPrice,
    feesUsd: fees,
    realizedPnl: sign * (exitPrice - item.entryPrice) * item.quantity - fees,
    pnlEstimated: true,
    leftover: null,
    note: `PnL — оценка по ценам входа и выхода${priceSource ? ` (выход — ${priceSource})` : ""}, комиссия по ставке: ${reason}`,
  };
}

type EstimateItem = Pick<
  LiveToClose,
  "market" | "symbol" | "direction" | "entryPrice" | "quantity" | "stopLoss"
>;

/**
 * Оценка без исполнений. Цена выхода не известна (биржа закрыла по TP/SL, а исполнения не прочитаны) — худший
 * разумный случай: цена своего стопа, иначе текущая цена символа. Не 0: убыток идёт в дневной лимит.
 */
async function estimateWorst(
  ex: LiveExchange,
  item: EstimateItem,
  exitPrice: number | null,
  reason: string,
): Promise<ExitFigures> {
  if (exitPrice !== null) return estimateExit(item, exitPrice, reason);
  if (item.stopLoss !== null && item.stopLoss > 0)
    return estimateExit(item, item.stopLoss, reason, "цена своего стопа");
  const now = await ex.price(item.market, item.symbol).catch(() => null);
  return estimateExit(item, now, reason, now === null ? null : "текущая цена");
}

async function exitByFills(
  ex: LiveExchange,
  item: EstimateItem & Pick<LiveToClose, "tradeId">,
  fallbackExit: number | null,
): Promise<ExitFigures> {
  const asset = item.symbol.replace(/USDT$/, "");
  try {
    const orderIds = await ownOrderIds(ex, item);
    if (orderIds.size === 0)
      return estimateWorst(
        ex,
        item,
        fallbackExit,
        "свои ордера на бирже не найдены",
      );
    const pnl = fillsPnl(await ex.fills(item.market, item.symbol), {
      direction: item.direction,
      since: 0,
      baseAsset: asset,
      orderIds,
    });
    if (pnl.realizedPnl === null)
      return estimateWorst(
        ex,
        item,
        pnl.exitPrice ?? fallbackExit,
        "исполнения выхода не найдены",
      );
    const leftover =
      pnl.leftoverQty > 0
        ? { qty: pnl.leftoverQty, asset, usd: pnl.leftoverUsd }
        : null;
    const notes = [
      leftover ? `${leftoverText(leftover)} — в PnL не входит.` : null,
      pnl.unpricedFees.length
        ? `Комиссии в ${pnl.unpricedFees.join(", ")} в $ не пересчитаны.`
        : null,
    ].filter(Boolean);
    return {
      exitPrice: pnl.exitPrice ?? fallbackExit,
      feesUsd: pnl.feesUsd,
      realizedPnl: pnl.realizedPnl,
      pnlEstimated: false,
      leftover,
      note: notes.join(" ") || null,
    };
  } catch (error) {
    return estimateWorst(
      ex,
      item,
      fallbackExit,
      `исполнения не прочитаны (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

/**
 * Одна попытка закрыть реальную позицию. Не вышло — status failed (строка вернётся в очередь и повторится на
 * следующем прогоне); исключение биржи — тоже failed, а не обрыв прогона. protectionRemoved — свои TP/SL в этой
 * попытке уже сняты: позиция без защиты до следующей попытки.
 */
export async function closeOne(
  ex: LiveExchange,
  item: LiveToClose,
  fallback: "mirror" | "close_all",
): Promise<LiveCloseRequest> {
  let r: Awaited<ReturnType<LiveExchange["closePosition"]>>;
  try {
    r = await ex.closePosition(item);
  } catch (error) {
    r = {
      status: "failed",
      message: `Закрытие не удалось: ${error instanceof Error ? error.message : String(error)}`,
      steps: [],
      exitPrice: null,
    };
  }
  const fills: ExitFigures =
    r.status === "closed"
      ? await exitByFills(ex, item, r.exitPrice)
      : {
          exitPrice: null,
          feesUsd: null,
          realizedPnl: null,
          pnlEstimated: false,
          leftover: null,
          note: null,
        };
  return {
    tradeId: item.tradeId,
    status: r.status,
    protectionRemoved: r.status === "failed" && r.protectionRemoved === true,
    exit: {
      message: fills.note ? `${r.message} ${fills.note}` : r.message,
      steps: r.steps,
      exitPrice: fills.exitPrice,
      feesUsd: fills.feesUsd,
      realizedPnl: fills.realizedPnl,
      pnlEstimated: fills.pnlEstimated,
      leftover: fills.leftover,
      closedBy:
        r.status === "closed"
          ? closedByOf(r.message, fills.realizedPnl, fallback)
          : null,
    },
  };
}

/**
 * «Закрыть всё»: захватить все открытые реальные позиции (и не закрывшиеся раньше), закрыть по рынку, сообщить итог.
 * Остались позиции — приложение держит запрос, следующий прогон повторяет.
 */
export async function runCloseAll(
  api: MirrorApi,
  ex: LiveExchange,
  deliver: Deliver = (_kind, send) => send(),
): Promise<{ closed: number; failed: number; errors: string[] }> {
  const items = await api.closeAllClaim();
  let closed = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const item of items) {
    const body = await closeOne(ex, item, "close_all");
    await deliver({ kind: "close", body }, () => api.close(body));
    if (body.status === "closed") closed++;
    else {
      failed++;
      errors.push(`${item.symbol}: ${body.exit.message}`);
    }
  }
  const result = { closed, failed, errors };
  await api.closeAllDone(result);
  return result;
}

/**
 * Режим реальных фьючерсов: One-way — можно входить. Hedge — переключить, только если счёт пуст; иначе входы на
 * фьючерсах пропускаются. Не узнали — null (кандидаты ждут).
 */
export async function ensureOneway(
  ex: LiveExchange,
): Promise<"oneway" | "hedge" | null> {
  try {
    const mode = await ex.positionMode();
    if (mode === "oneway") return mode;
    if (await ex.futuresBusy()) return "hedge";
    await ex.enableOneway();
    return "oneway";
  } catch {
    return null;
  }
}

/** Цена своего стопа с биржи для порогов (spec 0053); 0 или нет — null (приложение возьмёт стоп paper-сделки). */
const positive = (v: number | undefined) =>
  v !== undefined && v > 0 ? v : null;

/** Ордер спота с этими статусами — стоит (стоп защищает позицию). */
const SPOT_ACTIVE = ["NEW", "PENDING_NEW", "PARTIALLY_FILLED"];

/**
 * Сверка «потерянного» входа (pending дольше LIVE_PENDING_STALE_S: воркер упал или итог не дошёл) с биржей по своим
 * clientOrderId. Вход нашёлся и свой стоп стоит — open; стопа нет — unprotected (⚠️, позиция уйдёт в очередь закрытия);
 * входа нет — skipped. null — не прочитали, повтор следующим прогоном.
 */
export async function reconcileEntry(
  ex: LiveExchange,
  item: LiveMirrorState["stalePending"][number],
): Promise<LiveReconcileRequest | null> {
  const ids = tradeClientIds(liveOrderSeed(item.tradeId));
  try {
    if (item.market === "usdm") {
      const entry = await ex.futuresOrder(item.symbol, ids.market);
      if (!entry || entry.executedQty <= 0)
        return {
          tradeId: item.tradeId,
          outcome: "skipped",
          message:
            "Вход не состоялся: своего ордера входа на бирже нет (сверка «потерянного» входа).",
          entryPrice: null,
          quantity: null,
          protectRefs: null,
          stopLoss: null,
        };
      const [stop, take] = [
        await ex.algoOrder(ids.stop),
        await ex.algoOrder(ids.takeProfit),
      ];
      // Свой стоп или тейк уже сработал — позицию закрыла биржа: открыта (закрытие это распознает), а не «без защиты».
      const closedByExchange = algoTriggered(stop) || algoTriggered(take);
      const protectedNow = stop?.algoStatus === "NEW" || closedByExchange;
      return {
        tradeId: item.tradeId,
        outcome: protectedNow ? "open" : "unprotected",
        message: closedByExchange
          ? "Вход найден на бирже, свой стоп или тейк уже сработал — позицию закрыла биржа."
          : protectedNow
            ? "Вход найден на бирже по своему ордеру, свой стоп стоит."
            : "Вход найден на бирже, своего стопа нет — позиция без защиты, закрытие повторяется каждый прогон.",
        entryPrice: entry.avgPrice > 0 ? entry.avgPrice : null,
        quantity: entry.executedQty,
        stopLoss: positive(stop?.triggerPrice),
        protectRefs: {
          market: "usdm",
          entryOrderId: entry.orderId,
          legs: "quantity",
          stop: stop ? { algoId: stop.algoId, clientAlgoId: ids.stop } : null,
          takeProfit: take
            ? { algoId: take.algoId, clientAlgoId: ids.takeProfit }
            : null,
        },
      };
    }
    const working = await ex.spotOrder(item.symbol, ids.working);
    const market = working?.executedQty
      ? null
      : await ex.spotOrder(item.symbol, ids.market);
    const bought = [working, market].find(
      (o) => o !== null && o.executedQty > 0,
    );
    if (!bought)
      return {
        tradeId: item.tradeId,
        outcome: "skipped",
        message:
          "Вход не состоялся: своих исполненных ордеров покупки на бирже нет (сверка «потерянного» входа).",
        entryPrice: null,
        quantity: null,
        protectRefs: null,
        stopLoss: null,
      };
    const stopId = (await ex.spotOrder(item.symbol, ids.stop))
      ? ids.stop
      : ids.protectStop;
    const stop = await ex.spotOrder(item.symbol, stopId);
    const takeId = (await ex.spotOrder(item.symbol, ids.takeProfit))
      ? ids.takeProfit
      : ids.protectTakeProfit;
    const take = await ex.spotOrder(item.symbol, takeId);
    // Свой стоп или тейк уже исполнен — монеты продала биржа: открыта (закрытие распознает «закрыта биржей»), без ⚠️.
    const closedByExchange = [stop, take].some((o) => o?.status === "FILLED");
    const protectedNow =
      closedByExchange || (stop !== null && SPOT_ACTIVE.includes(stop.status));
    return {
      tradeId: item.tradeId,
      outcome: protectedNow ? "open" : "unprotected",
      message: closedByExchange
        ? "Вход найден на бирже, свой стоп или тейк уже исполнен — монеты продала биржа."
        : protectedNow
          ? "Вход найден на бирже по своему ордеру, свой стоп стоит."
          : "Вход найден на бирже, свой стоп не стоит — позиция без защиты, закрытие повторяется каждый прогон.",
      entryPrice: bought.cummulativeQuoteQty / bought.executedQty,
      quantity: bought.executedQty,
      stopLoss: positive(stop?.stopPrice),
      protectRefs: {
        market: "spot",
        orderListId: stop && stop.orderListId >= 0 ? stop.orderListId : null,
        netQuantity: null,
        stop: stop ? { orderId: stop.orderId, clientOrderId: stopId } : null,
        takeProfit: take
          ? { orderId: take.orderId, clientOrderId: takeId }
          : null,
      },
    };
  } catch {
    return null;
  }
}

export interface LiveMirrorRunInput {
  api: MirrorApi;
  ex: LiveExchange;
  now: () => number;
  /** Оценка ключа в этом пульсе: годится — входы и закрытия; нет — только «Закрыть всё» (если ключ принят). */
  verdictOk: boolean;
  /** Binance принимает ключ (не -2015 / 401): «Закрыть всё» можно и при заблокированном ключе. */
  keyAccepted: boolean;
  /** Неотправленные итоги прошлых прогонов — память воркера между прогонами. */
  outbox?: OutboxItem[];
  /** Пауза между попытками отправить итог (в тестах — без ожидания). */
  sleep?: (ms: number) => Promise<void>;
  /** Остановка процесса запрошена (SIGTERM): начатое доделывается, новое — нет. */
  stopRequested?: () => boolean;
  /** Итог не дошёл до приложения после всех попыток — в журнал воркера. */
  onLost?: (item: OutboxItem, error: unknown) => void;
}

export interface LiveMirrorRunSummary {
  closeAll: { closed: number; failed: number; errors: string[] } | null;
  run: MirrorRunResult | null;
  /** Сверенные «потерянные» входы. */
  reconciled: LiveReconcileRequest[];
  /** Досланные итоги прошлых прогонов. */
  flushed: number;
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Один прогон реального зеркала. Состояние приложения не прочитано — исключение: ничего не открывается. */
export async function runLiveMirror(
  input: LiveMirrorRunInput,
): Promise<LiveMirrorRunSummary> {
  const { api, ex } = input;
  const outbox = input.outbox ?? [];
  const deliver = createDeliver(outbox, input.sleep ?? realSleep, input.onLost);
  // Сначала — итоги прошлых прогонов: строки pending получают свои ордера до новых решений.
  const flushed = await flushOutbox(api, outbox);
  const state: LiveMirrorState = await api.state();

  const reconciled: LiveReconcileRequest[] = [];
  if (input.keyAccepted)
    for (const item of state.stalePending) {
      const r = await reconcileEntry(ex, item);
      if (!r) continue;
      reconciled.push(r);
      await deliver({ kind: "reconcile", body: r }, () => api.reconcile(r));
    }

  let closeAll: LiveMirrorRunSummary["closeAll"] = null;
  if (state.halt.closeAllRequested && input.keyAccepted)
    closeAll = await runCloseAll(api, ex, deliver);
  // Ключ не прошёл проверку прав — ни входов, ни закрытий, кроме «Закрыть всё» (AC9).
  if (!input.verdictOk) return { closeAll, run: null, reconciled, flushed };

  const candidates = new Map(state.candidates.map((c) => [c.tradeId, c]));
  const requests = new Map<
    string,
    {
      request: Extract<MirrorDecision, { kind: "open" }>["request"];
      size: EntrySize;
    }
  >();
  const sizes = new Map<string, EntrySize>();
  // Итог закрытия с PnL по исполнениям — между close и saveClose (runMirror передаёт только общие поля).
  const closes = new Map<string, LiveCloseRequest>();
  // Вход → его сделка: open получает только заявку, seed своих clientOrderId — из id paper-сделки.
  const tradeOfRequest = new Map<object, string>();
  const gate = createLiveGate({
    halted: state.halt.stopped,
    openCount: state.active.length,
    dailyPnl: new Map(Object.entries(state.dailyPnl)),
    experimentOf: (tradeId) => candidates.get(tradeId)?.experimentId,
    futuresMode: () => ensureOneway(ex),
    size: async (d) => {
      const rules = await ex.symbolRules(d.request.market, d.request.symbol);
      if (!rules) return { ok: false, minUsd: Number.POSITIVE_INFINITY };
      const size = ex.sizeEntry({
        price: await ex.price(d.request.market, d.request.symbol),
        rules,
        targetUsd: LIVE.notionalUsd,
        maxUsd: LIVE.maxNotionalUsd,
        spotStop: d.request.market === "spot" ? d.request.stopLoss : null,
      });
      sizes.set(d.tradeId, size);
      return size;
    },
    freeUsd: async (market) => (await ex.balances())[market],
    spotSlippage: ex.spotSlippage,
  });

  const run = await runMirror({
    now: input.now,
    configured: true,
    policy: LIVE_MIRROR_POLICY,
    stopRequested: input.stopRequested,
    listCandidates: async () => state.candidates,
    activeMirrors: async () =>
      state.active.map((a) => ({
        market: a.market,
        symbol: a.symbol,
        direction: a.direction,
        hasRefs: true,
      })),
    positionMode: async () => (await ensureOneway(ex)) ?? "oneway",
    hasSymbol: async (market, symbol) =>
      (await ex.symbolRules(market, symbol)) !== null,
    freeUsd: async (market) => (await ex.balances())[market],
    gate: {
      check: async (d) => {
        const r = await gate.check(d);
        if (r?.kind === "open") {
          tradeOfRequest.set(r.request, r.tradeId);
          const size = sizes.get(r.tradeId);
          if (size) requests.set(r.tradeId, { request: r.request, size });
        }
        return r;
      },
      spend: (d) => gate.spend(d),
    },
    // Пропуск пишется одной вставкой в markSkipped; вход — атомарный захват в БД (стоп перепроверяется там же).
    claim: async (tradeId, kind) =>
      kind === "skip" ? true : (await api.claim(tradeId)).claimed,
    open: (req) => {
      const tradeId = tradeOfRequest.get(req);
      if (!tradeId) throw new Error("вход без сделки — так не бывает");
      return ex.placeTrade(req, liveOrderSeed(tradeId));
    },
    markSkipped: async (tradeId, reason) => {
      await api.skip(tradeId, reason);
    },
    saveOpen: async (tradeId, r) => {
      const sent = requests.get(tradeId);
      const size = sent?.size;
      const body: LiveOpenRequest = {
        tradeId,
        result: {
          id: r.id,
          status: r.status,
          message: r.message,
          entryPrice: r.entryPrice,
          filledQuantity: r.filledQuantity,
          steps: r.steps,
          protectRefs: r.protectRefs ?? null,
        },
        order: {
          stopLoss: sent?.request.stopLoss ?? 0,
          takeProfit: sent?.request.stopOnly
            ? null
            : (sent?.request.takeProfit ?? null),
          notionalUsd:
            r.entryPrice !== null && r.filledQuantity !== null
              ? r.entryPrice * r.filledQuantity
              : size?.ok
                ? size.notionalUsd
                : 0,
          raised: size?.ok ? size.raised : null,
        },
      };
      // Ордер на бирже уже прошёл: итог не теряем — повторы, иначе outbox до следующего прогона.
      await deliver({ kind: "open", body }, () => api.open(body));
    },
    sweepLegs: async (overBudget) => {
      const swept = await ex.sweepLegs(state.openLegs, overBudget);
      if (!swept.length) return [];
      const items: LiveLegsRequest["items"] = [];
      for (const m of swept) {
        const active = state.active.find((a) => a.tradeId === m.tradeId);
        const fills =
          m.status === "closed" && active
            ? await exitByFills(
                ex,
                {
                  tradeId: m.tradeId,
                  market: "usdm",
                  symbol: m.symbol,
                  direction: active.direction,
                  entryPrice: active.entryPrice,
                  quantity: active.quantity ?? 0,
                  stopLoss: active.stopLoss,
                },
                m.exitPrice,
              )
            : null;
        items.push({
          tradeId: m.tradeId,
          outcome: m.status,
          exit: {
            message: fills?.note ? `${m.message} ${fills.note}` : m.message,
            steps: m.steps,
            exitPrice: fills?.exitPrice ?? m.exitPrice,
            feesUsd: fills?.feesUsd ?? null,
            realizedPnl: fills?.realizedPnl ?? null,
            pnlEstimated: fills?.pnlEstimated ?? false,
            leftover: fills?.leftover ?? null,
            closedBy: m.closedBy === "stop" ? "sl" : "tp",
          },
        });
      }
      const body = { items };
      await deliver({ kind: "legs", body }, () => api.legs(body));
      return swept
        .filter((m) => m.status === "closed")
        .map((m) => ({ tradeId: m.tradeId, symbol: m.symbol }));
    },
    listToClose: async () => state.toClose,
    claimToClose: (tradeId) => api.claimClose(tradeId),
    close: async (item) => {
      const body = await closeOne(ex, item, "mirror");
      closes.set(item.tradeId, body);
      return {
        status: body.status,
        message: body.exit.message,
        steps: body.exit.steps,
        exitPrice: body.exit.exitPrice,
      };
    },
    saveClose: async (tradeId) => {
      const body = closes.get(tradeId);
      if (body) await deliver({ kind: "close", body }, () => api.close(body));
    },
  });
  return { closeAll, run, reconciled, flushed };
}
