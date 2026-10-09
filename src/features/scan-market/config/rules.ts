/** Пороги сканера и правил. Меняются здесь — без правки логики. */
export const SCAN_CONFIG = {
  /** Минимальный оборот за 24 ч, USD. */
  minFuturesVolumeUsd: 20_000_000,
  minSpotVolumeUsd: 5_000_000,
  /** Сколько лидеров роста и падения анализируем. */
  topN: 12,
  /** Кэш результата сканирования, мс. */
  cacheTtlMs: 60_000,
} as const;

export const REBOUND_LONG = {
  maxChange24h: -0.07,
  maxRsi1h: 35,
  maxDistanceAtr: -2,
} as const;

export const OVERHEAT_SHORT = {
  minChange24h: 0.12,
  minRsi1h: 70,
  minDistanceAtr: 2.5,
} as const;

export const RISK_RULES = {
  /** Стоп за экстремумом последних N свечей 1h. */
  swingLookback: 12,
  /** Отступ стопа за экстремум, в ATR. */
  stopBufferAtr: 0.25,
  minStopAtr: 0.8,
  maxStopAtr: 3,
  /** Сетапы с R:R до TP1 ниже порога не показываем. */
  minRr: 1,
} as const;
