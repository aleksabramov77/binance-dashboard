import type { TradeStep } from "@/entities/trade";
import {
  clientIdGroup,
  type DemoProtectRefs,
  demoCancelAlgoOrder,
  demoFuturesCancelOrder,
  demoFuturesPositions,
  demoFuturesReduceMarket,
  demoSpotCancelByClientId,
  demoSpotCancelOrder,
  demoSpotMarketOrder,
  type FuturesSide,
  fetchDemoAlgoOrder,
  fetchDemoFuturesSymbolState,
  fetchDemoPositionMode,
  fetchDemoPrice,
  fetchDemoSpotHoldings,
  fetchDemoSpotOpenOrders,
  fetchDemoSpotOrderByClientId,
  fetchDemoSymbolRules,
} from "@/shared/api/binance/demo.server";
import type { BinanceCredentials } from "@/shared/config/env.server";
import { getDemoTradingConfig } from "@/shared/config/env.server";
import { log } from "@/shared/lib/logger.server";
import {
  algoLeg,
  algoLookup,
  averagePrice,
  type ClosePlan,
  closeVerdict,
  ownCloseQuantity,
  planOwnClose,
  spotLeg,
  spotNetQuantity,
} from "../lib/closePlan";
import {
  ownPosition,
  protectiveToCancel,
  spotProtectiveToCancel,
} from "../lib/futuresMode";
import { floorToStep, isDust } from "../lib/validateTrade";
import { futuresFillPrice } from "./futuresFillPrice";

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

  // Старые строки без protect_refs: снимаем только защитные ордера своей стороны (lib/futuresMode),
  // а не все ордера символа — чужие (ручные, другие зеркала в Hedge) остаются.
  let futures: { side: FuturesSide; amount: number } | null = null;
  try {
    if (req.market === "futures") {
      const side: FuturesSide = {
        mode: await fetchDemoPositionMode(creds),
        direction: req.direction,
      };
      const state = await fetchDemoFuturesSymbolState(creds, req.symbol);
      const toCancel = protectiveToCancel(state, side);
      for (const algoId of toCancel.algoIds)
        await demoCancelAlgoOrder(creds, { algoId });
      for (const orderId of toCancel.orderIds)
        await demoFuturesCancelOrder(creds, req.symbol, orderId);
      futures = { side, amount: ownPosition(state.positions, side).amount };
      steps.push({
        label: "Снять ордера своей стороны",
        ok: true,
        detail: `algo: ${toCancel.algoIds.length}, обычных: ${toCancel.orderIds.length}`,
      });
    } else {
      const toCancel = spotProtectiveToCancel(
        await fetchDemoSpotOpenOrders(creds, req.symbol),
      );
      for (const orderId of toCancel)
        await demoSpotCancelOrder(creds, req.symbol, orderId);
      steps.push({
        label: "Снять свои продажи (TP/SL)",
        ok: true,
        detail: `Снято: ${toCancel.length}`,
      });
    }
  } catch (error) {
    steps.push({ label: "Снять ордера", ok: false, detail: errorText(error) });
    return finish(
      "failed",
      "Не удалось снять защитные ордера — позиция не закрыта, проверьте на demo.binance.com.",
    );
  }

  try {
    if (futures) {
      const rules = await fetchDemoSymbolRules("futures", req.symbol);
      const qty = rules
        ? floorToStep(futures.amount, rules.stepSize)
        : String(futures.amount);
      if (Number(qty) <= 0) {
        steps.push({
          label: "Позиция",
          ok: true,
          detail: "Своей позиции нет — уже закрыта биржей",
        });
        return finish("closed", "Позиция уже была закрыта на бирже.");
      }
      const order = await demoFuturesReduceMarket(
        creds,
        req.symbol,
        req.direction === "long" ? "SELL" : "BUY",
        qty,
        futures.side,
      );
      const exitPrice =
        order.avgPrice ||
        (await futuresFillPrice(creds, req.symbol, order.orderId));
      steps.push({
        label: "Закрыть по рынку",
        ok: true,
        detail: `${qty} по ~${exitPrice ?? "рынку"}, ордер #${order.orderId}`,
      });
      return finish("closed", "Позиция закрыта по рынку.", exitPrice || null);
    }

    const rules = await fetchDemoSymbolRules("spot", req.symbol);
    if (!rules) return finish("failed", `${req.symbol} нет на демо-споте.`);
    const baseAsset = req.symbol.replace(/USDT$/, "");
    const held = (await fetchDemoSpotHoldings(creds)).get(baseAsset) ?? 0;
    // Своё — купленное минус комиссия (по ставке: у старых строк fills входа нет).
    const qty = floorToStep(
      Math.min(held, spotNetQuantity(null, req.quantity)),
      rules.stepSize,
    );
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
        ? averagePrice(order.cummulativeQuoteQty, order.executedQty)
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
      [refs.stop, refs.takeProfit].map(async (r) => {
        const lookup = r && algoLookup(r);
        return lookup ? algoLeg(await fetchDemoAlgoOrder(creds, lookup)) : null;
      }),
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
    const lookup = ref && algoLookup(ref);
    return lookup ? demoCancelAlgoOrder(creds, lookup) : false;
  }
  const ref = refs[leg];
  return ref
    ? demoSpotCancelByClientId(creds, symbol, ref.clientOrderId)
    : false;
}

const LEG_LABEL = { stop: "стоп", takeProfit: "тейк" } as const;

/** clientOrderId своего закрытия: группа сделки из своего стопа/тейка + `-C`; нет — без id. */
function ownCloseId(refs: DemoProtectRefs): string | undefined {
  const ids =
    refs.market === "futures"
      ? [refs.stop?.clientAlgoId, refs.takeProfit?.clientAlgoId]
      : [refs.stop?.clientOrderId, refs.takeProfit?.clientOrderId];
  const group = ids.map(clientIdGroup).find((g) => g !== null);
  return group ? `${group}-C` : undefined;
}

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
  // Своё закрытие — с id своей сделки (`bd…-C`): в «Демо-сделках» оно попадёт в свою сделку.
  const closeId = ownCloseId(refs);
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
  // Своя нога сработала — позицию всё равно перечитываем: остался свой объём — докрываем.
  const nothingToClose = (detail: string) => {
    const verdict = closeVerdict(plan, 0);
    steps.push({
      label: "Позиция",
      ok: true,
      detail:
        verdict === "closedByExchange"
          ? `Сработал свой стоп/тейк на бирже; ${detail}`
          : detail,
    });
    return finish(
      "closed",
      verdict === "closedByExchange"
        ? "Позиция уже закрыта биржей (сработал стоп/тейк)."
        : "Позиция уже была закрыта на бирже.",
    );
  };

  try {
    const rules = await fetchDemoSymbolRules(req.market, req.symbol);
    if (!rules)
      return finish("failed", `${req.symbol} нет на демо-рынке ${req.market}.`);
    if (req.market === "futures") {
      // Своя сторона: в Hedge — строка LONG/SHORT, в One-way — общая позиция в сторону сделки.
      const side: FuturesSide = {
        mode: await fetchDemoPositionMode(creds),
        direction: req.direction,
      };
      const position = ownPosition(
        await demoFuturesPositions(creds, req.symbol),
        side,
      );
      const qty = floorToStep(
        ownCloseQuantity(req.quantity, 0, position.amount),
        rules.stepSize,
      );
      if (closeVerdict(plan, Number(qty)) !== "close")
        return nothingToClose(
          `своей позиции нет (своя сторона на бирже ${position.amount})`,
        );
      const order = await demoFuturesReduceMarket(
        creds,
        req.symbol,
        req.direction === "long" ? "SELL" : "BUY",
        qty,
        side,
        closeId,
      );
      const exitPrice =
        order.avgPrice ||
        (await futuresFillPrice(creds, req.symbol, order.orderId));
      steps.push({
        label: "Закрыть свой объём по рынку",
        ok: true,
        detail: `${qty} из ${Math.abs(position.amount)} по ~${exitPrice ?? "рынку"}, ордер #${order.orderId}`,
      });
      return finish("closed", "Позиция закрыта по рынку.", exitPrice || null);
    }

    const baseAsset = req.symbol.replace(/USDT$/, "");
    const held = (await fetchDemoSpotHoldings(creds)).get(baseAsset) ?? 0;
    // Свой объём — полученное нетто (купленное − комиссия), а не купленное: иначе продадим чужое.
    const own =
      refs.market === "spot"
        ? spotNetQuantity(refs.netQuantity, req.quantity)
        : req.quantity;
    const qty = floorToStep(
      ownCloseQuantity(own, plan.soldByLegs, held),
      rules.stepSize,
    );
    const price = await fetchDemoPrice("spot", req.symbol);
    // Пыль биржа не продаст (-1013 NOTIONAL) — продавать нечего.
    const sellable = isDust(Number(qty), price, rules) ? 0 : Number(qty);
    if (closeVerdict(plan, sellable) !== "close")
      return nothingToClose(
        `${baseAsset}: к продаже ${qty} (~$${(Number(qty) * price).toFixed(2)}) — меньше минимального ордера`,
      );
    const order = await demoSpotMarketOrder(
      creds,
      req.symbol,
      "SELL",
      qty,
      closeId,
    );
    steps.push({
      label: "Продать свой объём по рынку",
      ok: true,
      detail: `${order.executedQty} ${baseAsset}, ордер #${order.orderId}`,
    });
    return finish(
      "closed",
      "Монеты проданы по рынку.",
      order.executedQty > 0
        ? averagePrice(order.cummulativeQuoteQty, order.executedQty)
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
