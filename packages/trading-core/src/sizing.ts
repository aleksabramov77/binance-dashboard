/** Правила размера paper-сделки (решение пользователя 2026-10-10). */
export const SIZING = {
  /** Потеря на стопе — 0,5% стартового бюджета эксперимента. */
  riskPct: 0.005,
  /** Объём позиции — не больше 10% стартового бюджета. */
  maxNotionalPct: 0.1,
  /** Меньше этого объёма не входим (минимальный ордер Binance). */
  minNotionalUsd: 5,
} as const;

/** Запас на погрешность плавающей точки при округлении до целых контрактов. */
const EPS = 1e-9;

export interface SizeInput {
  entry: number;
  /** null — без стопа (buy & hold): объём по лимиту. */
  stop: number | null;
  initialBudget: number;
  /** Свободно для входа, USD: spot — кэш, фьючерсы — свободная маржа. */
  availableUsd: number;
  /** Плечо: 1 для spot. Маржа = объём / плечо. */
  leverage: number;
  /**
   * Фиксированный объём сделки, USD (решение пользователя 2026-10-10: $50). Задан — риск и лимит 10%
   * не применяются, объём урезается только свободными деньгами.
   */
  fixedNotionalUsd?: number;
  /**
   * Размер контракта COIN-M, USD (BTC — 100, остальные — 10; spec 0023). Задан — объём округляется
   * вниз до целых контрактов, минимум 1 контракт (если на него хватает денег); количество в монете =
   * контракты × размер / цена входа: PnL инверсного контракта в $ тогда считается как у линейного.
   */
  contractSizeUsd?: number;
}

export interface PositionSize {
  quantity: number;
  notional: number;
  /** Сколько потеряем на стопе (без комиссий); null — без стопа. */
  riskUsd: number | null;
  /** Маржа (spot — весь объём). */
  margin: number;
}

/**
 * Объём сделки: фиксированный fixedNotionalUsd, если задан, иначе от риска 0,5% стартового бюджета с
 * лимитом 10%; в обоих случаях — не больше свободных денег. null — входить не на что.
 */
export function sizePosition(
  input: SizeInput,
  rules: typeof SIZING = SIZING,
): PositionSize | null {
  const { entry, stop, initialBudget, availableUsd, leverage } = input;
  if (entry <= 0 || initialBudget <= 0 || leverage < 1) return null;
  const riskPerUnit = stop === null ? null : Math.abs(entry - stop);
  if (riskPerUnit === 0) return null;

  const free = Math.max(0, availableUsd) * leverage;
  const fixed = input.fixedNotionalUsd;
  const cap =
    fixed !== undefined
      ? Math.min(fixed, free)
      : Math.min(rules.maxNotionalPct * initialBudget, free);
  const byRisk =
    fixed !== undefined || riskPerUnit === null
      ? Number.POSITIVE_INFINITY
      : (rules.riskPct * initialBudget) / riskPerUnit;
  let quantity = Math.min(byRisk, cap / entry);
  const contract = input.contractSizeUsd;
  if (contract !== undefined) {
    if (!(contract > 0)) return null;
    // Контракты — от объёма в $, а не от quantity × entry: деление и обратное умножение на цену
    // теряют точность ($50 / 5434 × 5434 = 49,999…) и давали 4 контракта вместо 5.
    const wantedUsd = Math.min(cap, byRisk * entry);
    const contracts = Math.min(
      Math.max(1, Math.floor(wantedUsd / contract + EPS)),
      Math.floor(free / contract + EPS),
    );
    if (contracts < 1) return null;
    quantity = (contracts * contract) / entry;
  }
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
