import type { TradeRequest, TradeResult, TradeStep } from "@/entities/trade";
import {
  type AlgoOrderQuery,
  demoCancelAlgoOrder,
  demoEnableHedgeMode,
  demoFuturesMarketOrder,
  demoFuturesPositions,
  demoFuturesPrepare,
  demoFuturesProtect,
  demoFuturesReduceMarket,
  type FuturesOrder,
  type FuturesSide,
  fetchDemoAlgoOrder,
  fetchDemoFuturesAccountBusy,
  fetchDemoFuturesOrder,
  fetchDemoFuturesSymbolState,
  fetchDemoPositionMode,
  orderErrorOutcome,
  type PositionMode,
  type SymbolRules,
  unknownOutcomeDeadline,
} from "@/shared/api/binance/demo.server";
import type { BinanceCredentials } from "@/shared/config/env.server";
import { FUTURES_AUTO_HEDGE, FUTURES_STOP_BEFORE_ENTRY } from "../config/trade";
import {
  afterAlgoUnknown,
  algoLookup,
  type StoredAlgoRef,
} from "../lib/closePlan";
import {
  choosePositionMode,
  futuresSequence,
  ownPosition,
  ownSideBusy,
} from "../lib/futuresMode";
import { tradeClientIds } from "../lib/spotEntry";
import {
  afterEarlyStopDrop,
  afterEntryError,
  afterFuturesOrderCheck,
  afterFuturesPositionCheck,
  afterFuturesRollback,
  afterFuturesStop,
  afterFuturesTakeProfit,
  afterPartialEntryRestop,
  afterStopBeforeEntry,
  type CancelResult,
  DEADLINE_BEFORE_ENTRY,
  type TradeOutcome,
  UNCONFIRMED_ENTRY,
} from "../lib/tradeOutcome";
import { floorToStep, type ValidatedTrade } from "../lib/validateTrade";
import { futuresFillPrice } from "./futuresFillPrice";
import {
  type Done,
  errorText,
  type Finish,
  type RefsHolder,
  recheckUntil,
  withPositionRetry,
} from "./tradeSteps";

export interface FuturesContext {
  creds: BinanceCredentials;
  req: TradeRequest;
  v: ValidatedTrade;
  rules: SymbolRules;
  price: number;
  tradeId: string;
  refs: RefsHolder;
  steps: TradeStep[];
  finish: Finish;
  done: Done;
  /** Общий срок сделки (config/trade → TRADE_DEADLINE_MS). */
  tradeDeadline: number;
}

const MODE_LABEL: Record<PositionMode, string> = {
  hedge: "Hedge (лонг и шорт раздельно)",
  oneway: "One-way (одна позиция на символ)",
};

const MODE_REASON = {
  hedge: MODE_LABEL.hedge,
  autoHedgeOff: `${MODE_LABEL.oneway}: автопереключение в Hedge выключено (config/trade → FUTURES_AUTO_HEDGE)`,
  accountBusy: `${MODE_LABEL.oneway}: на счёте есть позиции или ордера — Hedge не включить`,
  busyUnknown: `${MODE_LABEL.oneway}: не удалось проверить, пуст ли счёт, — Hedge не включаем`,
  switch: MODE_LABEL.hedge,
} as const;

/**
 * Режим позиций для входа (spec 0012, PR 2c). Автопереключение (FUTURES_AUTO_HEDGE) и пустой счёт —
 * включить Hedge; иначе вход в том режиме, что есть. null — режим узнать не удалось.
 */
async function resolveMode(
  creds: BinanceCredentials,
  steps: TradeStep[],
): Promise<PositionMode | null> {
  const label = "Режим позиций";
  let current: PositionMode;
  try {
    current = await fetchDemoPositionMode(creds);
  } catch (error) {
    steps.push({ label, ok: false, detail: errorText(error) });
    return null;
  }
  // Пустоту счёта проверяем, только если автопереключение включено: иначе POST не нужен вовсе.
  let busy: boolean | null = null;
  if (current === "oneway" && FUTURES_AUTO_HEDGE)
    try {
      busy = await fetchDemoFuturesAccountBusy(creds);
    } catch {
      busy = null;
    }
  const chosen = choosePositionMode(current, busy, FUTURES_AUTO_HEDGE);
  if (!chosen.enableHedge) {
    steps.push({ label, ok: true, detail: MODE_REASON[chosen.reason] });
    return chosen.mode;
  }
  try {
    const r = await demoEnableHedgeMode(creds);
    steps.push({
      label,
      ok: true,
      detail: `${r === "switched" ? "Включён" : "Уже включён"} ${MODE_LABEL.hedge}`,
    });
    return "hedge";
  } catch (error) {
    steps.push({
      label,
      ok: true,
      detail: `Hedge не включился (${errorText(error)}) — вход в ${MODE_LABEL.oneway}`,
    });
    return "oneway";
  }
}

/**
 * Фьючерсы: режим позиций → своя сторона свободна → маржа и плечо → вход по рынку и защита на свой
 * объём (стоп, затем тейк; «стоп до входа» — за флагом). Стоп не встал — откат по своей стороне.
 */
export async function placeFutures(c: FuturesContext): Promise<TradeResult> {
  const { creds, req, v, rules, price, steps, finish, done, refs } = c;
  const mode = await resolveMode(creds, steps);
  if (!mode)
    return finish(
      "rejected",
      "Не удалось узнать режим позиций демо-фьючерсов — сделка не отправлена, попробуйте ещё раз.",
    );
  const side: FuturesSide = { mode, direction: req.direction };
  const entrySide = req.direction === "long" ? "BUY" : "SELL";
  const exitSide: "BUY" | "SELL" = req.direction === "long" ? "SELL" : "BUY";

  // Ручной вход — только на свободную сторону; зеркало делит сторону с другими зеркалами (PR 2d),
  // но в One-way не входит против встречной позиции (закрыл бы её).
  // Своя сторона до входа: при неизвестном исходе свой объём — только прирост (на стороне соседи).
  let sideBefore = 0;
  try {
    const state = await fetchDemoFuturesSymbolState(creds, req.symbol);
    sideBefore = ownPosition(state.positions, side).amount;
    const busy = ownSideBusy(state, side, req.mirror === true);
    if (busy === "opposite")
      return finish(
        "rejected",
        `По ${req.symbol} есть встречная позиция — в One-way вход закрыл бы её; нужен Hedge mode.`,
      );
    if (busy)
      return finish(
        "rejected",
        mode === "hedge"
          ? `По ${req.symbol} уже есть ${req.direction === "long" ? "лонг" : "шорт"} или его ордера на демо-фьючерсах — сначала закройте их на demo.binance.com.`
          : `По ${req.symbol} уже есть позиция или ордера на демо-фьючерсах — сначала закройте их на demo.binance.com.`,
      );
  } catch (error) {
    return finish(
      "rejected",
      `Не удалось проверить открытые позиции — сделка не отправлена, попробуйте ещё раз. ${errorText(error)}`,
    );
  }

  try {
    const margin = await demoFuturesPrepare(creds, req.symbol, req.leverage);
    steps.push({
      label: "Маржа и плечо",
      ok: true,
      detail:
        margin === "isolated"
          ? `Изолированная, ×${req.leverage}`
          : `×${req.leverage}; тип маржи не менялся — по символу есть позиция или ордера`,
    });
  } catch (error) {
    steps.push({ label: "Маржа и плечо", ok: false, detail: errorText(error) });
    return finish(
      "rejected",
      "Не удалось настроить маржу/плечо — вход не отправлялся.",
    );
  }

  const ids = tradeClientIds(c.tradeId);
  const algoCtx = {
    creds,
    symbol: req.symbol,
    exitSide,
    side,
    steps,
    tradeDeadline: c.tradeDeadline,
  };
  const futuresRefs = {
    market: "usdm" as const,
    entryOrderId: null as number | null,
    // Ноги на свой объём (PR 2c): без этой метки строки 2b считаются legacy (planMirror).
    legs: "quantity" as const,
    stop: null as StoredAlgoRef | null,
    takeProfit: null as StoredAlgoRef | null,
  };
  // Ссылки — сразу: у rejected finish их отбросит, у unprotected сохранит (стоп «до входа» и т.п.).
  refs.current = futuresRefs;

  // «Стоп до входа» (AC10): стоп на объём заявки; не встал — вход не отправляем.
  const stopFirst =
    futuresSequence(mode, FUTURES_STOP_BEFORE_ENTRY) === "stopFirst";
  if (stopFirst) {
    const stop = await placeProtectiveAlgo(
      algoCtx,
      "STOP_MARKET",
      v.stopLoss,
      v.quantity,
      ids.stop,
    );
    // Ссылка — сразу: исход стопа мог быть неизвестен, а снять его не выйдет — закрытие строки снимет.
    futuresRefs.stop = stop.ref;
    const next = afterStopBeforeEntry(stop.placed);
    if (next !== "enter")
      return done(
        afterEarlyStopDrop(next, await cancelOwnAlgo(creds, stop.ref, steps)),
      );
  }
  // Вход не прошёл — снять стоп «до входа»; не снялся — unprotected со ссылкой на него, а не rejected.
  const failWithoutEntry = async (failed: TradeOutcome) =>
    done(
      stopFirst
        ? afterEarlyStopDrop(
            failed,
            await cancelOwnAlgo(creds, futuresRefs.stop, steps),
          )
        : failed,
    );

  if (Date.now() > c.tradeDeadline)
    return failWithoutEntry(DEADLINE_BEFORE_ENTRY);

  const entryLabel = `${req.direction === "long" ? "Лонг" : "Шорт"} по рынку`;
  let entryPrice: number;
  let filled: number;
  let unconfirmed = false;
  const sentAt = Date.now();
  try {
    const order = await demoFuturesMarketOrder(
      creds,
      req.symbol,
      entrySide,
      v.quantity,
      ids.market,
      side,
    );
    futuresRefs.entryOrderId = order.orderId;
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
      return failWithoutEntry(failed);
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
        c.tradeDeadline,
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
      return failWithoutEntry(byOrder);
    }
    if (byOrder !== "checkPosition") {
      const o = byOrder.filled;
      futuresRefs.entryOrderId = o.orderId;
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
          c.tradeDeadline,
          async () =>
            ownPosition(await demoFuturesPositions(creds, req.symbol), side),
          (p) => p.amount > sideBefore,
        );
      } catch (checkError) {
        steps.push({
          label: "Проверка позиции",
          ok: false,
          detail: errorText(checkError),
        });
      }
      const checked = afterFuturesPositionCheck(
        position,
        sideBefore,
        order === null ? "missing" : "unknown",
        Number(v.quantity),
      );
      if (!("protect" in checked)) {
        if (position)
          steps.push({
            label: "Проверка позиции",
            ok: true,
            detail: "Своей позиции нет",
          });
        // Позиции точно нет — стоп «до входа» снять; не проверили — оставить (он защищает).
        if (checked.status === "rejected") return failWithoutEntry(checked);
        return done(checked);
      }
      filled = checked.protect.amount;
      entryPrice = checked.protect.entryPrice || price;
      unconfirmed = checked.unconfirmed === true;
      steps.push({
        label: "Проверка позиции",
        ok: true,
        detail: unconfirmed
          ? `Свой ордер не найден, но на пустой до входа стороне появилась позиция ${filled} по ${entryPrice} — ставлю защиту, итог: не подтверждён`
          : `Позиция открыта: ${filled} по ${entryPrice} — ставлю защиту`,
      });
    }
  }
  // Защита — на свой исполненный объём (без closePosition): у каждого зеркала свои TP/SL.
  const protectQty = floorToStep(filled, rules.stepSize);
  // Стоп «до входа» стоит на объём заявки, а исполнено меньше — переставить на исполненный: в Hedge
  // стоп без reduceOnly при срабатывании закрыл бы лишнее (объём соседа). Новый — со своим id `-S2`
  // (не тем же, что снятый `-S`): перечитывание и снятие по clientAlgoId не спутают их.
  if (stopFirst && Number(protectQty) < Number(v.quantity)) {
    const cancel = await cancelOwnAlgo(creds, futuresRefs.stop, steps);
    const restop =
      cancel === "error"
        ? null
        : await placeProtectiveAlgo(
            algoCtx,
            "STOP_MARKET",
            v.stopLoss,
            protectQty,
            ids.protectStop,
          );
    if (restop) futuresRefs.stop = restop.ref;
    const next = afterPartialEntryRestop(cancel, restop?.placed ?? null);
    if (next === "rollback")
      return rollbackFutures({
        creds,
        req,
        rules,
        side,
        exitSide,
        entryPrice,
        filled,
        stopRef: restop?.ref ?? null,
        closeId: ids.close,
        steps,
        done,
      });
    if (next !== "continue") return done(next, entryPrice, filled);
  }
  // Вход не подтверждён биржей — защита ставится, но «protected» не объявляем (PR 2e).
  const doneEntry: Done = (o, e, f) =>
    done(unconfirmed && o.status === "protected" ? UNCONFIRMED_ENTRY : o, e, f);

  if (!stopFirst) {
    // Сначала стоп: не встал — позиция без защиты не остаётся, сразу закрываем её по рынку (AC5).
    // Стоп ставим и после общего срока сделки: позиция без стопа хуже лишних секунд.
    const stop = await placeProtectiveAlgo(
      algoCtx,
      "STOP_MARKET",
      v.stopLoss,
      protectQty,
      ids.stop,
    );
    futuresRefs.stop = stop.ref;
    const afterStop = afterFuturesStop(stop.placed, req.stopOnly === true);
    if (afterStop === "rollback")
      return rollbackFutures({
        creds,
        req,
        rules,
        side,
        exitSide,
        entryPrice,
        filled,
        stopRef: stop.ref,
        closeId: ids.close,
        steps,
        done,
      });
    if (afterStop !== "takeProfit")
      return doneEntry(afterStop, entryPrice, filled);
  } else {
    // Стоп «до входа» уже стоит; без тейка (stopOnly) — готово.
    const afterStop = afterFuturesStop(true, req.stopOnly === true);
    if (typeof afterStop !== "string")
      return doneEntry(afterStop, entryPrice, filled);
  }

  // Тейк после общего срока не ставим: стоп стоит, выход — вместе с paper-сделкой.
  if (Date.now() > c.tradeDeadline) {
    steps.push({
      label: "Take Profit",
      ok: false,
      detail: "Не выставлялся — истёк срок сделки (биржа долго отвечала)",
    });
    return doneEntry(afterFuturesTakeProfit(false), entryPrice, filled);
  }
  // Тейк с неизвестным исходом: protected (стоп стоит), но ссылка по clientAlgoId остаётся —
  // закрытие снимет висящий тейк.
  const tp = await placeProtectiveAlgo(
    algoCtx,
    "TAKE_PROFIT_MARKET",
    v.takeProfit,
    protectQty,
    ids.takeProfit,
  );
  futuresRefs.takeProfit = tp.ref;
  return doneEntry(afterFuturesTakeProfit(tp.placed), entryPrice, filled);
}

/**
 * Снять свой algo-ордер (стоп «до входа» сделки, которая не открылась, или на объём больше
 * исполненного). Результат решает исход (lib/tradeOutcome → afterEarlyStopDrop): ошибка — стоп мог
 * остаться на бирже.
 */
async function cancelOwnAlgo(
  creds: BinanceCredentials,
  ref: StoredAlgoRef | null,
  steps: TradeStep[],
): Promise<CancelResult> {
  const lookup = ref && algoLookup(ref);
  if (!lookup) return "none";
  try {
    const cancelled = await demoCancelAlgoOrder(creds, lookup);
    steps.push({
      label: "Снять свой стоп",
      ok: true,
      detail: cancelled ? "Снят" : "Уже не активен",
    });
    return cancelled ? "cancelled" : "inactive";
  } catch (error) {
    steps.push({
      label: "Снять свой стоп",
      ok: false,
      detail: errorText(error),
    });
    return "error";
  }
}

/**
 * Стоп или тейк на свой объём со своим clientAlgoId. Биржа отказала — не выставлен, ссылки нет.
 * Исход неизвестен (-1006/-1007, 5xx, сеть, таймаут) — перечитать по clientAlgoId до дедлайна от
 * последней попытки (lib/closePlan → afterAlgoUnknown): ссылка сохраняется в любом случае.
 */
async function placeProtectiveAlgo(
  c: {
    creds: BinanceCredentials;
    symbol: string;
    exitSide: "BUY" | "SELL";
    side: FuturesSide;
    steps: TradeStep[];
    tradeDeadline: number;
  },
  type: "STOP_MARKET" | "TAKE_PROFIT_MARKET",
  trigger: string,
  quantity: string,
  clientAlgoId: string,
): Promise<{ placed: boolean; ref: StoredAlgoRef | null }> {
  const label = type === "STOP_MARKET" ? "Stop Loss" : "Take Profit";
  // Время последней отправки: после повторов -4509/-2022 дедлайн считается от неё.
  let sentAt = Date.now();
  try {
    const algo = await withPositionRetry(() => {
      sentAt = Date.now();
      return demoFuturesProtect(
        c.creds,
        c.symbol,
        c.exitSide,
        type,
        trigger,
        quantity,
        c.side,
        clientAlgoId,
      );
    });
    c.steps.push({
      label,
      ok: true,
      detail: `${trigger} на ${quantity}, #${algo.algoId}`,
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
      c.tradeDeadline,
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

/**
 * Фьючерсы: стоп не встал — закрыть свою позицию по рынку (свой исполненный объём своей стороны) и
 * снять свой стоп, если он всё же встал (исход был неизвестен). Чужие ордера символа не трогаем.
 * Позиции нет — rejected без цены входа; не закрылась — unprotected (тревога).
 */
async function rollbackFutures(c: {
  creds: BinanceCredentials;
  req: TradeRequest;
  rules: SymbolRules;
  side: FuturesSide;
  exitSide: "BUY" | "SELL";
  entryPrice: number;
  filled: number;
  stopRef: StoredAlgoRef | null;
  /** Свой clientOrderId закрытия (`bd…-C`) — для истории «Демо-сделки». */
  closeId: string;
  steps: TradeStep[];
  done: Done;
}): Promise<TradeResult> {
  const { creds, req, steps } = c;
  const label = "Закрытие по рынку (стоп не встал)";
  try {
    const qty = floorToStep(c.filled, c.rules.stepSize);
    const order = await withPositionRetry(() =>
      demoFuturesReduceMarket(
        creds,
        req.symbol,
        c.exitSide,
        qty,
        c.side,
        c.closeId,
      ),
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
  await cancelOwnAlgo(creds, c.stopRef, steps);
  return c.done(afterFuturesRollback(true));
}
