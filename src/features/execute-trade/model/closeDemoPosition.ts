import type { TradeStep } from "@/entities/trade";
import {
  type AlgoOrderQuery,
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
  fetchDemoFuturesOrder,
  fetchDemoFuturesSymbolState,
  fetchDemoPositionMode,
  fetchDemoPrice,
  fetchDemoSpotHoldings,
  fetchDemoSpotOpenOrders,
  fetchDemoSpotOrderByClientId,
  fetchDemoSymbolRules,
} from "@/shared/api/binance/demo.server";
import type {
  TradeVenue,
  VenueFuturesMarket,
} from "@/shared/api/binance/venue.server";
import { log } from "@/shared/lib/logger.server";
import {
  algoLeg,
  algoLookup,
  algoTriggered,
  averagePrice,
  type ClosePlan,
  closeVerdict,
  ownCloseQuantity,
  planOwnClose,
  protectMarketOf,
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
import { demoTradeContext } from "./tradeVenue";

export interface CloseDemoRequest {
  /** COIN-M (demo-dapi, spec 0056) — только у демо-зеркала. */
  market: "spot" | "usdm" | "coinm";
  symbol: string;
  direction: "long" | "short";
  /**
   * Свой объём: спот — сколько куплено (сверх этого не продаём — монеты могли лежать раньше);
   * фьючерсы — с protectRefs закрываем не больше него. COIN-M — в монете (как paper); свой объём на бирже —
   * контракты из protectRefs.
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
  /**
   * Свои стоп/тейк в этой попытке сняты (spec 0049): если при этом status failed — позиция осталась без защиты,
   * реальное зеркало отмечает её «без защиты» и повторяет закрытие каждый прогон.
   */
  protectionRemoved?: boolean;
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Закрывает демо-позицию по рынку. С protectRefs — снимает только свои стоп/тейк; сработал свой —
 * позицию уже закрыла биржа; иначе докрывает свой объём. Без них — снимает все ордера символа
 * (TP/SL, OCO) и продаёт/откупает остаток. Площадка — venue (spec 0049): по умолчанию Binance Demo из env.
 */
export async function closeDemoPosition(
  req: CloseDemoRequest,
  venue: TradeVenue | null = demoTradeContext()?.venue ?? null,
): Promise<CloseDemoResult> {
  const steps: TradeStep[] = [];
  const removed = { value: false };
  const finish = (
    status: CloseDemoResult["status"],
    message: string,
    exitPrice: number | null = null,
  ): CloseDemoResult => {
    const data = { ...req, steps, exitPrice };
    if (status === "closed")
      log.info("trade.closed", `${req.symbol}: ${message}`, data);
    else log.error("trade.close_failed", `${req.symbol}: ${message}`, data);
    return {
      status,
      message,
      steps,
      exitPrice,
      ...(removed.value && { protectionRemoved: true }),
    };
  };

  if (!venue)
    return finish(
      "failed",
      "Ключ Demo Trading не настроен (BINANCE_DEMO_API_KEY / SECRET).",
    );
  if (req.protectRefs)
    return closeOwn(venue, req, req.protectRefs, steps, finish, removed);

  // Старые строки без protect_refs: снимаем только защитные ордера своей стороны (lib/futuresMode),
  // а не все ордера символа — чужие (ручные, другие зеркала в Hedge) остаются.
  let futures: {
    side: FuturesSide;
    amount: number;
    market: VenueFuturesMarket;
  } | null = null;
  try {
    if (req.market !== "spot") {
      const market = req.market;
      const side: FuturesSide = {
        mode: await fetchDemoPositionMode(venue, market),
        direction: req.direction,
      };
      const state = await fetchDemoFuturesSymbolState(
        venue,
        req.symbol,
        market,
      );
      const toCancel = protectiveToCancel(state, side);
      for (const algoId of toCancel.algoIds)
        await demoCancelAlgoOrder(
          venue,
          { algoId },
          protectMarketOf(market, req.symbol),
        );
      for (const orderId of toCancel.orderIds)
        await demoFuturesCancelOrder(venue, req.symbol, orderId, market);
      futures = {
        side,
        amount: ownPosition(state.positions, side).amount,
        market,
      };
      steps.push({
        label: "Снять ордера своей стороны",
        ok: true,
        detail: `algo: ${toCancel.algoIds.length}, обычных: ${toCancel.orderIds.length}`,
      });
    } else {
      const toCancel = spotProtectiveToCancel(
        await fetchDemoSpotOpenOrders(venue, req.symbol),
      );
      for (const orderId of toCancel)
        await demoSpotCancelOrder(venue, req.symbol, orderId);
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
      const rules = await fetchDemoSymbolRules(
        futures.market,
        req.symbol,
        venue,
      );
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
        venue,
        req.symbol,
        req.direction === "long" ? "SELL" : "BUY",
        qty,
        futures.side,
        undefined,
        futures.market,
      );
      const exitPrice =
        order.avgPrice ||
        (await futuresFillPrice(
          venue,
          req.symbol,
          order.orderId,
          futures.market,
        ));
      steps.push({
        label: "Закрыть по рынку",
        ok: true,
        detail: `${qty} по ~${exitPrice ?? "рынку"}, ордер #${order.orderId}`,
      });
      return finish("closed", "Позиция закрыта по рынку.", exitPrice || null);
    }

    const rules = await fetchDemoSymbolRules("spot", req.symbol, venue);
    if (!rules) return finish("failed", `${req.symbol} нет на демо-споте.`);
    const baseAsset = req.symbol.replace(/USDT$/, "");
    const held = (await fetchDemoSpotHoldings(venue)).get(baseAsset) ?? 0;
    // Своё — купленное минус комиссия (по ставке: у старых строк fills входа нет).
    const qty = floorToStep(
      Math.min(held, spotNetQuantity(null, req.quantity)),
      rules.stepSize,
    );
    const price = await fetchDemoPrice("spot", req.symbol, venue);
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
    const order = await demoSpotMarketOrder(venue, req.symbol, "SELL", qty);
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
      venue.kind === "demo"
        ? "Не удалось закрыть позицию — проверьте на demo.binance.com."
        : "Не удалось закрыть позицию — закрытие повторится на следующем прогоне.",
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
  venue: TradeVenue,
  symbol: string,
  refs: DemoProtectRefs,
): Promise<ClosePlan> {
  if (refs.market !== "spot") {
    const market = refs.market;
    const [stop, takeProfit] = await Promise.all(
      [refs.stop, refs.takeProfit].map(async (r) => {
        const lookup = r && algoLookup(r);
        if (!lookup) return null;
        const q = await fetchDemoAlgoOrder(
          venue,
          lookup,
          protectMarketOf(market, symbol),
        );
        if (!q || !algoTriggered(q)) return algoLeg(q);
        return algoLeg(q, await triggeredQty(venue, symbol, q, market));
      }),
    );
    return planOwnClose({ stop: stop ?? null, takeProfit: takeProfit ?? null });
  }
  const [stop, takeProfit] = await Promise.all(
    [refs.stop, refs.takeProfit].map(async (r) =>
      r
        ? spotLeg(
            await fetchDemoSpotOrderByClientId(venue, symbol, r.clientOrderId),
          )
        : null,
    ),
  );
  return planOwnClose({ stop: stop ?? null, takeProfit: takeProfit ?? null });
}

/**
 * Сколько закрыла своя сработавшая algo-нога: actualQty, иначе executedQty рыночного ордера
 * actualOrderId. null — данных нет (тогда закрытие не докрывает остаток). Сбой сети не глотаем:
 * закрытие уйдёт в close_failed, и следующий прогон перечитает объём (ревью #66).
 */
async function triggeredQty(
  venue: TradeVenue,
  symbol: string,
  q: AlgoOrderQuery,
  market: VenueFuturesMarket,
): Promise<number | null> {
  if (q.actualQty > 0) return q.actualQty;
  if (q.actualOrderId === null) return null;
  const order = await fetchDemoFuturesOrder(
    venue,
    symbol,
    { orderId: q.actualOrderId },
    market,
  );
  return order && order.executedQty > 0 ? order.executedQty : null;
}

/** Снять свой ордер. Спот: снятие ордера из списка (OCO/OTOCO) снимает весь список. */
async function cancelOwn(
  venue: TradeVenue,
  symbol: string,
  refs: DemoProtectRefs,
  leg: "stop" | "takeProfit",
): Promise<boolean> {
  if (refs.market !== "spot") {
    const ref = refs[leg];
    const lookup = ref && algoLookup(ref);
    return lookup
      ? demoCancelAlgoOrder(venue, lookup, protectMarketOf(refs.market, symbol))
      : false;
  }
  const ref = refs[leg];
  return ref
    ? demoSpotCancelByClientId(venue, symbol, ref.clientOrderId)
    : false;
}

const LEG_LABEL = { stop: "стоп", takeProfit: "тейк" } as const;

/** clientOrderId своего закрытия: группа сделки из своего стопа/тейка + `-C`; нет — без id. */
function ownCloseId(refs: DemoProtectRefs): string | undefined {
  const ids =
    refs.market === "spot"
      ? [refs.stop?.clientOrderId, refs.takeProfit?.clientOrderId]
      : [refs.stop?.clientAlgoId, refs.takeProfit?.clientAlgoId];
  const group = ids.map(clientIdGroup).find((g) => g !== null);
  return group ? `${group}-C` : undefined;
}

/**
 * Закрытие по своим ордерам (PR 2b): ордера других зеркал и ручные ордера по символу не трогаем,
 * позицию докрываем только на свой объём.
 */
async function closeOwn(
  venue: TradeVenue,
  req: CloseDemoRequest,
  refs: DemoProtectRefs,
  steps: TradeStep[],
  finish: CloseFinish,
  removed: { value: boolean },
): Promise<CloseDemoResult> {
  // Своё закрытие — с id своей сделки (`bd…-C`): в «Демо-сделках» оно попадёт в свою сделку.
  const closeId = ownCloseId(refs);
  let plan: ClosePlan;
  // Статусы и исполненный объём своих ног: не прочитали — ничего не делаем, строка close_failed, и
  // крон повторит закрытие в следующем прогоне (без объёма ноги докрывать опасно — можно закрыть чужое).
  try {
    plan = await readOwnLegs(venue, req.symbol, refs);
  } catch (error) {
    steps.push({
      label: "Прочитать свои стоп/тейк",
      ok: false,
      detail: errorText(error),
    });
    return finish(
      "failed",
      "Не удалось прочитать свои стоп/тейк — закрытие повторится в следующем прогоне.",
    );
  }
  try {
    const cancelled: string[] = [];
    for (const leg of plan.cancel)
      if (await cancelOwn(venue, req.symbol, refs, leg)) {
        cancelled.push(LEG_LABEL[leg]);
        removed.value = true;
      }
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
      "Не удалось снять свои защитные ордера — позиция не закрыта, закрытие повторится в следующем прогоне.",
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
    // Объём своей сработавшей ноги неизвестен — остаток не докрываем (на стороне могут быть соседи).
    // Статус closed: нога reduceOnly закрывает свой объём, а повтор close_failed каждую минуту риск
    // не снимет; хвост, если он есть, виден в «Демо-сделках».
    if (verdict === "closedByExchange" && plan.soldUnknown) {
      // Отдельное событие: свой хвост мог остаться без защиты — видно в журнале и мониторе.
      log.warn(
        "trade.close_unverified",
        `${req.symbol}: своя нога сработала, её объём неизвестен — остаток не докрывали`,
        { ...req, steps },
      );
      return finish(
        "closed",
        "Позиция закрыта биржей (сработал стоп/тейк); исполненный объём своей ноги неизвестен — остаток не докрывали, чтобы не закрыть объём других зеркал.",
      );
    }
    return finish(
      "closed",
      verdict === "closedByExchange"
        ? "Позиция уже закрыта биржей (сработал стоп/тейк)."
        : "Позиция уже была закрыта на бирже.",
    );
  };

  try {
    const rules = await fetchDemoSymbolRules(req.market, req.symbol, venue);
    if (!rules)
      return finish(
        "failed",
        `${req.symbol} нет на ${venue.kind === "demo" ? "демо-рынке" : "рынке"} ${req.market}.`,
      );
    if (req.market !== "spot") {
      const market = req.market;
      // Своя сторона: в Hedge — строка LONG/SHORT, в One-way — общая позиция в сторону сделки.
      const side: FuturesSide = {
        mode: await fetchDemoPositionMode(venue, market),
        direction: req.direction,
      };
      const position = ownPosition(
        await demoFuturesPositions(venue, req.symbol, market),
        side,
      );
      // COIN-M: свой объём на бирже — контракты из ссылок (в строке зеркала — монетный эквивалент, spec 0056).
      const own = refs.market === "coinm" ? refs.contracts : req.quantity;
      const qty = floorToStep(
        // Минус закрытое своей сработавшей ногой: остальное на стороне — чужое.
        ownCloseQuantity(own, plan.soldByLegs, position.amount),
        rules.stepSize,
      );
      if (closeVerdict(plan, Number(qty)) !== "close")
        return nothingToClose(
          `своей позиции нет (своя сторона на бирже ${position.amount})`,
        );
      const order = await demoFuturesReduceMarket(
        venue,
        req.symbol,
        req.direction === "long" ? "SELL" : "BUY",
        qty,
        side,
        closeId,
        market,
      );
      const exitPrice =
        order.avgPrice ||
        (await futuresFillPrice(venue, req.symbol, order.orderId, market));
      steps.push({
        label: "Закрыть свой объём по рынку",
        ok: true,
        detail: `${qty} из ${Math.abs(position.amount)} по ~${exitPrice ?? "рынку"}, ордер #${order.orderId}`,
      });
      return finish("closed", "Позиция закрыта по рынку.", exitPrice || null);
    }

    const baseAsset = req.symbol.replace(/USDT$/, "");
    const held = (await fetchDemoSpotHoldings(venue)).get(baseAsset) ?? 0;
    // Свой объём — полученное нетто (купленное − комиссия), а не купленное: иначе продадим чужое.
    const own =
      refs.market === "spot"
        ? spotNetQuantity(refs.netQuantity, req.quantity)
        : req.quantity;
    const qty = floorToStep(
      ownCloseQuantity(own, plan.soldByLegs, held),
      rules.stepSize,
    );
    const price = await fetchDemoPrice("spot", req.symbol, venue);
    // Пыль биржа не продаст (-1013 NOTIONAL) — продавать нечего.
    const sellable = isDust(Number(qty), price, rules) ? 0 : Number(qty);
    if (closeVerdict(plan, sellable) !== "close")
      return nothingToClose(
        `${baseAsset}: к продаже ${qty} (~$${(Number(qty) * price).toFixed(2)}) — меньше минимального ордера`,
      );
    const order = await demoSpotMarketOrder(
      venue,
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
      venue.kind === "demo"
        ? "Не удалось закрыть позицию — проверьте на demo.binance.com."
        : "Не удалось закрыть позицию — закрытие повторится на следующем прогоне.",
    );
  }
}
