import { randomUUID } from "node:crypto";
import {
  MAX_RISK_PCT,
  type TradeRequest,
  type TradeResult,
  type TradeStep,
} from "@/entities/trade";
import {
  type AlgoOrderQuery,
  BinanceApiError,
  type DemoProtectRefs,
  demoCancelAllOrders,
  demoFuturesCloseAt,
  demoFuturesMarketOrder,
  demoFuturesPosition,
  demoFuturesPrepare,
  demoFuturesReduceMarket,
  demoSpotBuyProtected,
  demoSpotCancelByClientId,
  demoSpotMarketOrder,
  demoSpotOcoSell,
  demoSpotStopLossSell,
  type FuturesOrder,
  fetchDemoAlgoOrder,
  fetchDemoFuturesOrder,
  fetchDemoOpenSymbols,
  fetchDemoPrice,
  fetchDemoSpotOrderByClientId,
  fetchDemoSpotOrderStatus,
  fetchDemoSymbolRules,
  fetchDemoUsdtBalances,
  nextRecheckDelay,
  orderErrorOutcome,
  type SpotEntryListResult,
  type SpotOrderQuery,
  type SymbolRules,
  unknownOutcomeDeadline,
} from "@/shared/api/binance/demo.server";
import type { BinanceCredentials } from "@/shared/config/env.server";
import { getDemoTradingConfig } from "@/shared/config/env.server";
import { log } from "@/shared/lib/logger.server";
import { SPOT_TAKER_FEE } from "../config/spot";
import {
  afterAlgoUnknown,
  averagePrice,
  type StoredAlgoRef,
} from "../lib/closePlan";
import {
  chooseSpotEntry,
  pendingOutcome,
  spotEntryFromQuery,
  spotEntryLimitPrice,
  tradeClientIds,
} from "../lib/spotEntry";
import {
  afterEntryError,
  afterFuturesOrderCheck,
  afterFuturesPositionCheck,
  afterFuturesRollback,
  afterFuturesStop,
  afterFuturesTakeProfit,
  afterPending,
  afterProtect,
  afterSell,
  afterSpotBuy,
  afterSpotRecheck,
  afterStopLost,
  afterTakeProfitCancel,
  type OrderFailure,
  type TradeOutcome,
} from "../lib/tradeOutcome";
import {
  floorToStep,
  spotSellQuantity,
  type ValidatedTrade,
  validateTrade,
} from "../lib/validateTrade";
import { futuresFillPrice } from "./futuresFillPrice";

/**
 * Позиция ещё не видна сразу после входа — повторяем: -4509 у closePosition (TP/SL),
 * -2022 у reduceOnly (закрытие по рынку).
 */
const POSITION_RETRY_DELAYS_MS = [1000, 2000];
const POSITION_NOT_READY = [-4509, -2022];

async function withPositionRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (const delay of POSITION_RETRY_DELAYS_MS) {
    try {
      return await fn();
    } catch (error) {
      if (
        !(
          error instanceof BinanceApiError &&
          POSITION_NOT_READY.includes(error.code ?? 0)
        )
      )
        throw error;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return fn();
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

type Finish = (
  status: TradeResult["status"],
  message: string,
  entryPrice?: number | null,
  filledQuantity?: number | null,
) => TradeResult;

/** Свои защитные ордера сделки (PR 2b): заполняются по ходу, уходят в TradeResult.protectRefs. */
interface RefsHolder {
  current: DemoProtectRefs | null;
}

/** Завершить сделку выбранным исходом (lib/tradeOutcome); цена и объём — только если позиция есть. */
type Done = (
  o: TradeOutcome,
  entryPrice?: number,
  filled?: number,
) => TradeResult;

/**
 * Исполняет сделку в Binance Demo Trading: спот — покупка и TP/SL одной заявкой OTOCO/OTO,
 * фьючерсы — вход по рынку и сразу algo TP/SL (стоп не встал — позиция закрывается по рынку).
 * Позиция без стопа не остаётся, кроме случаев, когда и откат не удался (unprotected — тревога).
 * Боевой режим здесь не поддерживается намеренно — только демо-хосты.
 */
export async function placeTrade(req: TradeRequest): Promise<TradeResult> {
  const steps: TradeStep[] = [];
  const base = {
    id: randomUUID(),
    at: new Date().toISOString(),
    environment: "demo" as const,
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

  const config = getDemoTradingConfig();
  if (!config)
    return finish(
      "rejected",
      "Ключ Demo Trading не настроен (BINANCE_DEMO_API_KEY / SECRET).",
    );
  const creds = config.credentials;

  let rules: Awaited<ReturnType<typeof fetchDemoSymbolRules>>;
  let price: number;
  let availableUsd: number;
  try {
    rules = await fetchDemoSymbolRules(req.market, req.symbol);
    if (!rules)
      return finish(
        "rejected",
        `${req.symbol} нет в Binance Demo Trading (${req.market === "spot" ? "Spot" : "Futures"}).`,
      );
    const [demoPrice, balances] = await Promise.all([
      fetchDemoPrice(req.market, req.symbol),
      fetchDemoUsdtBalances(creds),
    ]);
    price = demoPrice;
    availableUsd = balances[req.market];
  } catch (error) {
    // Сеть, а не отсутствие символа: ничего не отправлено, можно повторить.
    return finish(
      "rejected",
      `Не удалось получить данные Binance Demo — сделка не отправлена, попробуйте ещё раз. ${errorText(error)}`,
    );
  }

  const checked = validateTrade(req, {
    price,
    rules,
    maxNotionalUsd: config.maxNotionalUsd,
    availableUsd,
    maxRiskPct: MAX_RISK_PCT,
  });
  if (!checked.ok) return finish("rejected", checked.errors.join(" "));
  const v = checked.value;
  const entrySide = req.direction === "long" ? "BUY" : "SELL";
  const exitSide: "BUY" | "SELL" = req.direction === "long" ? "SELL" : "BUY";

  for (const detail of v.adjustments)
    steps.push({ label: "Фильтр цены биржи", ok: true, detail });

  if (req.market === "spot")
    return placeSpot({
      creds,
      req,
      v,
      rules,
      price,
      ids: tradeClientIds(base.id),
      refs,
      steps,
      done,
    });

  // Binance не меняет маржу, пока по символу висят ордера (-4067), а второй вход
  // перезаписал бы TP/SL первого (closePosition). Поэтому повторный вход не пускаем.
  try {
    const open = await fetchDemoOpenSymbols(creds, req.symbol);
    if (open.usdm.includes(req.symbol))
      return finish(
        "rejected",
        `По ${req.symbol} уже есть позиция или ордера на демо-фьючерсах — сначала закройте их на demo.binance.com.`,
      );
  } catch (error) {
    return finish(
      "rejected",
      `Не удалось проверить открытые позиции — сделка не отправлена, попробуйте ещё раз. ${errorText(error)}`,
    );
  }

  try {
    await demoFuturesPrepare(creds, req.symbol, req.leverage);
    steps.push({
      label: "Маржа и плечо",
      ok: true,
      detail: `Изолированная, ×${req.leverage}`,
    });
  } catch (error) {
    steps.push({ label: "Маржа и плечо", ok: false, detail: errorText(error) });
    return finish(
      "rejected",
      "Не удалось настроить маржу/плечо — вход не отправлялся.",
    );
  }

  const entryLabel = `${req.direction === "long" ? "Лонг" : "Шорт"} по рынку`;
  const ids = tradeClientIds(base.id);
  let entryPrice: number;
  let filled: number;
  let entryOrderId: number | null = null;
  const sentAt = Date.now();
  try {
    const order = await demoFuturesMarketOrder(
      creds,
      req.symbol,
      entrySide,
      v.quantity,
      ids.market,
    );
    entryOrderId = order.orderId;
    filled = order.executedQty || Number(v.quantity);
    entryPrice =
      order.avgPrice ||
      (await futuresFillPrice(creds, req.symbol, order.orderId)) ||
      price;
    steps.push({
      label: entryLabel,
      ok: true,
      detail: `${filled} по ~${entryPrice}, ордер #${order.orderId}`,
    });
  } catch (error) {
    const failed = afterEntryError(orderErrorOutcome(error), "futures");
    if (failed !== "recheck") {
      steps.push({ label: entryLabel, ok: false, detail: errorText(error) });
      return done(failed);
    }
    // Исход неизвестен (-1007, 5xx, обрыв сети): сверяем свой ордер по clientOrderId, затем позицию.
    steps.push({
      label: entryLabel,
      ok: false,
      detail: `${errorText(error)} — проверяю ордер ${ids.market} на бирже`,
    });
    const deadline = unknownOutcomeDeadline(sentAt, Date.now());
    let order: FuturesOrder | null | "error";
    try {
      order = await recheckUntil(
        deadline,
        () =>
          fetchDemoFuturesOrder(creds, req.symbol, {
            clientOrderId: ids.market,
          }),
        (o) => o !== null && o.executedQty > 0,
      );
    } catch (checkError) {
      steps.push({
        label: "Проверка ордера",
        ok: false,
        detail: errorText(checkError),
      });
      order = "error";
    }
    const byOrder = afterFuturesOrderCheck(order);
    if (byOrder !== "checkPosition" && !("filled" in byOrder)) {
      steps.push({
        label: "Проверка ордера",
        ok: true,
        detail: byOrder.message,
      });
      return done(byOrder);
    }
    if (byOrder !== "checkPosition") {
      const o = byOrder.filled;
      entryOrderId = o.orderId;
      filled = o.executedQty;
      entryPrice =
        o.avgPrice ||
        (await futuresFillPrice(creds, req.symbol, o.orderId)) ||
        price;
      steps.push({
        label: "Проверка ордера",
        ok: true,
        detail: `${o.status}: ${filled} по ~${entryPrice}, ордер #${o.orderId} — ставлю защиту`,
      });
    } else {
      let position: { amount: number; entryPrice: number } | null = null;
      try {
        position = await recheckUntil(
          deadline,
          () => demoFuturesPosition(creds, req.symbol),
          (p) => p.amount !== 0,
        );
      } catch (checkError) {
        steps.push({
          label: "Проверка позиции",
          ok: false,
          detail: errorText(checkError),
        });
      }
      const checked = afterFuturesPositionCheck(position);
      if (!("protect" in checked)) {
        if (position)
          steps.push({
            label: "Проверка позиции",
            ok: true,
            detail: "Позиции нет",
          });
        return done(checked);
      }
      filled = Math.abs(checked.protect.amount);
      entryPrice = checked.protect.entryPrice || price;
      steps.push({
        label: "Проверка позиции",
        ok: true,
        detail: `Позиция открыта: ${checked.protect.amount} по ${entryPrice} — ставлю защиту`,
      });
    }
  }
  const futuresRefs = {
    market: "usdm" as const,
    entryOrderId,
    stop: null as StoredAlgoRef | null,
    takeProfit: null as StoredAlgoRef | null,
  };
  refs.current = futuresRefs;

  // Сначала стоп: не встал — позиция без защиты не остаётся, сразу закрываем её по рынку (AC5).
  const algoCtx = { creds, symbol: req.symbol, exitSide, steps };
  const stop = await placeProtectiveAlgo(
    algoCtx,
    "STOP_MARKET",
    v.stopLoss,
    ids.stop,
  );
  futuresRefs.stop = stop.ref;
  const afterStop = afterFuturesStop(stop.placed, req.stopOnly === true);
  if (afterStop === "rollback")
    return rollbackFutures({
      creds,
      req,
      rules,
      exitSide,
      entryPrice,
      filled,
      steps,
      done,
    });
  if (afterStop !== "takeProfit") return done(afterStop, entryPrice, filled);

  // Тейк с неизвестным исходом: protected (стоп стоит), но ссылка по clientAlgoId остаётся —
  // закрытие снимет висящий тейк.
  const tp = await placeProtectiveAlgo(
    algoCtx,
    "TAKE_PROFIT_MARKET",
    v.takeProfit,
    ids.takeProfit,
  );
  futuresRefs.takeProfit = tp.ref;
  return done(afterFuturesTakeProfit(tp.placed), entryPrice, filled);
}

/**
 * Стоп или тейк фьючерсов со своим clientAlgoId. Биржа отказала — не выставлен, ссылки нет.
 * Исход неизвестен (-1006/-1007, 5xx, сеть, таймаут) — перечитать по clientAlgoId до дедлайна
 * (lib/closePlan → afterAlgoUnknown): ссылка сохраняется в любом случае.
 */
async function placeProtectiveAlgo(
  c: {
    creds: BinanceCredentials;
    symbol: string;
    exitSide: "BUY" | "SELL";
    steps: TradeStep[];
  },
  type: "STOP_MARKET" | "TAKE_PROFIT_MARKET",
  trigger: string,
  clientAlgoId: string,
): Promise<{ placed: boolean; ref: StoredAlgoRef | null }> {
  const label = type === "STOP_MARKET" ? "Stop Loss" : "Take Profit";
  const sentAt = Date.now();
  try {
    const algo = await withPositionRetry(() =>
      demoFuturesCloseAt(
        c.creds,
        c.symbol,
        c.exitSide,
        type,
        trigger,
        clientAlgoId,
      ),
    );
    c.steps.push({
      label,
      ok: true,
      detail: `${trigger}, закроет всю позицию, #${algo.algoId}`,
    });
    return {
      placed: true,
      ref: {
        algoId: algo.algoId,
        clientAlgoId: algo.clientAlgoId ?? clientAlgoId,
      },
    };
  } catch (error) {
    c.steps.push({ label, ok: false, detail: errorText(error) });
    if (orderErrorOutcome(error) === "rejected")
      return { placed: false, ref: null };
  }
  let found: AlgoOrderQuery | null | "error";
  try {
    found = await recheckUntil(
      unknownOutcomeDeadline(sentAt, Date.now()),
      () => fetchDemoAlgoOrder(c.creds, { clientAlgoId }),
      (a) => a !== null,
    );
  } catch (error) {
    c.steps.push({
      label: `Проверка: ${label}`,
      ok: false,
      detail: errorText(error),
    });
    found = "error";
  }
  const checked = afterAlgoUnknown(found, clientAlgoId);
  if (found !== "error")
    c.steps.push({
      label: `Проверка: ${label}`,
      ok: checked.placed,
      detail: found
        ? `${found.algoStatus}, #${found.algoId}`
        : `Ордера ${clientAlgoId} на бирже нет`,
    });
  return checked;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Перечитывать, пока не найдётся или пока проверка не будет начата после дедлайна
 * (unknownOutcomeDeadline: отправка + recvWindow — позже биржа заявку в движок не передаст).
 * Раньше дедлайна «не найдено» — не вердикт.
 */
async function recheckUntil<T>(
  deadline: number,
  read: () => Promise<T>,
  found: (value: T) => boolean,
): Promise<T> {
  for (;;) {
    const startedAt = Date.now();
    const value = await read();
    if (found(value)) return value;
    const delay = nextRecheckDelay(Date.now(), deadline, startedAt);
    if (delay === null) return value;
    await sleep(delay);
  }
}

/**
 * Фьючерсы: стоп не встал — закрыть позицию по рынку (reduceOnly на исполненный объём) и снять
 * ордера символа (algo-стоп мог дойти до биржи, если оборвалась сеть). Позиции нет — rejected
 * без цены входа: в демо-статистику такая сделка не попадает. Не закрылась — unprotected (тревога).
 * Снимаем все ордера символа: пока по символу одна позиция (spec 0012, PR 1).
 */
async function rollbackFutures(c: {
  creds: BinanceCredentials;
  req: TradeRequest;
  rules: SymbolRules;
  exitSide: "BUY" | "SELL";
  entryPrice: number;
  filled: number;
  steps: TradeStep[];
  done: Done;
}): Promise<TradeResult> {
  const { creds, req, steps } = c;
  const label = "Закрытие по рынку (стоп не встал)";
  try {
    const qty = floorToStep(c.filled, c.rules.stepSize);
    const order = await withPositionRetry(() =>
      demoFuturesReduceMarket(creds, req.symbol, c.exitSide, qty),
    );
    steps.push({
      label,
      ok: true,
      detail: `${order.executedQty || qty} по ~${order.avgPrice || "рынку"}, ордер #${order.orderId}`,
    });
  } catch (error) {
    steps.push({ label, ok: false, detail: errorText(error) });
    return c.done(afterFuturesRollback(false), c.entryPrice, c.filled);
  }
  try {
    await demoCancelAllOrders(creds, "usdm", req.symbol);
    steps.push({
      label: "Снять ордера символа",
      ok: true,
      detail: "Сняты возможные остатки TP/SL",
    });
  } catch (error) {
    steps.push({
      label: "Снять ордера символа",
      ok: false,
      detail: errorText(error),
    });
  }
  return c.done(afterFuturesRollback(true));
}

interface SpotContext {
  creds: BinanceCredentials;
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
}

/** Перечитать статусы отложенных ордеров: сразу после входа они PENDING_NEW. */
const PENDING_CHECK_DELAYS_MS = [300, 700, 1500];

/**
 * Перечитать ордер спота по своему clientOrderId после ответа с неизвестным исходом; null —
 * ордера нет и при проверке после дедлайна (заявка до движка не дошла).
 */
const recheckSpotOrder = (
  creds: BinanceCredentials,
  symbol: string,
  clientOrderId: string,
  deadline: number,
) =>
  recheckUntil(
    deadline,
    () => fetchDemoSpotOrderByClientId(creds, symbol, clientOrderId),
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
  const { creds, req, ids, steps } = c;
  const label = "Проверка заявки на бирже";
  try {
    const working = await recheckSpotOrder(
      creds,
      req.symbol,
      ids.working,
      deadline,
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
        fetchDemoSpotOrderByClientId(creds, req.symbol, id),
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
  const { creds, req, v, rules, price, ids, steps, done } = c;
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
    list = await demoSpotBuyProtected(creds, {
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
          status: await fetchDemoSpotOrderStatus(creds, req.symbol, p.orderId),
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
        creds,
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
          creds,
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
  const { creds, req, v, rules, price, ids, steps, done } = c;
  const label = "Покупка по рынку";
  let filled: number;
  let quoteQty: number;
  let fee: number;
  let status: string;
  const sentAt = Date.now();
  try {
    const order = await demoSpotMarketOrder(
      creds,
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
          creds,
          req.symbol,
          ids.market,
          unknownOutcomeDeadline(sentAt, Date.now()),
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
  const { creds, req, v, ids, steps, done } = c;
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
        creds,
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
        creds,
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
    const order = await demoSpotMarketOrder(creds, req.symbol, "SELL", sellQty);
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
