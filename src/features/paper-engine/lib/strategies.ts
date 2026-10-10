import type { EntryRule, TradeDirection } from "@/entities/experiment";
import type { Candle } from "@/shared/api/binance";
import {
  adxSeries,
  atrSeries,
  bollinger,
  donchian,
  ema,
  macd,
  rsiSeries,
  smaSeries,
  supertrend,
} from "@/shared/lib";

export interface StrategyContext {
  /** Закрытые свечи таймфрейма эксперимента, последняя — только что закрытая. */
  candles: Candle[];
  /** Изменение за 24 ч (доля), для сканера. */
  change24h: number;
  /** Ставка финансирования (доля), только futures. */
  funding?: number;
  /** Место символа в рейтинге доходности за lookback среди юниверса (0 — лучший). */
  momentumRank?: number;
  /** Случайное число [0, 1) — детерминированное для свечи и символа. */
  random: number;
}

export interface EntrySignal {
  direction: TradeDirection;
  /** Уровень стопа от стратегии (для stop.type = signal). */
  stop?: number;
  /** Цель от стратегии (для takeProfit.type = signal). */
  target?: number;
  meta: Record<string, number | string>;
}

export interface StrategyResult {
  entry: EntrySignal | null;
  /** Закрыть открытые позиции этого направления по сигналу. */
  exit: Record<TradeDirection, boolean>;
}

const NO_EXIT = { long: false, short: false };
const last = <T>(a: T[], back = 1) => a[a.length - back];
const crossUp = (a: number[], b: number[]) =>
  last(a, 2) <= last(b, 2) && last(a) > last(b);
const crossDown = (a: number[], b: number[]) =>
  last(a, 2) >= last(b, 2) && last(a) < last(b);
const ok = (...v: number[]) => v.every(Number.isFinite);
const round = (v: number) => Number(v.toPrecision(6));

/** Пороги сканера дашборда (features/scan-market/config/rules.ts) — baseline-эксперименты. */
const SCANNER = {
  rebound: { maxChange24h: -0.07, maxRsi: 35, maxDistanceAtr: -2 },
  overheat: { minChange24h: 0.12, minRsi: 70, minDistanceAtr: 2.5 },
  swingLookback: 12,
  stopBufferAtr: 0.25,
  minStopAtr: 0.8,
  maxStopAtr: 3,
};

function counterTrend(
  rule: Extract<EntryRule, { type: "counterTrend" }>,
  ctx: StrategyContext,
): EntrySignal | null {
  const c = ctx.candles;
  const closes = c.map((x) => x.close);
  const price = last(closes);
  const a = last(atrSeries(c));
  const rsi = last(rsiSeries(closes));
  const ema20 = last(ema(closes, 20));
  const ema50 = last(ema(closes, 50));
  if (!ok(a, rsi, ema20, ema50) || a <= 0) return null;
  const distance = (price - ema50) / a;
  const r = SCANNER.rebound;
  const o = SCANNER.overheat;
  const isRebound =
    ctx.change24h <= r.maxChange24h &&
    rsi <= r.maxRsi &&
    distance <= r.maxDistanceAtr;
  const isOverheat =
    ctx.change24h >= o.minChange24h &&
    rsi >= o.minRsi &&
    distance >= o.minDistanceAtr;
  const meta = { rsi: round(rsi), distanceAtr: round(distance) };

  if (rule.mode === "pumpContinuation")
    return isOverheat ? { direction: "long", meta } : null;
  const long = isRebound && (rule.mode === "rebound" || rule.mode === "both");
  const short =
    isOverheat && (rule.mode === "overheat" || rule.mode === "both");
  if (!long && !short) return null;

  const sign = long ? 1 : -1;
  const swing = c.slice(-SCANNER.swingLookback);
  const extreme = long
    ? Math.min(...swing.map((x) => x.low))
    : Math.max(...swing.map((x) => x.high));
  const risk = Math.min(
    SCANNER.maxStopAtr * a,
    Math.max(
      SCANNER.minStopAtr * a,
      sign * (price - extreme) + SCANNER.stopBufferAtr * a,
    ),
  );
  const toEma20 = sign * (ema20 - price);
  const reward = toEma20 >= 0.5 * risk ? toEma20 : 1.5 * risk;
  return {
    direction: long ? "long" : "short",
    stop: price - sign * risk,
    target: price + sign * reward,
    meta,
  };
}

/**
 * Сигналы стратегий на закрытой свече. Чистая функция: тот же вход — тот же результат.
 * Направления и фильтр тренда отсекает движок, здесь — только правило.
 */
export function evaluateStrategy(
  rule: EntryRule,
  ctx: StrategyContext,
): StrategyResult {
  const c = ctx.candles;
  const closes = c.map((x) => x.close);
  const price = last(closes);
  const none = (exit = NO_EXIT): StrategyResult => ({ entry: null, exit });
  if (c.length < 2) return none();

  switch (rule.type) {
    case "counterTrend":
      return { entry: counterTrend(rule, ctx), exit: NO_EXIT };

    case "emaCross": {
      const f = ema(closes, rule.fast);
      const s = ema(closes, rule.slow);
      if (!ok(last(f, 2), last(s, 2))) return none();
      const up = crossUp(f, s);
      const down = crossDown(f, s);
      const exit = { long: last(f) < last(s), short: last(f) > last(s) };
      if (!up && !down) return none(exit);
      return {
        entry: {
          direction: up ? "long" : "short",
          meta: { fast: round(last(f)), slow: round(last(s)) },
        },
        exit,
      };
    }

    case "donchian": {
      const d = donchian(c, rule.period);
      const hi = last(d.upper);
      const lo = last(d.lower);
      if (!ok(hi, lo)) return none();
      const vols = c.map((x) => x.volume);
      const avgVol = last(smaSeries(vols.slice(0, -1), 20));
      const volOk =
        !rule.volumeMult ||
        (ok(avgVol) && last(vols) >= rule.volumeMult * avgVol);
      const half = donchian(c, Math.max(2, Math.floor(rule.period / 2)));
      const exit = {
        long: price < last(half.lower),
        short: price > last(half.upper),
      };
      if (!volOk) return none(exit);
      if (price > hi)
        return {
          entry: { direction: "long", stop: lo, meta: { channelHigh: hi } },
          exit,
        };
      if (price < lo)
        return {
          entry: { direction: "short", stop: hi, meta: { channelLow: lo } },
          exit,
        };
      return none(exit);
    }

    case "rsi2": {
      const r = last(rsiSeries(closes, 2));
      const trend = last(smaSeries(closes, rule.trendSma));
      const sma5 = last(smaSeries(closes, 5));
      if (!ok(r, trend, sma5)) return none();
      const exit = { long: price > sma5, short: price < sma5 };
      const meta = { rsi2: round(r) };
      if (price > trend && r < rule.threshold)
        return {
          entry: { direction: "long", target: sma5, meta },
          exit: NO_EXIT,
        };
      if (price < trend && r > 100 - rule.threshold)
        return {
          entry: { direction: "short", target: sma5, meta },
          exit: NO_EXIT,
        };
      return none(exit);
    }

    case "bbReversion": {
      const bb = bollinger(closes);
      const r = last(rsiSeries(closes));
      if (!ok(last(bb.lower), r)) return none();
      const meta = { rsi: round(r) };
      if (last(c).low <= last(bb.lower) && r < rule.rsiMax)
        return {
          entry: { direction: "long", target: last(bb.middle), meta },
          exit: NO_EXIT,
        };
      if (last(c).high >= last(bb.upper) && r > 100 - rule.rsiMax)
        return {
          entry: { direction: "short", target: last(bb.middle), meta },
          exit: NO_EXIT,
        };
      return none();
    }

    case "bbSqueeze": {
      const bb = bollinger(closes);
      const prevWidth = bb.width.slice(-6, -1);
      if (!ok(last(bb.upper), ...prevWidth)) return none();
      const squeezed = Math.min(...prevWidth) <= rule.maxWidth;
      const meta = { width: round(Math.min(...prevWidth)) };
      if (squeezed && price > last(bb.upper))
        return { entry: { direction: "long", meta }, exit: NO_EXIT };
      if (squeezed && price < last(bb.lower))
        return { entry: { direction: "short", meta }, exit: NO_EXIT };
      return none();
    }

    case "macd": {
      const m = macd(closes);
      if (!ok(last(m.hist, 2))) return none();
      const adx = last(adxSeries(c));
      const exit = { long: last(m.hist) < 0, short: last(m.hist) > 0 };
      if (rule.minAdx && !(adx >= rule.minAdx)) return none(exit);
      const meta = { hist: round(last(m.hist)), adx: round(adx) };
      if (last(m.hist, 2) <= 0 && last(m.hist) > 0)
        return { entry: { direction: "long", meta }, exit };
      if (last(m.hist, 2) >= 0 && last(m.hist) < 0)
        return { entry: { direction: "short", meta }, exit };
      return none(exit);
    }

    case "supertrend": {
      const st = supertrend(c, rule.period, rule.mult);
      const d = last(st.dir);
      const prev = last(st.dir, 2);
      const exit = { long: d === -1, short: d === 1 };
      if (!prev || d === prev) return none(exit);
      return {
        entry: {
          direction: d === 1 ? "long" : "short",
          stop: last(st.line),
          meta: { line: round(last(st.line)) },
        },
        exit,
      };
    }

    case "volumeSpike": {
      const vols = c.map((x) => x.volume);
      const avg = last(smaSeries(vols.slice(0, -1), 20));
      const bar = last(c);
      const range = bar.high - bar.low;
      if (!ok(avg) || avg <= 0 || range <= 0 || bar.volume < rule.mult * avg)
        return none();
      const pos = (bar.close - bar.low) / range;
      const meta = { volumeRatio: round(bar.volume / avg) };
      if (pos >= 0.7)
        return { entry: { direction: "long", meta }, exit: NO_EXIT };
      if (pos <= 0.3)
        return { entry: { direction: "short", meta }, exit: NO_EXIT };
      return none();
    }

    case "emaPullback": {
      const e20 = ema(closes, 20);
      const e50 = last(ema(closes, 50));
      const e200 = last(ema(closes, 200));
      const a = last(atrSeries(c));
      if (!ok(last(e20), e50, e200, a)) return none();
      const bar = last(c);
      const meta = { ema20: round(last(e20)) };
      // Тренд выстроен, свеча коснулась EMA20 и закрылась по тренду.
      if (
        last(e20) > e50 &&
        e50 > e200 &&
        bar.low <= last(e20) &&
        bar.close > last(e20)
      )
        return { entry: { direction: "long", meta }, exit: NO_EXIT };
      if (
        last(e20) < e50 &&
        e50 < e200 &&
        bar.high >= last(e20) &&
        bar.close < last(e20)
      )
        return { entry: { direction: "short", meta }, exit: NO_EXIT };
      return none();
    }

    case "momentum": {
      const rank = ctx.momentumRank;
      if (rank === undefined) return none();
      const exit = { long: rank >= rule.topK, short: false };
      if (rank < rule.topK)
        return { entry: { direction: "long", meta: { rank } }, exit };
      return none(exit);
    }

    case "random": {
      if (ctx.random >= rule.probability) return none();
      // Направление — от второй половины того же случайного числа.
      const direction = ctx.random < rule.probability / 2 ? "long" : "short";
      return {
        entry: { direction, meta: { random: round(ctx.random) } },
        exit: NO_EXIT,
      };
    }

    case "hold":
      return { entry: { direction: "long", meta: {} }, exit: NO_EXIT };

    case "funding": {
      const f = ctx.funding;
      const e50 = last(ema(closes, 50));
      if (f === undefined || !ok(e50)) return none();
      const meta = { funding: f };
      if (f >= rule.threshold && price < e50)
        return { entry: { direction: "short", meta }, exit: NO_EXIT };
      if (f <= -rule.threshold && price > e50)
        return { entry: { direction: "long", meta }, exit: NO_EXIT };
      return none();
    }
  }
}
