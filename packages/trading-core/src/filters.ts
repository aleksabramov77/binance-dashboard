// Фильтры входа уровня эксперимента: режим рынка (BTC на старшем ТФ) и торговые часы.
// Чистые функции: свечи и время приходят аргументами.
import type {
  MarketFilter,
  RegimeSide,
  SessionFilter,
  TradeDirection,
} from "./experiment.ts";
import { ema } from "./indicators/basic.ts";
import { adxSeries } from "./indicators/ta.ts";
import type { Candle } from "./types.ts";

/** Длина ADX фильтра режима рынка — классические 14 свечей. */
const REGIME_ADX_PERIOD = 14;

/**
 * Сколько закрытых свечей нужно фильтру режима: EMA(ema) — ema свечей (если хоть одно направление
 * сравнивается с EMA), ADX(14) — 2 × 14 (сглаживание TR/DM и самого DX). Меньше — вход запрещён.
 */
export function regimeMinCandles(filter: MarketFilter): number {
  const needEma = filter.long !== "any" || filter.short !== "any";
  return Math.max(
    1,
    needEma ? filter.ema : 0,
    filter.minAdx !== undefined ? 2 * REGIME_ADX_PERIOD : 0,
  );
}

function sideAllows(
  side: Exclude<RegimeSide, "any">,
  close: number,
  level: number,
) {
  if (!Number.isFinite(level)) return false;
  return side === "above" ? close > level : close < level;
}

/**
 * Режим рынка разрешает вход в direction? Свечи — только закрытые (незакрытую отбрасывает вызывающий:
 * так фильтр не заглядывает вперёд); решение — по последней из них: close против EMA(ema) по условию
 * long/short фильтра и, если задан minAdx, ADX(14) ≥ minAdx. Свечей нет или их мало для EMA/ADX —
 * вход запрещён.
 */
export function marketRegimeAllows(
  candles: Candle[],
  filter: MarketFilter,
  direction: TradeDirection,
): boolean {
  const last = candles.at(-1);
  if (!last || candles.length < regimeMinCandles(filter)) return false;
  const side = filter[direction];
  if (side !== "any") {
    const level =
      ema(
        candles.map((c) => c.close),
        filter.ema,
      ).at(-1) ?? Number.NaN;
    if (!sideAllows(side, last.close, level)) return false;
  }
  if (filter.minAdx !== undefined) {
    const adx = adxSeries(candles, REGIME_ADX_PERIOD).at(-1) ?? Number.NaN;
    if (!Number.isFinite(adx) || adx < filter.minAdx) return false;
  }
  return true;
}

/**
 * Время (мс) попадает в торговые часы фильтра? Час и день недели — по UTC; окно часов [from, to),
 * from > to — через полночь. Дни проверяются по UTC-дню момента входа: окно через полночь вместе с days
 * смотрит на день входа, а не на день начала окна ([22, 6) с days [5] пропустит пт 23:00, но не сб 02:00).
 * Не заданное условие (часы или дни) не ограничивает.
 */
export function sessionAllows(time: number, filter: SessionFilter): boolean {
  const date = new Date(time);
  if (filter.days && !filter.days.includes(date.getUTCDay())) return false;
  if (filter.hoursUtc) {
    const [from, to] = filter.hoursUtc;
    const hour = date.getUTCHours();
    const inside =
      from < to ? hour >= from && hour < to : hour >= from || hour < to;
    if (!inside) return false;
  }
  return true;
}
