import type { TradeStep } from "@/entities/trade";
import {
  type DemoProtectRefs,
  demoCancelAlgoOrder,
  demoCancelAllOrders,
  demoFuturesPosition,
  demoFuturesReduceMarket,
  demoSpotCancelByClientId,
  demoSpotMarketOrder,
  fetchDemoAlgoOrder,
  fetchDemoPrice,
  fetchDemoSpotHoldings,
  fetchDemoSpotOrderByClientId,
  fetchDemoSymbolRules,
} from "@/shared/api/binance/demo.server";
import type { BinanceCredentials } from "@/shared/config/env.server";
import { getDemoTradingConfig } from "@/shared/config/env.server";
import { log } from "@/shared/lib/logger.server";
import {
  algoLeg,
  type ClosePlan,
  ownCloseQuantity,
  planOwnClose,
  positionOnSide,
  spotLeg,
} from "../lib/closePlan";
import { floorToStep, isDust } from "../lib/validateTrade";

export interface CloseDemoRequest {
  market: "spot" | "futures";
  symbol: string;
  direction: "long" | "short";
  /**
   * Свой объём: спот — сколько куплено (сверх этого не продаём — монеты могли лежать раньше);
   * фьючерсы — с protectRefs закрываем не больше него.
   */
  quantity: number;
  /**
   * Свои стоп/тейк (spec 0012, PR 2b): снимаются только они, «закрыто биржей» — по их статусу,
   * докрывается только свой объём. Нет (старые зеркала, ручные сделки) — все ордера символа и
   * вся позиция, как раньше.
   */
  protectRefs?: DemoProtectRefs | null;
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
 * Закрывает демо-позицию по рынку. С protectRefs — снимает только свои стоп/тейк; сработал свой —
 * позицию уже закрыла биржа; иначе докрывает свой объём. Без них — снимает все ордера символа
 * (TP/SL, OCO) и продаёт/откупает остаток. Только демо-хосты.
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
  if (req.protectRefs)
    return closeOwn(creds, req, req.protectRefs, steps, finish);

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
    const price = await fetchDemoPrice("spot", req.symbol);
    // Хвост после комиссии дешевле минимального ордера биржа не продаст (-1013 NOTIONAL):
    // позиция по сути закрыта её TP/SL — иначе зеркало повторяло бы продажу каждую минуту.
    if (isDust(Number(qty), price, rules)) {
      steps.push({
        label: "Остаток",
        ok: true,
        detail: `${baseAsset}: ${held} (~$${(Number(qty) * price).toFixed(2)}) — меньше минимального ордера, продавать нечего`,
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

type CloseFinish = (
  status: CloseDemoResult["status"],
  message: string,
  exitPrice?: number | null,
) => CloseDemoResult;

/** Свои стоп/тейк на бирже → план закрытия (lib/closePlan). */
async function readOwnLegs(
  creds: BinanceCredentials,
  symbol: string,
  refs: DemoProtectRefs,
): Promise<ClosePlan> {
  if (refs.market === "futures") {
    const [stop, takeProfit] = await Promise.all(
      [refs.stop, refs.takeProfit].map(async (r) =>
        r ? algoLeg(await fetchDemoAlgoOrder(creds, r.algoId)) : null,
      ),
    );
    return planOwnClose({ stop: stop ?? null, takeProfit: takeProfit ?? null });
  }
  const [stop, takeProfit] = await Promise.all(
    [refs.stop, refs.takeProfit].map(async (r) =>
      r
        ? spotLeg(
            await fetchDemoSpotOrderByClientId(creds, symbol, r.clientOrderId),
          )
        : null,
    ),
  );
  return planOwnClose({ stop: stop ?? null, takeProfit: takeProfit ?? null });
}

/** Снять свой ордер. Спот: снятие ордера из списка (OCO/OTOCO) снимает весь список. */
async function cancelOwn(
  creds: BinanceCredentials,
  symbol: string,
  refs: DemoProtectRefs,
  leg: "stop" | "takeProfit",
): Promise<boolean> {
  if (refs.market === "futures") {
    const ref = refs[leg];
    return ref ? demoCancelAlgoOrder(creds, ref.algoId) : false;
  }
  const ref = refs[leg];
  return ref
    ? demoSpotCancelByClientId(creds, symbol, ref.clientOrderId)
    : false;
}

const LEG_LABEL = { stop: "стоп", takeProfit: "тейк" } as const;

/**
 * Закрытие по своим ордерам (PR 2b): ордера других зеркал и ручные ордера по символу не трогаем,
 * позицию докрываем только на свой объём.
 */
async function closeOwn(
  creds: BinanceCredentials,
  req: CloseDemoRequest,
  refs: DemoProtectRefs,
  steps: TradeStep[],
  finish: CloseFinish,
): Promise<CloseDemoResult> {
  let plan: ClosePlan;
  try {
    plan = await readOwnLegs(creds, req.symbol, refs);
    const cancelled: string[] = [];
    for (const leg of plan.cancel)
      if (await cancelOwn(creds, req.symbol, refs, leg))
        cancelled.push(LEG_LABEL[leg]);
    steps.push({
      label: "Снять свои ордера",
      ok: true,
      detail: cancelled.length
        ? `Сняты: ${cancelled.join(", ")}`
        : "Своих стоящих ордеров нет",
    });
  } catch (error) {
    steps.push({
      label: "Снять свои ордера",
      ok: false,
      detail: errorText(error),
    });
    return finish(
      "failed",
      "Не удалось снять свои защитные ордера — позиция не закрыта, проверьте на demo.binance.com.",
    );
  }
  if (plan.closedByExchange) {
    steps.push({
      label: "Позиция",
      ok: true,
      detail: "Сработал свой стоп/тейк на бирже",
    });
    return finish("closed", "Позиция уже закрыта биржей (сработал стоп/тейк).");
  }

  try {
    const rules = await fetchDemoSymbolRules(req.market, req.symbol);
    if (!rules)
      return finish("failed", `${req.symbol} нет на демо-рынке ${req.market}.`);
    if (req.market === "futures") {
      const position = await demoFuturesPosition(creds, req.symbol);
      const qty = floorToStep(
        ownCloseQuantity(
          req.quantity,
          0,
          positionOnSide(position.amount, req.direction),
        ),
        rules.stepSize,
      );
      if (Number(qty) <= 0) {
        steps.push({
          label: "Позиция",
          ok: true,
          detail: `Своей позиции нет (на бирже ${position.amount})`,
        });
        return finish("closed", "Позиция уже была закрыта на бирже.");
      }
      const order = await demoFuturesReduceMarket(
        creds,
        req.symbol,
        req.direction === "long" ? "SELL" : "BUY",
        qty,
      );
      steps.push({
        label: "Закрыть свой объём по рынку",
        ok: true,
        detail: `${qty} из ${Math.abs(position.amount)} по ~${order.avgPrice}, ордер #${order.orderId}`,
      });
      return finish(
        "closed",
        "Позиция закрыта по рынку.",
        order.avgPrice > 0 ? order.avgPrice : null,
      );
    }

    const baseAsset = req.symbol.replace(/USDT$/, "");
    const held = (await fetchDemoSpotHoldings(creds)).get(baseAsset) ?? 0;
    const qty = floorToStep(
      ownCloseQuantity(req.quantity, plan.soldByLegs, held),
      rules.stepSize,
    );
    const price = await fetchDemoPrice("spot", req.symbol);
    if (isDust(Number(qty), price, rules)) {
      steps.push({
        label: "Остаток",
        ok: true,
        detail: `${baseAsset}: к продаже ${qty} (~$${(Number(qty) * price).toFixed(2)}) — меньше минимального ордера`,
      });
      return finish("closed", "Монеты уже проданы (сработал TP/SL на бирже).");
    }
    const order = await demoSpotMarketOrder(creds, req.symbol, "SELL", qty);
    steps.push({
      label: "Продать свой объём по рынку",
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
