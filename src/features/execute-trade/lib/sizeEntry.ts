import type { SymbolRules } from "@/shared/api/binance/demo.server";
import { SPOT_TAKER_FEE } from "../config/spot";
import { spotStopNotional, stepDecimals } from "./validateTrade";

// Объём входа на заданную сумму (spec 0049, реальное зеркало): $10 после округления по шагу символа; минимум биржи
// выше — объём поднимается до минимума (с запасом 1%), но минимум не выше maxUsd ($50), иначе вход пропускается.

/**
 * Почему объём выше $10: minNotional — минимум ордера биржи; minQty — минимальное количество монеты; spotStop — стоп
 * спота продаёт купленное минус комиссия по цене стопа, и этот объём тоже должен пройти минимум ордера.
 */
export type EntryRaise = "minNotional" | "minQty" | "spotStop";

export type EntrySize =
  | {
      ok: true;
      /** Количество, кратное шагу символа. */
      quantity: number;
      /** Объём по текущей цене, $. */
      notionalUsd: number;
      /** Почему объём поднят выше цели; null — не поднят. */
      raised: EntryRaise | null;
    }
  | {
      ok: false;
      /** Минимум биржи для входа, $ (без запаса). */
      minUsd: number;
    };

const MIN_MARGIN = 1.01;

/**
 * Минимальное количество для входа: minQty, minNotional; у спота ещё стоп после комиссии 0,1% по цене стопа не
 * дешевле minNotional (иначе биржа отклонит всю заявку OTOCO, spec 0012).
 */
function minQuantity(
  price: number,
  rules: Pick<SymbolRules, "minQty" | "minNotional">,
  spotStop: number | null,
): { qty: number; by: EntryRaise } {
  const options: [number, EntryRaise][] = [
    [rules.minNotional / price, "minNotional"],
    [rules.minQty, "minQty"],
    [
      spotStop && spotStop > 0
        ? rules.minNotional / spotStop / (1 - SPOT_TAKER_FEE)
        : 0,
      "spotStop",
    ],
  ];
  const [qty, by] = options.reduce((a, b) => (b[0] > a[0] ? b : a));
  return { qty, by };
}

export function sizeEntry(input: {
  price: number;
  rules: Pick<SymbolRules, "minQty" | "minNotional" | "stepSize">;
  targetUsd: number;
  maxUsd: number;
  /** Спот: цена стопа (стоп продаёт купленное минус комиссия — его объём тоже должен пройти minNotional). */
  spotStop: number | null;
}): EntrySize {
  const { price, rules, targetUsd, maxUsd, spotStop } = input;
  const step = Number(rules.stepSize);
  // k × шаг в двоичной арифметике даёт 0,30000000000000004 — фиксируем знаки шага.
  const steps = (k: number) =>
    Number((k * step).toFixed(stepDecimals(rules.stepSize)));
  const { qty: qMin, by } = minQuantity(price, rules, spotStop);
  const minUsd = qMin * price;
  if (price <= 0 || step <= 0 || minUsd > maxUsd) return { ok: false, minUsd };

  const atTarget = steps(Math.floor(targetUsd / price / step + 1e-9));
  if (atTarget >= qMin * MIN_MARGIN)
    return {
      ok: true,
      quantity: atTarget,
      notionalUsd: atTarget * price,
      raised: null,
    };
  let k = Math.ceil((qMin * MIN_MARGIN) / step - 1e-9);
  // Запас 1% не должен выводить за maxUsd: минимум BTC-фьючерсов $50 при шаге $10 — ровно минимум, а не $60.
  if (steps(k) * price > maxUsd) k = Math.ceil(qMin / step - 1e-9);
  // Продажа стопа спота округляется вниз к шагу — добавляем шаг, пока стоп не пройдёт минимум.
  for (
    let i = 0;
    spotStop &&
    i < 3 &&
    spotStopNotional(steps(k), spotStop, rules.stepSize) < rules.minNotional;
    i++
  )
    k++;
  const quantity = steps(k);
  return {
    ok: true,
    quantity,
    notionalUsd: quantity * price,
    raised: by,
  };
}
