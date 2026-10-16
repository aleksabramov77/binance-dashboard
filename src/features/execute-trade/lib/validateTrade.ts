import type { TradeRequest } from "@/entities/trade";
import type { PriceBand, SymbolRules } from "@/shared/api/binance/demo.server";
import {
  SPOT_ENTRY_SLIPPAGE,
  SPOT_ENTRY_SLIPPAGE_TEXT,
  SPOT_TAKER_FEE,
  SPOT_TAKER_FEE_TEXT,
} from "../config/spot";

/** Число знаков после запятой у шага биржи: "0.00010000" → 4, "1" → 0. */
export function stepDecimals(step: string): number {
  const fraction = step.split(".")[1]?.replace(/0+$/, "") ?? "";
  return fraction.length;
}

/** Округляет вниз к шагу и форматирует строкой без экспоненты. */
export function floorToStep(value: number, step: string): string {
  const s = Number(step);
  const steps = Math.floor(value / s + 1e-9);
  return (steps * s).toFixed(stepDecimals(step));
}

/** Округляет к ближайшему шагу цены. */
export function roundToTick(value: number, tick: string): string {
  const t = Number(tick);
  return (Math.round(value / t) * t).toFixed(stepDecimals(tick));
}

/** Во сколько раз можно поднять объём до минимума символа (fitMinNotional). */
export const MAX_MIN_NOTIONAL_BUMP = 3;

/**
 * Количество, поднятое до minNotional символа с запасом 1% и округлением вверх к шагу,
 * если объём после округления вниз к шагу ниже минимума не больше чем в MAX_MIN_NOTIONAL_BUMP раз
 * и поднятый объём не выше maxNotionalUsd; иначе — как было.
 * Объём сравнивается уже округлённым: $50 у BTCUSDT-фьючерсов (шаг 0,0001) ровно на минимуме,
 * но после округления вниз — 0,0006 BTC ≈ $48,99 (spec 0012, AC1).
 */
export function fitToMinNotional(
  quantity: number,
  price: number,
  rules: Pick<SymbolRules, "stepSize" | "minNotional">,
  maxNotionalUsd = Number.POSITIVE_INFINITY,
): number {
  const notional = Number(floorToStep(quantity, rules.stepSize)) * price;
  if (notional >= rules.minNotional || price <= 0) return quantity;
  if (rules.minNotional > quantity * price * MAX_MIN_NOTIONAL_BUMP)
    return quantity;
  const step = Number(rules.stepSize);
  const fitted =
    Math.ceil((rules.minNotional * 1.01) / price / step - 1e-9) * step;
  return fitted * price > maxNotionalUsd ? quantity : fitted;
}

/** Спот: сколько продавать стопом/тейком — купленное минус комиссия в монете, вниз к шагу. */
export const spotSellQuantity = (
  quantity: string | number,
  stepSize: string,
  feeRate = SPOT_TAKER_FEE,
) => floorToStep(Number(quantity) * (1 - feeRate), stepSize);

/**
 * Спот: на сколько долларов продаст стоп. Стоп продаёт купленное за вычетом комиссии, а биржа
 * проверяет NOTIONAL отложенного STOP_LOSS по цене стопа — демо 2026-10-15: OTO на 31 BAT по 0,1705,
 * стоп 30 BAT × 0,16 = $4,8 < $5 → -1013 NOTIONAL, заявка отклонена целиком; со стопом 0,167 ($5,01) прошла.
 */
export const spotStopNotional = (
  quantity: number,
  stopLoss: number,
  stepSize: string,
) => Number(spotSellQuantity(quantity, stepSize)) * stopLoss;

/**
 * fitMinNotional для спота: объём, при котором и стоп после комиссии не меньше minNotional
 * (с запасом 1%). Те же пределы, что у fitToMinNotional: не больше чем в MAX_MIN_NOTIONAL_BUMP раз
 * и не выше maxNotionalUsd; иначе — как было.
 */
export function fitSpotStopToMinNotional(
  quantity: number,
  price: number,
  stopLoss: number,
  rules: Pick<SymbolRules, "stepSize" | "minNotional">,
  maxNotionalUsd = Number.POSITIVE_INFINITY,
): number {
  if (
    stopLoss <= 0 ||
    spotStopNotional(quantity, stopLoss, rules.stepSize) >= rules.minNotional
  )
    return quantity;
  const step = Number(rules.stepSize);
  let fitted =
    Math.ceil(
      (rules.minNotional * 1.01) / stopLoss / (1 - SPOT_TAKER_FEE) / step -
        1e-9,
    ) * step;
  // Округление продажи вниз к шагу может съесть шаг — добавляем, пока стоп не пройдёт.
  for (
    let i = 0;
    i < 3 &&
    spotStopNotional(fitted, stopLoss, rules.stepSize) < rules.minNotional;
    i++
  )
    fitted += step;
  if (
    fitted > quantity * MAX_MIN_NOTIONAL_BUMP ||
    fitted * price > maxNotionalUsd
  )
    return quantity;
  return fitted;
}

/** Запас от границы фильтра цены биржи — доля текущей цены (средняя цена биржи от неё отстаёт). */
export const PRICE_BAND_MARGIN = 0.01;

/**
 * Уровень выхода, подтянутый внутрь фильтра PERCENT_PRICE_BY_SIDE / PERCENT_PRICE с запасом
 * PRICE_BAND_MARGIN. Выход лонга — SELL (ask), шорта — BUY (bid). Цена фильтра — средняя за
 * 5 минут; берём текущую как приближение. null — уровень и так в пределах фильтра.
 */
export function fitToPriceBand(
  level: number,
  price: number,
  band: PriceBand,
  exitSide: "BUY" | "SELL",
): number | null {
  const up = exitSide === "SELL" ? band.askUp : band.bidUp;
  const down = exitSide === "SELL" ? band.askDown : band.bidDown;
  if (level < price * down) return price * (down + PRICE_BAND_MARGIN);
  if (level > price * up) return price * (up - PRICE_BAND_MARGIN);
  return null;
}

export interface ValidatedTrade {
  quantity: string;
  stopLoss: string;
  takeProfit: string;
  notionalUsd: number;
  /** Что поправлено под правила биржи (стоп/тейк подтянуты к фильтру цены) — шаги заявки. */
  adjustments: string[];
}

export interface TradeContext {
  /** Текущая цена на демо. */
  price: number;
  rules: SymbolRules;
  maxNotionalUsd: number;
  /** Свободные USDT на кошельке, которым торгуем (Spot или USDⓈ-M Futures). */
  availableUsd: number;
  /** Максимальная потеря на стопе, доля баланса кошелька. */
  maxRiskPct: number;
}

const usd = (v: number) => `$${v.toFixed(2)}`;

/** Проверяет заявку перед отправкой: направление, стороны TP/SL, шаги, лимиты, деньги и риск. */
export function validateTrade(
  req: TradeRequest,
  ctx: TradeContext,
): { ok: true; value: ValidatedTrade } | { ok: false; errors: string[] } {
  const { price, rules, maxNotionalUsd, availableUsd, maxRiskPct } = ctx;
  const errors: string[] = [];
  if (req.direction === "short" && req.market !== "usdm")
    errors.push("Шорт возможен только на фьючерсах.");
  if (req.market === "spot" && req.leverage !== 1)
    errors.push("На Spot плечо не используется.");

  const isLong = req.direction === "long";
  if (isLong && !(req.stopLoss < price && price < req.takeProfit))
    errors.push(
      `Для лонга нужно SL < цена (${price}) < TP — уровни устарели, пересканируйте.`,
    );
  if (!isLong && !(req.takeProfit < price && price < req.stopLoss))
    errors.push(
      `Для шорта нужно TP < цена (${price}) < SL — уровни устарели, пересканируйте.`,
    );

  // Стоп/тейк за фильтром цены биржа отклонит (-1013 PERCENT_PRICE_BY_SIDE): страховочный стоп
  // −50% у сделок без стопа, «дальний» тейк. Подтягиваем к границе — до проверки риска.
  const adjustments: string[] = [];
  let stopLoss = req.stopLoss;
  let takeProfit = req.takeProfit;
  if (rules.priceBand && errors.length === 0) {
    const exitSide = isLong ? "SELL" : "BUY";
    const stop = fitToPriceBand(stopLoss, price, rules.priceBand, exitSide);
    if (stop !== null && (isLong ? stop < price : stop > price)) {
      adjustments.push(
        `Стоп подтянут к границе фильтра биржи: ${roundToTick(stopLoss, rules.tickSize)} → ${roundToTick(stop, rules.tickSize)}`,
      );
      stopLoss = stop;
    }
    // Без тейка на бирже (stopOnly) его уровень никуда не уходит — не трогаем.
    const tp = req.stopOnly
      ? null
      : fitToPriceBand(takeProfit, price, rules.priceBand, exitSide);
    if (tp !== null && (isLong ? tp > price : tp < price)) {
      adjustments.push(
        `Тейк подтянут к границе фильтра биржи: ${roundToTick(takeProfit, rules.tickSize)} → ${roundToTick(tp, rules.tickSize)}`,
      );
      takeProfit = tp;
    }
  }

  const isSpot = req.market === "spot";
  // Стоп — как уйдёт на биржу (к тику): по нему биржа считает NOTIONAL стопа спота.
  const stopAtExchange = Number(roundToTick(stopLoss, rules.tickSize));
  const quantity = floorToStep(
    req.fitMinNotional
      ? Math.max(
          fitToMinNotional(req.quantity, price, rules, maxNotionalUsd),
          isSpot
            ? fitSpotStopToMinNotional(
                req.quantity,
                price,
                stopAtExchange,
                rules,
                maxNotionalUsd,
              )
            : 0,
        )
      : req.quantity,
    rules.stepSize,
  );
  const qty = Number(quantity);
  const notionalUsd = qty * price;
  if (qty <= 0 || qty < rules.minQty)
    errors.push(`Количество меньше минимального (${rules.minQty}).`);
  if (notionalUsd < rules.minNotional)
    errors.push(
      `Объём $${notionalUsd.toFixed(2)} меньше минимального для символа ($${rules.minNotional}).`,
    );
  else if (isSpot && errors.length === 0) {
    // Покупка проходит, а стоп на купленное минус комиссия — нет: биржа отклонит всю заявку.
    const stopUsd = spotStopNotional(qty, stopAtExchange, rules.stepSize);
    if (stopUsd < rules.minNotional)
      errors.push(
        `Стоп продаст ${spotSellQuantity(qty, rules.stepSize)} (куплено минус комиссия ${SPOT_TAKER_FEE_TEXT}) по ${roundToTick(stopLoss, rules.tickSize)} — это $${stopUsd.toFixed(2)}, меньше минимального ордера ($${rules.minNotional}): биржа отклонит заявку. Увеличьте количество.`,
      );
  }
  if (notionalUsd > maxNotionalUsd)
    errors.push(
      `Объём $${notionalUsd.toFixed(2)} больше лимита на демо-сделку ($${maxNotionalUsd}).`,
    );

  const wallet = req.market === "spot" ? "Spot" : "USDⓈ-M Futures";
  // Спот покупается LIMIT FOK по цене +SPOT_ENTRY_SLIPPAGE — биржа блокирует USDT по лимитной цене.
  const requiredUsd = isSpot
    ? notionalUsd * (1 + SPOT_ENTRY_SLIPPAGE)
    : notionalUsd / req.leverage;
  if (availableUsd <= 0) {
    errors.push(
      `На демо-кошельке ${wallet} 0 USDT — пополните его на demo.binance.com.`,
    );
  } else {
    if (requiredUsd > availableUsd)
      errors.push(
        `Нужно ${usd(requiredUsd)} ${isSpot ? `USDT (с запасом ${SPOT_ENTRY_SLIPPAGE_TEXT} на цену покупки)` : "маржи"}, а на ${wallet} свободно ${usd(availableUsd)}.`,
      );
    const lossAtStop = qty * Math.abs(price - stopLoss);
    const maxLoss = availableUsd * maxRiskPct;
    if (lossAtStop > maxLoss)
      errors.push(
        `Потеря на стопе ${usd(lossAtStop)} больше ${Math.round(maxRiskPct * 100)}% баланса ${wallet} (${usd(maxLoss)}) — уменьшите количество.`,
      );
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      quantity,
      stopLoss: roundToTick(stopLoss, rules.tickSize),
      takeProfit: roundToTick(takeProfit, rules.tickSize),
      notionalUsd,
      adjustments,
    },
  };
}

/**
 * Остаток, который биржа не даст продать: меньше minQty или дешевле minNotional (фильтры
 * LOT_SIZE / NOTIONAL, ошибка -1013). Например, хвост монет после комиссии, когда позицию уже
 * закрыл TP/SL на бирже. Такую позицию считаем закрытой.
 */
export function isDust(
  quantity: number,
  price: number,
  rules: Pick<SymbolRules, "minQty" | "minNotional">,
): boolean {
  return (
    quantity <= 0 ||
    quantity < rules.minQty ||
    quantity * price < rules.minNotional
  );
}
