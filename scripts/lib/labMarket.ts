// Контекст рынка для отчёта лаборатории: режим BTC на начало и на конец периода (тренд / флэт по EMA200 и ADX на
// 4h), доходность и просадка за период, доходность по дням. Чистый расчёт — computeMarketContext; загрузка свечей
// публичным API Binance (без ключа) — loadMarketContext. Нужен скиллу trading-lab, чтобы отличать «стратегия
// сломалась» от «сменился режим».
import { adxSeries, atrSeries, ema } from "@binance-dashboard/trading-core";
import { type Candle, fetchKlines } from "@/shared/api/binance/market";

export const H4 = 4 * 3_600_000;
export const D1 = 24 * 3_600_000;

/** Пороги режима по ADX(14) на 4h: ≥ 25 — тренд, < 20 — флэт, между — слабый дрейф. */
export const REGIME = { trendAdx: 25, rangeAdx: 20 } as const;

export type Regime =
  | "trend-up"
  | "trend-down"
  | "drift-up"
  | "drift-down"
  | "range"
  | "unknown";

export const REGIME_LABEL: Record<Regime, string> = {
  "trend-up": "тренд вверх",
  "trend-down": "тренд вниз",
  "drift-up": "слабый рост",
  "drift-down": "слабое снижение",
  range: "флэт",
  unknown: "не определён",
};

export interface MarketContext {
  symbol: string;
  /** Последняя цена (close последней 4h-свечи, возможно незакрытой). */
  lastPrice: number;
  /** Доходность за период отчёта, %: от цены на начало периода к последней. */
  periodReturnPct: number | null;
  /** Наибольшая просадка по закрытиям 4h за период, доли (0,05 = 5 %). */
  periodMaxDrawdownPct: number | null;
  /** Индикаторы на момент отчёта (по закрытым свечам 4h). */
  ema200_4h: number | null;
  aboveEma200: boolean | null;
  adx14_4h: number | null;
  /** ATR(14) 4h в % от цены — мера волатильности. */
  atrPct14_4h: number | null;
  /** Режим на момент отчёта и на начало периода: смена режима объясняет смену знака у архетипов. */
  regime: Regime;
  regimeAtStart: Regime;
  /** Доходность по UTC-дням периода, % (open → close дневной свечи). */
  daily: { date: string; returnPct: number }[];
}

export interface MarketInput {
  symbol: string;
  h4: Candle[];
  d1: Candle[];
  periodStart: number;
  now: number;
}

const lastFinite = (values: number[]): number | null => {
  for (let i = values.length - 1; i >= 0; i--)
    if (Number.isFinite(values[i])) return values[i];
  return null;
};

/** Свечи, закрывшиеся к моменту `at`. */
const closedBy = (candles: Candle[], intervalMs: number, at: number) =>
  candles.filter((c) => c.openTime + intervalMs <= at);

export function regimeOf(aboveEma: boolean | null, adx: number | null): Regime {
  if (aboveEma === null || adx === null) return "unknown";
  if (adx >= REGIME.trendAdx) return aboveEma ? "trend-up" : "trend-down";
  if (adx < REGIME.rangeAdx) return "range";
  return aboveEma ? "drift-up" : "drift-down";
}

/** EMA200, ADX и ATR по ряду закрытых свечей; цена для сравнения с EMA — `price`. */
function snapshot(closed: Candle[], price: number | null) {
  const ema200 = lastFinite(
    ema(
      closed.map((c) => c.close),
      200,
    ),
  );
  const adx = lastFinite(adxSeries(closed, 14));
  const atr = lastFinite(atrSeries(closed, 14));
  const above = ema200 === null || price === null ? null : price > ema200;
  return { ema200, adx, atr, above, regime: regimeOf(above, adx) };
}

/** Контекст рынка по свечам 4h (индикаторы — по закрытым) и 1d (по дням). */
export function computeMarketContext(input: MarketInput): MarketContext {
  const { symbol, h4, d1, periodStart, now } = input;
  const last = h4.at(-1);
  if (!last) throw new Error(`нет свечей 4h для ${symbol}`);
  const lastPrice = last.close;

  const current = snapshot(closedBy(h4, H4, now), lastPrice);
  const atStartCandles = closedBy(h4, H4, periodStart);
  const atStart = snapshot(
    atStartCandles,
    atStartCandles.at(-1)?.close ?? null,
  );

  // Период: цена на старте — open свечи, в которую попало начало периода; просадка — по закрытиям с этой свечи.
  const startIndex = h4.findIndex((c) => c.openTime + H4 > periodStart);
  let periodReturnPct: number | null = null;
  let periodMaxDrawdownPct: number | null = null;
  if (startIndex >= 0 && h4[startIndex].openTime <= periodStart) {
    const startPrice = h4[startIndex].open;
    periodReturnPct = (lastPrice / startPrice - 1) * 100;
    let peak = startPrice;
    let dd = 0;
    for (const c of h4.slice(startIndex)) {
      peak = Math.max(peak, c.close);
      dd = Math.max(dd, (peak - c.close) / peak);
    }
    periodMaxDrawdownPct = dd;
  }

  const dayStart = Math.floor(periodStart / D1) * D1;
  const daily = d1
    .filter((c) => c.openTime >= dayStart && c.openTime < now)
    .map((c) => ({
      date: new Date(c.openTime).toISOString().slice(0, 10),
      returnPct: (c.close / c.open - 1) * 100,
    }));

  return {
    symbol,
    lastPrice,
    periodReturnPct,
    periodMaxDrawdownPct,
    ema200_4h: current.ema200,
    aboveEma200: current.above,
    adx14_4h: current.adx,
    atrPct14_4h: current.atr === null ? null : (current.atr / lastPrice) * 100,
    regime: current.regime,
    regimeAtStart: atStart.regime,
    daily,
  };
}

/**
 * Свечи BTC (spot) с публичного API: 1000 × 4h ≈ 166 дней — EMA200 (34 дня) есть и на начало периода до ~4 месяцев.
 * now — конец периода: для прошлой эпохи (`--run`) свечи после её конца отбрасываются, «последняя цена» — на конец.
 */
export async function loadMarketContext(
  periodStart: number,
  now: number,
  symbol = "BTCUSDT",
): Promise<MarketContext> {
  const [h4, d1] = await Promise.all([
    fetchKlines("spot", symbol, "4h", 1000),
    fetchKlines("spot", symbol, "1d", 90),
  ]);
  const before = (c: Candle) => c.openTime < now;
  return computeMarketContext({
    symbol,
    h4: h4.filter(before),
    d1: d1.filter(before),
    periodStart,
    now,
  });
}

export function describeRegime(m: MarketContext): string {
  const end = REGIME_LABEL[m.regime];
  if (m.regimeAtStart === "unknown") return `режим сейчас: ${end}`;
  if (m.regimeAtStart === m.regime)
    return `режим за период: ${end} (одинаков на начало и конец)`;
  return `режим за период: ${REGIME_LABEL[m.regimeAtStart]} → ${end}`;
}

export function describeMarket(m: MarketContext): string {
  const pct = (v: number | null, d = 1) =>
    v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
  const parts = [
    `за период ${pct(m.periodReturnPct)}`,
    `просадка ${m.periodMaxDrawdownPct === null ? "—" : `${(m.periodMaxDrawdownPct * 100).toFixed(1)}%`}`,
    m.aboveEma200 === null
      ? "EMA200 4h — мало данных"
      : `цена ${m.aboveEma200 ? "выше" : "ниже"} EMA200 4h`,
    `ADX(14) 4h ${m.adx14_4h === null ? "—" : m.adx14_4h.toFixed(0)}`,
    `ATR ${m.atrPct14_4h === null ? "—" : `${m.atrPct14_4h.toFixed(2)}%`}`,
  ];
  return `${m.symbol}: ${parts.join(", ")} → ${describeRegime(m)}.`;
}
