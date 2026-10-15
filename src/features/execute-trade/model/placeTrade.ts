import { randomUUID } from "node:crypto";
import {
  MAX_RISK_PCT,
  type TradeRequest,
  type TradeResult,
  type TradeStep,
} from "@/entities/trade";
import {
  BinanceApiError,
  demoCancelAllOrders,
  demoFuturesCloseAt,
  demoFuturesMarketOrder,
  demoFuturesPosition,
  demoFuturesPrepare,
  demoFuturesReduceMarket,
  demoSpotBuyProtected,
  demoSpotMarketOrder,
  demoSpotOcoSell,
  demoSpotStopLossSell,
  fetchDemoOpenSymbols,
  fetchDemoPrice,
  fetchDemoSpotOrderStatus,
  fetchDemoSymbolRules,
  fetchDemoUsdtBalances,
  type SymbolRules,
} from "@/shared/api/binance/demo.server";
import type { BinanceCredentials } from "@/shared/config/env.server";
import { getDemoTradingConfig } from "@/shared/config/env.server";
import { log } from "@/shared/lib/logger.server";
import {
  chooseSpotEntry,
  pendingOutcome,
  spotEntryLimitPrice,
  spotSellQuantity,
} from "../lib/spotEntry";
import {
  floorToStep,
  type ValidatedTrade,
  validateTrade,
} from "../lib/validateTrade";

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
  const exitSide = req.direction === "long" ? "SELL" : "BUY";

  for (const detail of v.adjustments)
    steps.push({ label: "Фильтр цены биржи", ok: true, detail });

  if (req.market === "spot")
    return placeSpot({ creds, req, v, rules, price, steps, finish });

  // Binance не меняет маржу, пока по символу висят ордера (-4067), а второй вход
  // перезаписал бы TP/SL первого (closePosition). Поэтому повторный вход не пускаем.
  try {
    const open = await fetchDemoOpenSymbols(creds, req.symbol);
    if (open.futures.includes(req.symbol))
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
  let entryPrice: number;
  let filled: number;
  try {
    const order = await demoFuturesMarketOrder(
      creds,
      req.symbol,
      entrySide,
      v.quantity,
    );
    filled = order.executedQty || Number(v.quantity);
    entryPrice = order.avgPrice || price;
    steps.push({
      label: entryLabel,
      ok: true,
      detail: `${filled} по ~${entryPrice}, ордер #${order.orderId}`,
    });
  } catch (error) {
    // Биржа явно отказала — позиции точно нет.
    if (error instanceof BinanceApiError) {
      steps.push({ label: entryLabel, ok: false, detail: errorText(error) });
      return finish("rejected", "Биржа отклонила вход — позиция не открыта.");
    }
    // Ответ не распознан или оборвалась сеть: проверяем позицию на бирже, а не гадаем.
    steps.push({
      label: entryLabel,
      ok: false,
      detail: `${errorText(error)} — проверяю позицию на бирже`,
    });
    try {
      const position = await demoFuturesPosition(creds, req.symbol);
      if (position.amount === 0) {
        steps.push({
          label: "Проверка позиции",
          ok: true,
          detail: "Позиции нет",
        });
        return finish("rejected", "Вход не исполнился — позиции на бирже нет.");
      }
      filled = Math.abs(position.amount);
      entryPrice = position.entryPrice || price;
      steps.push({
        label: "Проверка позиции",
        ok: true,
        detail: `Позиция открыта: ${position.amount} по ${entryPrice} — ставлю защиту`,
      });
    } catch (checkError) {
      steps.push({
        label: "Проверка позиции",
        ok: false,
        detail: errorText(checkError),
      });
      return finish(
        "unprotected",
        "Неизвестно, открылась ли позиция, — проверьте на demo.binance.com и при необходимости поставьте стоп вручную.",
      );
    }
  }

  // Сначала стоп: не встал — позиция без защиты не остаётся, сразу закрываем её по рынку (AC5).
  try {
    const algo = await withPositionRetry(() =>
      demoFuturesCloseAt(
        creds,
        req.symbol,
        exitSide,
        "STOP_MARKET",
        v.stopLoss,
      ),
    );
    steps.push({
      label: "Stop Loss",
      ok: true,
      detail: `${v.stopLoss}, закроет всю позицию, #${algo.algoId}`,
    });
  } catch (error) {
    steps.push({ label: "Stop Loss", ok: false, detail: errorText(error) });
    return rollbackFutures({
      creds,
      req,
      rules,
      exitSide,
      entryPrice,
      filled,
      steps,
      finish,
    });
  }

  if (req.stopOnly)
    return finish(
      "protected",
      "Позиция открыта, стоп выставлен (тейка нет — выход по стратегии).",
      entryPrice,
      filled,
    );
  try {
    const algo = await withPositionRetry(() =>
      demoFuturesCloseAt(
        creds,
        req.symbol,
        exitSide,
        "TAKE_PROFIT_MARKET",
        v.takeProfit,
      ),
    );
    steps.push({
      label: "Take Profit",
      ok: true,
      detail: `${v.takeProfit}, закроет всю позицию, #${algo.algoId}`,
    });
  } catch (error) {
    steps.push({ label: "Take Profit", ok: false, detail: errorText(error) });
    return finish(
      "unprotected",
      "Позиция открыта, стоп стоит, но тейк не выставился — проверьте на demo.binance.com.",
      entryPrice,
      filled,
    );
  }
  return finish(
    "protected",
    "Позиция открыта, TP и SL выставлены.",
    entryPrice,
    filled,
  );
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
  finish: Finish;
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
    return c.finish(
      "unprotected",
      "Стоп не принят биржей, и закрыть позицию по рынку не удалось — закройте её на demo.binance.com.",
      c.entryPrice,
      c.filled,
    );
  }
  try {
    await demoCancelAllOrders(creds, "futures", req.symbol);
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
  return c.finish(
    "rejected",
    "Стоп не принят биржей — позиция сразу закрыта по рынку.",
  );
}

interface SpotContext {
  creds: BinanceCredentials;
  req: TradeRequest;
  v: ValidatedTrade;
  rules: SymbolRules;
  price: number;
  steps: TradeStep[];
  finish: Finish;
}

/** Перечитать статусы отложенных ордеров: сразу после входа они PENDING_NEW. */
const PENDING_CHECK_DELAYS_MS = [300, 700, 1500];

/**
 * Спот (spec 0012, AC4): покупка и защита одной заявкой OTOCO/OTO — стоп за фильтром биржи
 * отклоняет всю заявку, монеты не покупаются. Если составные заявки по символу запрещены — по-старому.
 */
async function placeSpot(c: SpotContext): Promise<TradeResult> {
  const { creds, req, v, rules, price, steps, finish } = c;
  const mode = chooseSpotEntry(rules, req.stopOnly === true);
  if (mode === "market") return placeSpotMarket(c);

  const limitPrice = spotEntryLimitPrice(price, rules.tickSize);
  const sellQty = spotSellQuantity(v.quantity, rules.stepSize);
  const label =
    mode === "otoco"
      ? "OTOCO: покупка + тейк + стоп"
      : "OTO: покупка + стоп (без тейка)";
  let list: Awaited<ReturnType<typeof demoSpotBuyProtected>>;
  try {
    list = await demoSpotBuyProtected(creds, {
      symbol: req.symbol,
      quantity: v.quantity,
      limitPrice,
      sellQuantity: sellQty,
      stopLoss: v.stopLoss,
      takeProfit: mode === "otoco" ? v.takeProfit : null,
    });
  } catch (error) {
    steps.push({ label, ok: false, detail: errorText(error) });
    if (error instanceof BinanceApiError)
      return finish("rejected", "Биржа отклонила заявку — монеты не куплены.");
    return finish(
      "unprotected",
      "Неизвестно, исполнилась ли покупка, — проверьте баланс и ордера на demo.binance.com.",
    );
  }

  const filled = list.filled;
  const entryPrice = filled > 0 ? list.quoteQty / filled : price;
  if (list.workingStatus !== "FILLED") {
    steps.push({
      label,
      ok: false,
      detail: `Покупка не исполнилась целиком по цене до ${limitPrice} (FOK: ${list.workingStatus}, куплено ${filled}), список #${list.orderListId}`,
    });
    if (filled === 0)
      return finish(
        "rejected",
        "Покупка не исполнилась по цене до +0,5% — монеты не куплены.",
      );
    // FOK не исполняется частично; если всё же куплено — защищаем купленное отдельно.
    return protectOrSell(c, {
      sellQty: floorToStep(filled - list.baseCommission, rules.stepSize),
      entryPrice,
      filled,
    });
  }
  steps.push({
    label,
    ok: true,
    detail: `${filled} по ~${entryPrice.toPrecision(6)}; ${mode === "otoco" ? `TP ${v.takeProfit} / ` : ""}SL ${v.stopLoss} на ${sellQty}, список #${list.orderListId}`,
  });

  let outcome = pendingOutcome(list.pending.map((p) => p.status));
  try {
    for (const delay of PENDING_CHECK_DELAYS_MS) {
      if (outcome !== "waiting") break;
      await new Promise((r) => setTimeout(r, delay));
      const statuses = await Promise.all(
        list.pending.map((p) =>
          fetchDemoSpotOrderStatus(creds, req.symbol, p.orderId),
        ),
      );
      outcome = pendingOutcome(statuses);
    }
  } catch (error) {
    steps.push({
      label: "Проверка стопа",
      ok: false,
      detail: errorText(error),
    });
  }
  if (outcome === "placed")
    return finish(
      "protected",
      req.stopOnly
        ? "Позиция открыта, стоп выставлен (тейка нет — выход по стратегии)."
        : "Позиция открыта, TP и SL выставлены.",
      entryPrice,
      filled,
    );
  if (outcome === "waiting") {
    steps.push({
      label: "Проверка стопа",
      ok: false,
      detail: "Биржа ещё не подтвердила стоп после покупки",
    });
    return finish(
      "unprotected",
      "Куплено, но стоп ещё не подтверждён биржей — проверьте ордера на demo.binance.com.",
      entryPrice,
      filled,
    );
  }
  steps.push({
    label: "Проверка стопа",
    ok: false,
    detail: "Биржа сняла стоп/тейк после покупки",
  });
  return protectOrSell(c, {
    sellQty: floorToStep(filled - list.baseCommission, rules.stepSize),
    entryPrice,
    filled,
  });
}

/** Спот без составных заявок: покупка по рынку, затем защита (при её отказе — продажа). */
async function placeSpotMarket(c: SpotContext): Promise<TradeResult> {
  const { creds, req, v, rules, price, steps, finish } = c;
  let filled: number;
  let entryPrice: number;
  let sellQty: string;
  try {
    const order = await demoSpotMarketOrder(
      creds,
      req.symbol,
      "BUY",
      v.quantity,
    );
    filled = order.executedQty;
    entryPrice = filled > 0 ? order.cummulativeQuoteQty / filled : price;
    // Комиссия в базовом активе уменьшает то, что можно продать.
    const baseAsset = req.symbol.replace(/USDT$/, "");
    const fee = order.fills
      .filter((f) => f.commissionAsset === baseAsset)
      .reduce((s, f) => s + f.commission, 0);
    sellQty = floorToStep(filled - fee, rules.stepSize);
    steps.push({
      label: "Покупка по рынку",
      ok: true,
      detail: `${filled} по ~${entryPrice.toPrecision(6)}, ордер #${order.orderId}`,
    });
  } catch (error) {
    steps.push({
      label: "Покупка по рынку",
      ok: false,
      detail: errorText(error),
    });
    if (error instanceof BinanceApiError)
      return finish("rejected", "Биржа отклонила вход — позиция не открыта.");
    // Ответ не распознан / сеть: покупка могла пройти — не называем её отклонённой.
    return finish(
      "unprotected",
      "Неизвестно, исполнилась ли покупка, — проверьте баланс и ордера на demo.binance.com.",
    );
  }
  return protectOrSell(c, { sellQty, entryPrice, filled });
}

/**
 * Защита уже купленного: стоп (stopOnly) или OCO. Биржа отказала — продаём купленное по рынку,
 * сделка не открылась (rejected без цены входа). Сеть оборвалась — стоп мог встать: unprotected.
 */
async function protectOrSell(
  c: SpotContext,
  bought: { sellQty: string; entryPrice: number; filled: number },
): Promise<TradeResult> {
  const { creds, req, v, steps, finish } = c;
  const { sellQty, entryPrice, filled } = bought;
  const protectLabel = req.stopOnly ? "Стоп" : "OCO: тейк + стоп";
  try {
    if (req.stopOnly) {
      const stop = await demoSpotStopLossSell(
        creds,
        req.symbol,
        sellQty,
        v.stopLoss,
      );
      steps.push({
        label: protectLabel,
        ok: true,
        detail: `SL ${v.stopLoss} на ${sellQty}, без тейка, ордер #${stop.orderId}`,
      });
      return finish(
        "protected",
        "Позиция открыта, стоп выставлен (тейка нет — выход по стратегии).",
        entryPrice,
        filled,
      );
    }
    const oco = await demoSpotOcoSell(
      creds,
      req.symbol,
      sellQty,
      v.takeProfit,
      v.stopLoss,
    );
    steps.push({
      label: protectLabel,
      ok: true,
      detail: `TP ${v.takeProfit} / SL ${v.stopLoss} на ${sellQty}, список #${oco.orderListId}`,
    });
    return finish(
      "protected",
      "Позиция открыта, TP и SL выставлены.",
      entryPrice,
      filled,
    );
  } catch (error) {
    steps.push({ label: protectLabel, ok: false, detail: errorText(error) });
    if (!(error instanceof BinanceApiError))
      return finish(
        "unprotected",
        "Куплено, но неизвестно, встала ли защита, — проверьте ордера на demo.binance.com.",
        entryPrice,
        filled,
      );
  }
  const sellLabel = "Продажа по рынку (стоп не встал)";
  try {
    const order = await demoSpotMarketOrder(creds, req.symbol, "SELL", sellQty);
    steps.push({
      label: sellLabel,
      ok: true,
      detail: `${order.executedQty} на $${order.cummulativeQuoteQty.toFixed(2)}, ордер #${order.orderId}`,
    });
    return finish(
      "rejected",
      "Стоп не принят биржей — купленное сразу продано по рынку.",
    );
  } catch (error) {
    steps.push({ label: sellLabel, ok: false, detail: errorText(error) });
    return finish(
      "unprotected",
      "Куплено, но защита не выставилась и продать не удалось — закройте позицию вручную на demo.binance.com.",
      entryPrice,
      filled,
    );
  }
}
