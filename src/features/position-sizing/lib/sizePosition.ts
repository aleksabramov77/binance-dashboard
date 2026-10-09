import type { Setup } from "@/entities/market-signal";

export const MAX_LEVERAGE = 3;

export interface RiskSettings {
  /** Капитал под торговлю, USD. */
  capital: number;
  /** Риск на сделку, доля капитала (0.01 = 1%). */
  riskPct: number;
  /** Максимальный объём позиции на сделку, USD. */
  maxNotional: number;
  /** Плечо для фьючерсов (1–3). */
  leverage: number;
}

export interface PositionSize {
  quantity: number;
  notionalUsd: number;
  /** Сколько своих денег уходит в сделку: объём для Spot, маржа для фьючерсов. */
  marginUsd: number;
  leverage: number;
  lossAtStopUsd: number;
  profitAtTp1Usd: number;
  profitAtTp2Usd: number;
  /** Объём урезан лимитом на сделку. */
  cappedByLimit: boolean;
}

/** Размер позиции так, чтобы стоп стоил не больше заданного риска и лимита на сделку. */
export function sizePosition(
  setup: Setup,
  settings: RiskSettings,
): PositionSize {
  const riskPerUnit = Math.abs(setup.entry - setup.stopLoss);
  const riskUsd = settings.capital * settings.riskPct;
  let quantity = riskPerUnit > 0 ? riskUsd / riskPerUnit : 0;
  const cappedByLimit = quantity * setup.entry > settings.maxNotional;
  if (cappedByLimit) quantity = settings.maxNotional / setup.entry;

  const leverage =
    setup.market === "futures"
      ? Math.min(Math.max(1, Math.round(settings.leverage)), MAX_LEVERAGE)
      : 1;
  const notionalUsd = quantity * setup.entry;
  return {
    quantity,
    notionalUsd,
    marginUsd: notionalUsd / leverage,
    leverage,
    lossAtStopUsd: quantity * riskPerUnit,
    profitAtTp1Usd: quantity * Math.abs(setup.takeProfit1 - setup.entry),
    profitAtTp2Usd: quantity * Math.abs(setup.takeProfit2 - setup.entry),
    cappedByLimit,
  };
}
