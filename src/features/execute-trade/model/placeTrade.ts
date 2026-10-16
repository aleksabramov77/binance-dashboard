import { randomUUID } from "node:crypto";
import type { TradeRequest, TradeResult, TradeStep } from "@/entities/trade";
import {
  type DemoProtectRefs,
  demoSpotBuyProtected,
  demoSpotCancelByClientId,
  demoSpotMarketOrder,
  demoSpotOcoSell,
  demoSpotStopLossSell,
  fetchDemoPrice,
  fetchDemoSpotOrderByClientId,
  fetchDemoSpotOrderStatus,
  fetchDemoSymbolRules,
  fetchDemoUsdtBalances,
  orderErrorOutcome,
  type SpotEntryListResult,
  type SpotOrderQuery,
  type SymbolRules,
  unknownOutcomeDeadline,
} from "@/shared/api/binance/demo.server";
import type { TradeVenue } from "@/shared/api/binance/venue.server";
import { log } from "@/shared/lib/logger.server";
import { SPOT_TAKER_FEE } from "../config/spot";
import { TRADE_DEADLINE_MS } from "../config/trade";
import { averagePrice } from "../lib/closePlan";
import {
  chooseSpotEntry,
  pendingOutcome,
  spotEntryFromQuery,
  spotEntryLimitPrice,
  tradeClientIds,
} from "../lib/spotEntry";
import {
  afterEntryError,
  afterPending,
  afterProtect,
  afterSell,
  afterSpotBuy,
  afterSpotRecheck,
  afterStopLost,
  afterTakeProfitCancel,
  type OrderFailure,
} from "../lib/tradeOutcome";
import {
  floorToStep,
  spotSellQuantity,
  type ValidatedTrade,
  validateTrade,
} from "../lib/validateTrade";
import { placeFutures } from "./placeFutures";
import {
  type Done,
  errorText,
  type Finish,
  type RefsHolder,
  recheckUntil,
  sleep,
} from "./tradeSteps";
import { demoTradeContext, type TradeVenueContext } from "./tradeVenue";

/**
 * Исполняет сделку в Binance Demo Trading: спот — покупка и TP/SL одной заявкой OTOCO/OTO,
 * фьючерсы — вход по рынку и сразу algo TP/SL (стоп не встал — позиция закрывается по рынку).
 * Позиция без стопа не остаётся, кроме случаев, когда и откат не удался (unprotected — тревога).
 * Площадка — ctx (spec 0049): по умолчанию Binance Demo из env; реальный счёт передаёт только воркер реального
 * счёта (его клиент пропускает лишь белый список запросов).
 */
export async function placeTrade(
  req: TradeRequest,
  ctx: TradeVenueContext | null = demoTradeContext(),
  opts: {
    /**
     * Id попытки (основа своих clientOrderId, `bd<id>-…`). Реальный счёт передаёт детерминированный id из paper-сделки
     * (spec 0049): «потерянный» вход находится на бирже по строке. Демо — случайный, как раньше.
     */
    tradeId?: string;
  } = {},
): Promise<TradeResult> {
  const steps: TradeStep[] = [];
  const tradeDeadline = Date.now() + TRADE_DEADLINE_MS;
  const base = {
    id: opts.tradeId ?? randomUUID(),
    at: new Date().toISOString(),
    environment: ctx?.venue.kind ?? ("demo" as const),
    request: req,
  };
  // Свои защитные ордера (PR 2b) — заполняются по ходу сделки; у rejected позиции нет — и ссылок нет.
  const refs: RefsHolder = { current: null };
  const finish: Finish = (
    status,
    message,
    entryPrice = null,
    filledQuantity = null,
  ) => {
    const result: TradeResult = {
      ...base,
      status,
      message,
      entryPrice,
      filledQuantity,
      steps,
      protectRefs: status === "rejected" ? null : refs.current,
    };
    const logData = {
      tradeId: base.id,
      symbol: req.symbol,
      market: req.market,
      direction: req.direction,
      quantity: req.quantity,
      stopLoss: req.stopLoss,
      takeProfit: req.takeProfit,
      leverage: req.leverage,
      entryPrice,
      filledQuantity,
      protectRefs: result.protectRefs,
      steps,
    };
    if (status === "protected")
      log.info("trade.done", `${req.symbol}: ${message}`, logData);
    else if (status === "unprotected")
      log.error("trade.unprotected", `${req.symbol}: ${message}`, logData);
    else log.warn("trade.rejected", `${req.symbol}: ${message}`, logData);
    // История сделок читается с демо-счёта Binance, локально ничего не пишем.
    return result;
  };

  const done: Done = (o, entryPrice, filled) =>
    finish(
      o.status,
      o.message,
      o.withEntry ? (entryPrice ?? null) : null,
      o.withEntry ? (filled ?? null) : null,
    );

  if (!ctx)
    return finish(
      "rejected",
      "Ключ Demo Trading не настроен (BINANCE_DEMO_API_KEY / SECRET).",
    );
  const { venue } = ctx;
  const where = venue.kind === "demo" ? "Binance Demo" : "Binance";

  let rules: Awaited<ReturnType<typeof fetchDemoSymbolRules>>;
  let price: number;
  let availableUsd: number;
  try {
    rules = await fetchDemoSymbolRules(req.market, req.symbol, venue);
    if (!rules)
      return finish(
        "rejected",
        `${req.symbol} нет в ${venue.kind === "demo" ? "Binance Demo Trading" : "Binance"} (${req.market === "spot" ? "Spot" : "Futures"}).`,
      );
    const [demoPrice, balances] = await Promise.all([
      fetchDemoPrice(req.market, req.symbol, venue),
      fetchDemoUsdtBalances(venue),
    ]);
    price = demoPrice;
    availableUsd = balances[req.market];
  } catch (error) {
    // Сеть, а не отсутствие символа: ничего не отправлено, можно повторить.
    return finish(
      "rejected",
      `Не удалось получить данные ${where} — сделка не отправлена, попробуйте ещё раз. ${errorText(error)}`,
    );
  }

  const checked = validateTrade(req, {
    price,
    rules,
    maxNotionalUsd: ctx.maxNotionalUsd,
    availableUsd,
    maxRiskPct: ctx.maxRiskPct,
  });
  if (!checked.ok) return finish("rejected", checked.errors.join(" "));
  const v = checked.value;

  for (const detail of v.adjustments)
    steps.push({ label: "Фильтр цены биржи", ok: true, detail });

  if (req.market === "spot")
    return placeSpot({
      venue,
      req,
      v,
      rules,
      price,
      ids: tradeClientIds(base.id),
      refs,
      steps,
      done,
      tradeDeadline,
    });

  return placeFutures({
    venue,
    req,
    v,
    rules,
    price,
    tradeId: base.id,
    refs,
    steps,
    finish,
    done,
    tradeDeadline,
    autoHedge: ctx.autoHedge,
  });
}

interface SpotContext {
  venue: TradeVenue;
  req: TradeRequest;
  v: ValidatedTrade;
  rules: SymbolRules;
  price: number;
  /** Свои clientOrderId заявки — чтобы перечитать её, если исход неизвестен. */
  ids: ReturnType<typeof tradeClientIds>;
  /** Свои стоп/тейк — для закрытия (PR 2b). */
  refs: RefsHolder;
  steps: TradeStep[];
  done: Done;
  /** Общий срок сделки (config/trade → TRADE_DEADLINE_MS). */
  tradeDeadline: number;
}

/** Перечитать статусы отложенных ордеров: сразу после входа они PENDING_NEW. */
const PENDING_CHECK_DELAYS_MS = [300, 700, 1500];

/**
 * Перечитать ордер спота по своему clientOrderId после ответа с неизвестным исходом; null —
 * ордера нет и при проверке после дедлайна (заявка до движка не дошла).
 */
const recheckSpotOrder = (
  venue: TradeVenue,
  symbol: string,
  clientOrderId: string,
  deadline: number,
  tradeDeadline: number,
) =>
  recheckUntil(
    deadline,
    tradeDeadline,
    () => fetchDemoSpotOrderByClientId(venue, symbol, clientOrderId),
    (order) => order !== null,
  );

/**
 * Спот, исход OTO/OTOCO неизвестен: перечитать рабочий и отложенные ордера по своим id.
 * missing — заявки на бирже нет; error — перечитать не удалось.
 */
async function recheckSpotList(
  c: SpotContext,
  withTakeProfit: boolean,
  deadline: number,
): Promise<SpotEntryListResult | "missing" | "error"> {
  const { venue, req, ids, steps } = c;
  const label = "Проверка заявки на бирже";
  try {
    const working = await recheckSpotOrder(
      venue,
      req.symbol,
      ids.working,
      deadline,
      c.tradeDeadline,
    );
    if (!working) {
      steps.push({
        label,
        ok: true,
        detail: `Заявки ${ids.list} на бирже нет`,
      });
      return "missing";
    }
    const pendingIds = withTakeProfit ? [ids.stop, ids.takeProfit] : [ids.stop];
    const pending = await Promise.all(
      pendingIds.map((id) =>
        fetchDemoSpotOrderByClientId(venue, req.symbol, id),
      ),
    );
    steps.push({
      label,
      ok: true,
      detail: `Покупка ${working.status}, куплено ${working.executedQty}, список #${working.orderListId}`,
    });
    return spotEntryFromQuery(
      working,
      pending.filter((p) => p !== null),
    );
  } catch (error) {
    steps.push({ label, ok: false, detail: errorText(error) });
    return "error";
  }
}

/**
 * Спот (spec 0012, AC4): покупка и защита одной заявкой OTOCO/OTO — стоп за фильтром биржи
 * отклоняет всю заявку, монеты не покупаются. Если составные заявки по символу запрещены — по-старому.
 */
async function placeSpot(c: SpotContext): Promise<TradeResult> {
  const { venue, req, v, rules, price, ids, steps, done } = c;
  const mode = chooseSpotEntry(rules, req.stopOnly === true);
  if (mode === "market") return placeSpotMarket(c);

  const limitPrice = spotEntryLimitPrice(price, rules.tickSize);
  const sellQty = spotSellQuantity(v.quantity, rules.stepSize);
  const label =
    mode === "otoco"
      ? "OTOCO: покупка + тейк + стоп"
      : "OTO: покупка + стоп (без тейка)";
  let list: SpotEntryListResult;
  const sentAt = Date.now();
  try {
    list = await demoSpotBuyProtected(venue, {
      symbol: req.symbol,
      quantity: v.quantity,
      limitPrice,
      sellQuantity: sellQty,
      stopLoss: v.stopLoss,
      takeProfit: mode === "otoco" ? v.takeProfit : null,
      clientIds: ids,
    });
  } catch (error) {
    steps.push({ label, ok: false, detail: errorText(error) });
    const failed = afterEntryError(orderErrorOutcome(error), "spotList");
    if (failed !== "recheck") return done(failed);
    // Исход неизвестен (-1007, 5xx, сеть): перечитываем заявку по своему clientOrderId.
    const rechecked = afterSpotRecheck(
      await recheckSpotList(
        c,
        mode === "otoco",
        unknownOutcomeDeadline(sentAt, Date.now()),
      ),
    );
    if (!("found" in rechecked)) return done(rechecked);
    list = rechecked.found;
  }
  c.refs.current = spotListRefs(list, ids, mode === "otoco");
  const net = list.filled - list.baseCommission;

  const filled = list.filled;
  const entryPrice = filled > 0 ? averagePrice(list.quoteQty, filled) : price;
  const bought = afterSpotBuy(list.workingStatus, filled, "spotList");
  if (bought !== "filled") {
    steps.push({
      label,
      ok: false,
      detail: `Покупка не исполнилась целиком по цене до ${limitPrice} (FOK: ${list.workingStatus}, куплено ${filled}), список #${list.orderListId}`,
    });
    // FOK не исполняется частично; если всё же куплено — защищаем купленное отдельно.
    if (bought !== "partial") return done(bought);
    return protectOrSell(c, {
      sellQty: floorToStep(net, rules.stepSize),
      net,
      entryPrice,
      filled,
    });
  }
  steps.push({
    label,
    ok: true,
    detail: `${filled} по ~${entryPrice.toPrecision(6)}; ${mode === "otoco" ? `TP ${v.takeProfit} / ` : ""}SL ${v.stopLoss} на ${sellQty}, список #${list.orderListId}`,
  });

  let pending = pendingOutcome(list.pending);
  try {
    for (const delay of PENDING_CHECK_DELAYS_MS) {
      if (pending !== "waiting") break;
      await sleep(delay);
      const statuses = await Promise.all(
        list.pending.map(async (p) => ({
          type: p.type,
          status: await fetchDemoSpotOrderStatus(venue, req.symbol, p.orderId),
        })),
      );
      pending = pendingOutcome(statuses);
    }
  } catch (error) {
    steps.push({
      label: "Проверка стопа",
      ok: false,
      detail: errorText(error),
    });
  }
  if (pending === "waiting")
    steps.push({
      label: "Проверка стопа",
      ok: false,
      detail: "Биржа ещё не подтвердила стоп после покупки",
    });
  else if (pending === "stopOnly")
    steps.push({
      label: "Проверка стопа",
      ok: true,
      detail: "Стоп стоит, тейк снят биржей",
    });
  else if (pending === "failed")
    steps.push({
      label: "Проверка стопа",
      ok: false,
      detail: "Биржа сняла стоп после покупки",
    });
  const afterList = afterPending(pending, req.stopOnly === true);
  if (afterList !== "protect") return done(afterList, entryPrice, filled);
  // Стоп снят, а свой тейк того же OTOCO может стоять и держать монеты — снять его адресно.
  let soldByTakeProfit = 0;
  if (mode === "otoco") {
    const label = "Снять свой тейк";
    try {
      const tp = await fetchDemoSpotOrderByClientId(
        venue,
        req.symbol,
        ids.takeProfit,
      );
      const next = afterStopLost(tp);
      if (typeof next !== "string") {
        steps.push({ label, ok: true, detail: "Тейк уже исполнен" });
        return done(next, entryPrice, filled);
      }
      if (next === "cancelTakeProfit") {
        const cancelled = await demoSpotCancelByClientId(
          venue,
          req.symbol,
          ids.takeProfit,
        );
        steps.push({
          label,
          ok: cancelled,
          detail: cancelled
            ? `Тейк ${ids.takeProfit} снят`
            : `Тейк ${ids.takeProfit} уже не активен`,
        });
        const afterCancel = afterTakeProfitCancel(cancelled);
        if (afterCancel !== "protect")
          return done(afterCancel, entryPrice, filled);
        soldByTakeProfit = tp?.executedQty ?? 0;
      }
    } catch (error) {
      // Не прочитали/не сняли тейк — он мог исполниться: без продажи и перезащиты.
      steps.push({ label, ok: false, detail: errorText(error) });
      const notCancelled = afterTakeProfitCancel(false);
      if (notCancelled !== "protect")
        return done(notCancelled, entryPrice, filled);
    }
  }
  return protectOrSell(c, {
    sellQty: floorToStep(net - soldByTakeProfit, rules.stepSize),
    net: net - soldByTakeProfit,
    entryPrice,
    filled,
  });
}

/** Ссылки на стоп/тейк заявки OTO/OTOCO: id из ответа (или перечитанной заявки) и свои clientOrderId. */
function spotListRefs(
  list: SpotEntryListResult,
  ids: ReturnType<typeof tradeClientIds>,
  withTakeProfit: boolean,
): DemoProtectRefs {
  const stop = list.pending.find((p) => p.type.startsWith("STOP_LOSS"));
  const tp = list.pending.find((p) => !p.type.startsWith("STOP_LOSS"));
  return {
    market: "spot",
    orderListId: list.orderListId,
    netQuantity: list.filled - list.baseCommission,
    stop: { orderId: stop?.orderId ?? null, clientOrderId: ids.stop },
    takeProfit: withTakeProfit
      ? { orderId: tp?.orderId ?? null, clientOrderId: ids.takeProfit }
      : null,
  };
}

/** Спот без составных заявок: покупка по рынку, затем защита (при её отказе — продажа). */
async function placeSpotMarket(c: SpotContext): Promise<TradeResult> {
  const { venue, req, v, rules, price, ids, steps, done } = c;
  const label = "Покупка по рынку";
  let filled: number;
  let quoteQty: number;
  let fee: number;
  let status: string;
  const sentAt = Date.now();
  try {
    const order = await demoSpotMarketOrder(
      venue,
      req.symbol,
      "BUY",
      v.quantity,
      ids.market,
    );
    filled = order.executedQty;
    quoteQty = order.cummulativeQuoteQty;
    status = order.status;
    // Комиссия в базовом активе уменьшает то, что можно продать.
    const baseAsset = req.symbol.replace(/USDT$/, "");
    fee = order.fills
      .filter((f) => f.commissionAsset === baseAsset)
      .reduce((s, f) => s + f.commission, 0);
    steps.push({
      label,
      ok: true,
      detail: `${filled} по ~${(filled > 0 ? quoteQty / filled : price).toPrecision(6)}, ордер #${order.orderId}`,
    });
  } catch (error) {
    steps.push({ label, ok: false, detail: errorText(error) });
    const failed = afterEntryError(orderErrorOutcome(error), "spotMarket");
    if (failed !== "recheck") return done(failed);
    // Исход неизвестен: перечитываем ордер по своему clientOrderId.
    const recheckLabel = "Проверка ордера на бирже";
    let order: SpotOrderQuery | "missing" | "error";
    try {
      order =
        (await recheckSpotOrder(
          venue,
          req.symbol,
          ids.market,
          unknownOutcomeDeadline(sentAt, Date.now()),
          c.tradeDeadline,
        )) ?? "missing";
    } catch (checkError) {
      steps.push({
        label: recheckLabel,
        ok: false,
        detail: errorText(checkError),
      });
      order = "error";
    }
    if (order === "missing")
      steps.push({
        label: recheckLabel,
        ok: true,
        detail: "Ордера на бирже нет",
      });
    const rechecked = afterSpotRecheck(order);
    if (!("found" in rechecked)) return done(rechecked);
    order = rechecked.found;
    steps.push({
      label: recheckLabel,
      ok: true,
      detail: `${order.status}, куплено ${order.executedQty}, ордер #${order.orderId}`,
    });
    filled = order.executedQty;
    quoteQty = order.cummulativeQuoteQty;
    status = order.status;
    // GET /api/v3/order не отдаёт комиссию — берём ставку демо-спота.
    fee = filled * SPOT_TAKER_FEE;
  }
  const bought = afterSpotBuy(status, filled, "spotMarket");
  if (bought !== "filled" && bought !== "partial") return done(bought);
  const entryPrice = filled > 0 ? averagePrice(quoteQty, filled) : price;
  return protectOrSell(c, {
    sellQty: floorToStep(filled - fee, rules.stepSize),
    net: filled - fee,
    entryPrice,
    filled,
  });
}

/**
 * Защита уже купленного: стоп (stopOnly) или OCO. Биржа отказала — продаём купленное по рынку,
 * сделка не открылась (rejected без цены входа). Исход неизвестен (сеть, -1007, 5xx) — стоп мог
 * встать: unprotected.
 */
async function protectOrSell(
  c: SpotContext,
  bought: {
    sellQty: string;
    /** Своих монет на балансе (купленное − комиссия − проданное тейком) — объём закрытия. */
    net: number;
    entryPrice: number;
    filled: number;
  },
): Promise<TradeResult> {
  const { venue, req, v, ids, steps, done } = c;
  const { sellQty, entryPrice, filled } = bought;
  const protectLabel = req.stopOnly ? "Стоп" : "OCO: тейк + стоп";
  // Свои id отдельной защиты: даже при неизвестном исходе закрытие найдёт стоп по clientOrderId.
  const own: Extract<DemoProtectRefs, { market: "spot" }> = {
    market: "spot",
    orderListId: null,
    netQuantity: bought.net,
    stop: { orderId: null, clientOrderId: ids.protectStop },
    takeProfit: req.stopOnly
      ? null
      : { orderId: null, clientOrderId: ids.protectTakeProfit },
  };
  c.refs.current = own;
  let result: "placed" | OrderFailure;
  try {
    if (req.stopOnly) {
      const stop = await demoSpotStopLossSell(
        venue,
        req.symbol,
        sellQty,
        v.stopLoss,
        ids.protectStop,
      );
      own.stop = { orderId: stop.orderId, clientOrderId: ids.protectStop };
      steps.push({
        label: protectLabel,
        ok: true,
        detail: `SL ${v.stopLoss} на ${sellQty}, без тейка, ордер #${stop.orderId}`,
      });
    } else {
      const oco = await demoSpotOcoSell(
        venue,
        req.symbol,
        sellQty,
        v.takeProfit,
        v.stopLoss,
        {
          list: ids.protectList,
          stop: ids.protectStop,
          takeProfit: ids.protectTakeProfit,
        },
      );
      own.orderListId = oco.orderListId;
      const idOf = (clientOrderId: string) =>
        oco.orders.find((o) => o.clientOrderId === clientOrderId)?.orderId ??
        null;
      own.stop = {
        orderId: idOf(ids.protectStop),
        clientOrderId: ids.protectStop,
      };
      if (own.takeProfit)
        own.takeProfit = {
          orderId: idOf(ids.protectTakeProfit),
          clientOrderId: ids.protectTakeProfit,
        };
      steps.push({
        label: protectLabel,
        ok: true,
        detail: `TP ${v.takeProfit} / SL ${v.stopLoss} на ${sellQty}, список #${oco.orderListId}`,
      });
    }
    result = "placed";
  } catch (error) {
    steps.push({ label: protectLabel, ok: false, detail: errorText(error) });
    result = orderErrorOutcome(error);
  }
  const afterProtection = afterProtect(result, req.stopOnly === true);
  if (afterProtection !== "sell")
    return done(afterProtection, entryPrice, filled);

  const sellLabel = "Продажа по рынку (стоп не встал)";
  let sold = false;
  try {
    const order = await demoSpotMarketOrder(
      venue,
      req.symbol,
      "SELL",
      sellQty,
      c.ids.close,
    );
    sold = true;
    steps.push({
      label: sellLabel,
      ok: true,
      detail: `${order.executedQty} на $${order.cummulativeQuoteQty.toFixed(2)}, ордер #${order.orderId}`,
    });
  } catch (error) {
    steps.push({ label: sellLabel, ok: false, detail: errorText(error) });
  }
  return done(afterSell(sold), entryPrice, filled);
}
