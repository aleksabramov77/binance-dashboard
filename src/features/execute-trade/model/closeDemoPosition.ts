import type { TradeStep } from "@/entities/trade";
import {
  demoCancelAllOrders,
  demoFuturesPosition,
  demoFuturesReduceMarket,
  demoSpotMarketOrder,
  fetchDemoSpotHoldings,
  fetchDemoSymbolRules,
} from "@/shared/api/binance/demo.server";
import { getDemoTradingConfig } from "@/shared/config/env.server";
import { log } from "@/shared/lib/logger.server";
import { floorToStep } from "../lib/validateTrade";

export interface CloseDemoRequest {
  market: "spot" | "futures";
  symbol: string;
  direction: "long" | "short";
  /** Сколько было куплено на споте (сверх этого не продаём — монеты могли лежать раньше). */
  quantity: number;
}

export interface CloseDemoResult {
  /** closed — позиции на бирже больше нет; failed — что-то не вышло, нужна ручная проверка. */
  status: "closed" | "failed";
  message: string;
  steps: TradeStep[];
  /** Средняя цена закрытия по рынку; позицию закрыла биржа (TP/SL) или ошибка — null. */
  exitPrice: number | null;
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Закрывает демо-позицию по рынку: снимает защитные ордера символа (TP/SL, OCO) и продаёт/откупает
 * остаток. Если биржа уже закрыла позицию своим TP/SL — только снимает «висящие» ордера.
 * Только демо-хосты.
 */
export async function closeDemoPosition(
  req: CloseDemoRequest,
): Promise<CloseDemoResult> {
  const steps: TradeStep[] = [];
  const finish = (
    status: CloseDemoResult["status"],
    message: string,
    exitPrice: number | null = null,
  ): CloseDemoResult => {
    const data = { ...req, steps, exitPrice };
    if (status === "closed")
      log.info("trade.closed", `${req.symbol}: ${message}`, data);
    else log.error("trade.close_failed", `${req.symbol}: ${message}`, data);
    return { status, message, steps, exitPrice };
  };

  const config = getDemoTradingConfig();
  if (!config)
    return finish(
      "failed",
      "Ключ Demo Trading не настроен (BINANCE_DEMO_API_KEY / SECRET).",
    );
  const creds = config.credentials;

  try {
    await demoCancelAllOrders(creds, req.market, req.symbol);
    steps.push({ label: "Снять ордера", ok: true, detail: "TP/SL отменены" });
  } catch (error) {
    steps.push({ label: "Снять ордера", ok: false, detail: errorText(error) });
    return finish(
      "failed",
      "Не удалось снять защитные ордера — позиция не закрыта, проверьте на demo.binance.com.",
    );
  }

  try {
    if (req.market === "futures") {
      const position = await demoFuturesPosition(creds, req.symbol);
      if (position.amount === 0) {
        steps.push({
          label: "Позиция",
          ok: true,
          detail: "Уже закрыта биржей",
        });
        return finish("closed", "Позиция уже была закрыта на бирже.");
      }
      const order = await demoFuturesReduceMarket(
        creds,
        req.symbol,
        position.amount > 0 ? "SELL" : "BUY",
        String(Math.abs(position.amount)),
      );
      steps.push({
        label: "Закрыть по рынку",
        ok: true,
        detail: `${Math.abs(position.amount)} по ~${order.avgPrice}, ордер #${order.orderId}`,
      });
      return finish(
        "closed",
        "Позиция закрыта по рынку.",
        order.avgPrice > 0 ? order.avgPrice : null,
      );
    }

    const rules = await fetchDemoSymbolRules("spot", req.symbol);
    if (!rules) return finish("failed", `${req.symbol} нет на демо-споте.`);
    const baseAsset = req.symbol.replace(/USDT$/, "");
    const held = (await fetchDemoSpotHoldings(creds)).get(baseAsset) ?? 0;
    const qty = floorToStep(Math.min(held, req.quantity), rules.stepSize);
    if (Number(qty) <= 0 || Number(qty) < rules.minQty) {
      steps.push({
        label: "Остаток",
        ok: true,
        detail: `${baseAsset}: ${held} — продавать нечего`,
      });
      return finish("closed", "Монеты уже проданы (сработал TP/SL на бирже).");
    }
    const order = await demoSpotMarketOrder(creds, req.symbol, "SELL", qty);
    steps.push({
      label: "Продать по рынку",
      ok: true,
      detail: `${order.executedQty} ${baseAsset}, ордер #${order.orderId}`,
    });
    return finish(
      "closed",
      "Монеты проданы по рынку.",
      order.executedQty > 0
        ? order.cummulativeQuoteQty / order.executedQty
        : null,
    );
  } catch (error) {
    steps.push({ label: "Закрытие", ok: false, detail: errorText(error) });
    return finish(
      "failed",
      "Не удалось закрыть позицию — проверьте на demo.binance.com.",
    );
  }
}
