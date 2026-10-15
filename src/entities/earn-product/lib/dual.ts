import type { DualOffer } from "../model/schema";

const DAYS_IN_YEAR = 365;

/** Расстояние от текущей цены до страйка: +0.05 — страйк на 5 % выше цены. */
export function distanceToStrike(
  strike: number,
  price: number | null,
): number | null {
  if (!price || price <= 0) return null;
  return (strike - price) / price;
}

/** Доход за срок, доля от вложенного: APR × дни / 365 (простые проценты, как считает Binance). */
export function dualReturn(offer: Pick<DualOffer, "apr" | "durationDays">) {
  return (offer.apr * offer.durationDays) / DAYS_IN_YEAR;
}

/** Что вкладываешь: монету у Sell High, стейбл у Buy Low. */
export const dualInvestAsset = (offer: DualOffer) =>
  offer.side === "sell-high" ? offer.coin : offer.stable;

export interface DualEvaluation {
  /** Сумма в единицах вкладываемого актива. */
  investAmount: number;
  /** Доход за срок в $ (платят при любом исходе). */
  incomeUsd: number;
  /** Доход за срок, доля. */
  periodReturn: number;
  /**
   * Цена, по которой фактически продаёшь (Sell High: страйк × (1 + r))
   * или покупаешь (Buy Low: страйк / (1 + r)) монету с учётом дохода.
   */
  effectivePrice: number;
  belowMinimum: boolean;
  aboveMaximum: boolean;
}

/** Оценка предложения для суммы в $; стейбл считаем равным $1. */
export function evaluateDual(
  offer: DualOffer,
  amountUsd: number,
): DualEvaluation | null {
  if (amountUsd <= 0) return null;
  const r = dualReturn(offer);
  let investAmount = amountUsd;
  if (offer.side === "sell-high") {
    if (!offer.price) return null;
    investAmount = amountUsd / offer.price;
  }
  return {
    investAmount,
    incomeUsd: amountUsd * r,
    periodReturn: r,
    effectivePrice:
      offer.side === "sell-high"
        ? offer.strikePrice * (1 + r)
        : offer.strikePrice / (1 + r),
    belowMinimum: investAmount < offer.minAmount,
    aboveMaximum: offer.maxAmount > 0 && investAmount > offer.maxAmount,
  };
}

export interface DualOutcome {
  asset: string;
  amount: number;
}

export interface DualScenarios {
  invest: DualOutcome;
  /** Цена на дату расчёта дошла до страйка: Sell High — ≥ страйка, Buy Low — ≤ страйка. */
  exercised: DualOutcome;
  /** Не дошла: возвращается то же, что вложил, плюс доход. */
  notExercised: DualOutcome;
  strikePrice: number;
  effectivePrice: number;
  /** Оценка суммы, из которой посчитаны исходы. */
  evaluation: DualEvaluation;
}

/** Два исхода на дату расчёта — виджет превращает их в слова. */
export function dualScenarios(
  offer: DualOffer,
  amountUsd: number,
): DualScenarios | null {
  const evaluation = evaluateDual(offer, amountUsd);
  if (!evaluation) return null;
  const { investAmount, periodReturn: r, effectivePrice } = evaluation;
  const grown = investAmount * (1 + r);
  const sellHigh = offer.side === "sell-high";
  return {
    invest: { asset: dualInvestAsset(offer), amount: investAmount },
    exercised: sellHigh
      ? { asset: offer.stable, amount: grown * offer.strikePrice }
      : { asset: offer.coin, amount: grown / offer.strikePrice },
    notExercised: { asset: dualInvestAsset(offer), amount: grown },
    strikePrice: offer.strikePrice,
    effectivePrice,
    evaluation,
  };
}
