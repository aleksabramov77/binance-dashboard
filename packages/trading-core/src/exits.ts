import type { ExitReason, ExitRule, TradeDirection } from "./experiment";
import type { Candle } from "./types";

const MINUTE = 60_000;

/** Что нужно знать об открытой позиции, чтобы проверить выходы. */
export interface OpenPosition {
  direction: TradeDirection;
  entryPrice: number;
  /** Стоп при входе — от него считается R и тип выхода. null — без стопа. */
  initialStop: number | null;
  /** Текущий стоп (после безубытка и трейлинга). */
  stop: number | null;
  takeProfit: number | null;
  /** ATR при входе — шаг трейлинга. */
  atr: number;
  /** Лучшая цена с момента входа: high для long, low для short. */
  extreme: number;
  /** Время входа, мс. */
  openedAt: number;
  /** С какой минуты (openTime 1m-свечи) ещё не проверено. */
  checkedUntil: number;
}

export type ExitPolicy = Pick<
  ExitRule,
  "trailAtr" | "breakevenAtR" | "timeStopBars"
> & {
  /** Длина свечи таймфрейма эксперимента, мс — для тайм-стопа. */
  timeframeMs: number;
};

export interface ExitEvent {
  reason: ExitReason;
  /** Цена срабатывания до проскальзывания (уровень или open при гэпе). */
  price: number;
  /** Время срабатывания, мс (openTime свечи). */
  at: number;
}

export interface WalkResult {
  exit: ExitEvent | null;
  /** Обновлённые поля позиции (если не закрыта). */
  stop: number | null;
  extreme: number;
  checkedUntil: number;
}

/** Причина выхода по стопу: исходный, перенесённый в безубыток или подтянутый трейлингом. */
function stopReason(pos: OpenPosition, stop: number): ExitReason {
  if (stop === pos.initialStop) return "sl";
  if (stop === pos.entryPrice) return "breakeven";
  return "trail";
}

/**
 * Проходит по закрытым 1m-свечам после checkedUntil и ищет выход.
 * Консервативно: в каждой свече сначала тайм-стоп, потом стоп, потом тейк
 * (задеты оба — засчитывается стоп); безубыток и трейлинг двигаются по экстремуму свечи
 * и действуют только со следующей свечи — внутри свечи порядок цен неизвестен.
 */
export function walkExits(
  pos: OpenPosition,
  candles1m: Candle[],
  policy: ExitPolicy,
): WalkResult {
  const long = pos.direction === "long";
  const sign = long ? 1 : -1;
  const risk =
    pos.initialStop === null
      ? null
      : Math.abs(pos.entryPrice - pos.initialStop);
  const timeLimit =
    policy.timeStopBars === undefined
      ? Number.POSITIVE_INFINITY
      : pos.openedAt + policy.timeStopBars * policy.timeframeMs;
  let { stop, extreme, checkedUntil } = pos;

  for (const c of candles1m) {
    if (c.openTime < pos.checkedUntil) continue;
    const done = (reason: ExitReason, price: number): WalkResult => ({
      exit: { reason, price, at: c.openTime },
      stop,
      extreme,
      checkedUntil: c.openTime + MINUTE,
    });

    if (c.openTime >= timeLimit) return done("time", c.open);

    if (stop !== null) {
      const hit = long ? c.low <= stop : c.high >= stop;
      // Гэп через стоп — исполнение по open, а не по уровню.
      if (hit)
        return done(
          stopReason(pos, stop),
          long ? Math.min(stop, c.open) : Math.max(stop, c.open),
        );
    }
    if (pos.takeProfit !== null) {
      const tp = pos.takeProfit;
      const hit = long ? c.high >= tp : c.low <= tp;
      if (hit)
        return done("tp", long ? Math.max(tp, c.open) : Math.min(tp, c.open));
    }

    extreme = long ? Math.max(extreme, c.high) : Math.min(extreme, c.low);
    const better = (level: number) =>
      stop === null || sign * (level - stop) > 0;
    if (
      policy.breakevenAtR !== undefined &&
      risk !== null &&
      sign * (extreme - pos.entryPrice) >= policy.breakevenAtR * risk &&
      better(pos.entryPrice)
    )
      stop = pos.entryPrice;
    if (policy.trailAtr !== undefined && pos.atr > 0) {
      const level = extreme - sign * policy.trailAtr * pos.atr;
      if (better(level)) stop = level;
    }
    checkedUntil = c.openTime + MINUTE;
  }
  return { exit: null, stop, extreme, checkedUntil };
}
