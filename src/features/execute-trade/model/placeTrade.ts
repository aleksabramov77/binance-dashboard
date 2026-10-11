import { randomUUID } from "node:crypto";
import {
  MAX_RISK_PCT,
  type TradeRequest,
  type TradeResult,
  type TradeStep,
} from "@/entities/trade";
import {
  BinanceApiError,
  demoFuturesCloseAt,
  demoFuturesMarketOrder,
  demoFuturesPosition,
  demoFuturesPrepare,
  demoSpotMarketOrder,
  demoSpotOcoSell,
  demoSpotStopLossSell,
  fetchDemoOpenSymbols,
  fetchDemoPrice,
  fetchDemoSymbolRules,
  fetchDemoUsdtBalances,
} from "@/shared/api/binance/demo.server";
import { getDemoTradingConfig } from "@/shared/config/env.server";
import { log } from "@/shared/lib/logger.server";
import { floorToStep, validateTrade } from "../lib/validateTrade";

/** Binance -4509: позиция ещё не видна (closePosition сразу после входа) — повторяем. */
const POSITION_RETRY_DELAYS_MS = [1000, 2000];

async function withPositionRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (const delay of POSITION_RETRY_DELAYS_MS) {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof BinanceApiError && error.code === -4509))
        throw error;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return fn();
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Исполняет сделку в Binance Demo Trading: вход по рынку и сразу TP/SL.
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
  const finish = (
    status: TradeResult["status"],
    message: string,
    entryPrice: number | null = null,
    filledQuantity: number | null = null,
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

  if (req.market === "spot") {
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
      return finish(
        "unprotected",
        "Куплено, но защита не выставилась — закройте позицию вручную на demo.binance.com.",
        entryPrice,
        filled,
      );
    }
  }

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

  let isProtected = true;
  const protections = [
    ["Stop Loss", "STOP_MARKET", v.stopLoss],
    ["Take Profit", "TAKE_PROFIT_MARKET", v.takeProfit],
  ] as const;
  for (const [label, type, trigger] of req.stopOnly
    ? protections.slice(0, 1)
    : protections) {
    try {
      const algo = await withPositionRetry(() =>
        demoFuturesCloseAt(creds, req.symbol, exitSide, type, trigger),
      );
      steps.push({
        label,
        ok: true,
        detail: `${trigger}, закроет всю позицию, #${algo.algoId}`,
      });
    } catch (error) {
      isProtected = false;
      steps.push({ label, ok: false, detail: errorText(error) });
    }
  }
  return isProtected
    ? finish(
        "protected",
        req.stopOnly
          ? "Позиция открыта, стоп выставлен (тейка нет — выход по стратегии)."
          : "Позиция открыта, TP и SL выставлены.",
        entryPrice,
        filled,
      )
    : finish(
        "unprotected",
        "Позиция открыта, но не все защитные ордера выставлены — проверьте на demo.binance.com.",
        entryPrice,
        filled,
      );
}
