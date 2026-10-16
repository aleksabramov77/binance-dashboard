import type { ExitReason, ExitRule, TradeDirection } from "./experiment.ts";
import type { Candle } from "./types.ts";

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
  /**
   * ATR при входе. Шаг трейлинга — его доля от цены входа (atr / entryPrice), приложенная к экстремуму:
   * trailAtr × (atr / entryPrice) × extreme (баг 0041).
   */
  atr: number;
  /** Лучшая цена с момента входа: high для long, low для short. */
  extreme: number;
  /** Худшая цена с момента входа (MAE): low для long, high для short; null — не известна (сделка до spec 0030). */
  mae: number | null;
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
  /** Худшая цена, включая свечу выхода; null — была не известна и остаётся такой. */
  mae: number | null;
  checkedUntil: number;
}

/** Худшая из двух цен для позиции direction; MAE null (история не известна) не меняется. */
export const worseMae = (
  direction: TradeDirection,
  mae: number | null,
  price: number,
): number | null => {
  if (mae === null) return null;
  return direction === "long" ? Math.min(mae, price) : Math.max(mae, price);
};

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
 * MAE (худшая цена) учитывает и свечу выхода: при тейке — её low/high (провал мог быть до тейка, стоп в этой
 * свече не задет), при стопе и тайм-стопе — цену срабатывания (дальше позиции уже нет).
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
  let { stop, extreme, mae, checkedUntil } = pos;

  for (const c of candles1m) {
    if (c.openTime < pos.checkedUntil) continue;
    const done = (reason: ExitReason, price: number): WalkResult => ({
      exit: { reason, price, at: c.openTime },
      stop,
      extreme,
      mae: worseMae(
        pos.direction,
        mae,
        reason === "tp" ? (long ? c.low : c.high) : price,
      ),
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
    mae = worseMae(pos.direction, mae, long ? c.low : c.high);
    const better = (level: number) =>
      stop === null || sign * (level - stop) > 0;
    if (
      policy.breakevenAtR !== undefined &&
      risk !== null &&
      sign * (extreme - pos.entryPrice) >= policy.breakevenAtR * risk &&
      better(pos.entryPrice)
    )
      stop = pos.entryPrice;
    if (policy.trailAtr !== undefined && pos.atr > 0 && pos.entryPrice > 0) {
      // Дистанция — trailAtr × ATR входа в долях цены входа, от экстремума (баг 0041): после сильного хода
      // абсолютный ATR входа уже не тот процент цены. extreme / entryPrice при extreme = entry ровно 1.
      const level =
        extreme - sign * policy.trailAtr * pos.atr * (extreme / pos.entryPrice);
      if (better(level)) stop = level;
    }
    checkedUntil = c.openTime + MINUTE;
  }
  return { exit: null, stop, extreme, mae, checkedUntil };
}
