/** Правила размера paper-сделки (решение пользователя 2026-10-10). */
export const SIZING = {
  /** Потеря на стопе — 0,5% стартового бюджета эксперимента. */
  riskPct: 0.005,
  /** Объём позиции — не больше 10% стартового бюджета. */
  maxNotionalPct: 0.1,
  /** Меньше этого объёма не входим (минимальный ордер Binance). */
  minNotionalUsd: 5,
} as const;

export interface SizeInput {
  entry: number;
  /** null — без стопа (buy & hold): объём по лимиту. */
  stop: number | null;
  initialBudget: number;
  /** Свободно для входа, USD: spot — кэш, futures — свободная маржа. */
  availableUsd: number;
  /** Плечо: 1 для spot. Маржа = объём / плечо. */
  leverage: number;
}

export interface PositionSize {
  quantity: number;
  notional: number;
  /** Сколько потеряем на стопе (без комиссий); null — без стопа. */
  riskUsd: number | null;
  /** Маржа (spot — весь объём). */
  margin: number;
}

/** Объём от риска 0,5% стартового бюджета, урезанный лимитом 10% и свободными деньгами. null — входить не на что. */
export function sizePosition(
  input: SizeInput,
  rules: typeof SIZING = SIZING,
): PositionSize | null {
  const { entry, stop, initialBudget, availableUsd, leverage } = input;
  if (entry <= 0 || initialBudget <= 0 || leverage < 1) return null;
  const riskPerUnit = stop === null ? null : Math.abs(entry - stop);
  if (riskPerUnit === 0) return null;

  const cap = Math.min(
    rules.maxNotionalPct * initialBudget,
    Math.max(0, availableUsd) * leverage,
  );
  const byRisk =
    riskPerUnit === null
      ? Number.POSITIVE_INFINITY
      : (rules.riskPct * initialBudget) / riskPerUnit;
  const quantity = Math.min(byRisk, cap / entry);
  const notional = quantity * entry;
  if (!Number.isFinite(quantity) || notional < rules.minNotionalUsd)
    return null;
  return {
    quantity,
    notional,
    riskUsd: riskPerUnit === null ? null : quantity * riskPerUnit,
    margin: notional / leverage,
  };
}
