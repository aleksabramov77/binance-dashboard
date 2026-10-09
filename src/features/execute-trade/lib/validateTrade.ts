import type { TradeRequest } from "@/entities/trade";
import type { SymbolRules } from "@/shared/api/binance/demo.server";

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

export interface ValidatedTrade {
  quantity: string;
  stopLoss: string;
  takeProfit: string;
  notionalUsd: number;
}

/** Проверяет заявку перед отправкой: направление, стороны TP/SL, шаги и лимиты. */
export function validateTrade(
  req: TradeRequest,
  price: number,
  rules: SymbolRules,
  maxNotionalUsd: number,
): { ok: true; value: ValidatedTrade } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (req.direction === "short" && req.market !== "futures")
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

  const quantity = floorToStep(req.quantity, rules.stepSize);
  const qty = Number(quantity);
  const notionalUsd = qty * price;
  if (qty <= 0 || qty < rules.minQty)
    errors.push(`Количество меньше минимального (${rules.minQty}).`);
  if (notionalUsd < rules.minNotional)
    errors.push(
      `Объём $${notionalUsd.toFixed(2)} меньше минимального для символа ($${rules.minNotional}).`,
    );
  if (notionalUsd > maxNotionalUsd)
    errors.push(
      `Объём $${notionalUsd.toFixed(2)} больше лимита на демо-сделку ($${maxNotionalUsd}).`,
    );

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      quantity,
      stopLoss: roundToTick(req.stopLoss, rules.tickSize),
      takeProfit: roundToTick(req.takeProfit, rules.tickSize),
      notionalUsd,
    },
  };
}
