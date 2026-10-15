// Снимок рынка на входе в сделку (spec 0030): индикаторы символа по закрытым свечам ТФ эксперимента, режим BTC
// по закрытым 4h, funding, место в юниверсе, час и день. Нужен разбору лаборатории — «в каких условиях
// эксперимент зарабатывает». Чистая функция: свечи, время и ставки приходят аргументами.
import {
  type EntryContext,
  TIMEFRAME_MS,
  type Timeframe,
} from "./experiment.ts";
import { ema } from "./indicators/basic.ts";
import {
  adxSeries,
  atrSeries,
  bollinger,
  rsiSeries,
  smaSeries,
} from "./indicators/ta.ts";
import type { Candle } from "./types.ts";

/** Версия набора полей контекста (`EntryContext.v`). */
export const ENTRY_CONTEXT_VERSION = 1;

const H4 = TIMEFRAME_MS["4h"];
const DAY = 24 * 60 * 60_000;

export interface EntryContextInput {
  /** Время входа, мс. Свечи, не закрытые к этому моменту, отбрасываются — без заглядывания вперёд. */
  at: number;
  timeframe: Timeframe;
  /** Свечи символа ТФ эксперимента (по возрастанию openTime). */
  candles: Candle[];
  /** Свечи BTCUSDT 4h; null — не загрузились. */
  btc4h: Candle[] | null;
  /** Ставка funding символа (доля); null — spot или нет данных. */
  funding: number | null;
  /** Место символа в юниверсе по обороту (1 — первый) и размер юниверса; null — не известно. */
  universeRank: number | null;
  universeSize: number | null;
}

/** 4 знака после запятой: в jsonb не хранить шум double; NaN/∞ → null. */
const round = (v: number | undefined): number | null =>
  v === undefined || !Number.isFinite(v) ? null : Math.round(v * 1e4) / 1e4;

/** Изменение close последней свечи к свече ровно на 24 ч раньше, %; нет такой свечи — null. */
function change24h(closed: Candle[]): number | null {
  const last = closed.at(-1);
  if (!last) return null;
  const base = closed.find((c) => c.openTime === last.openTime - DAY);
  return base && base.close > 0 ? (last.close / base.close - 1) * 100 : null;
}

/** Контекст по свечам символа: индикатор, которому не хватило истории, — null. */
function symbolContext(closed: Candle[]) {
  const last = closed.at(-1);
  if (!last) return {};
  const closes = closed.map((c) => c.close);
  const atr = atrSeries(closed, 14).at(-1);
  const bb = bollinger(closes, 20, 2).width.at(-1);
  const volumes = closed.map((c) => c.volume);
  // Как у входа volumeSpike: средняя — по предыдущим 20 свечам, без свечи сигнала.
  const volumeAvg =
    closed.length > 20 ? smaSeries(volumes.slice(0, -1), 20).at(-1) : undefined;
  const ema200 = ema(closes, 200).at(-1);
  return {
    atrPct: round(
      atr === undefined || last.close <= 0
        ? undefined
        : (atr / last.close) * 100,
    ),
    adx14: round(adxSeries(closed, 14).at(-1)),
    bbWidthPct: round(bb === undefined ? undefined : bb * 100),
    rsi14: round(rsiSeries(closes, 14).at(-1)),
    volumeRatio: round(
      volumeAvg === undefined || volumeAvg <= 0
        ? undefined
        : last.volume / volumeAvg,
    ),
    ema200DistPct: round(
      ema200 === undefined || ema200 <= 0
        ? undefined
        : (last.close / ema200 - 1) * 100,
    ),
    change24hPct: round(change24h(closed) ?? undefined),
  };
}

/** Режим BTC по закрытым 4h: close против EMA200, ADX(14), изменение за 24 ч. */
function btcContext(closed: Candle[] | null) {
  const last = closed?.at(-1);
  if (!closed || !last)
    return {
      btcAboveEma200_4h: null,
      btcAdx14_4h: null,
      btcChange24hPct: null,
    };
  const ema200 = ema(
    closed.map((c) => c.close),
    200,
  ).at(-1);
  return {
    btcAboveEma200_4h:
      ema200 === undefined || !Number.isFinite(ema200)
        ? null
        : last.close > ema200,
    btcAdx14_4h: round(adxSeries(closed, 14).at(-1)),
    btcChange24hPct: round(change24h(closed) ?? undefined),
  };
}

/** Снимок рынка на входе. Все поля, кроме v, часа и дня, — null при нехватке истории. */
export function computeEntryContext(input: EntryContextInput): EntryContext {
  const tfMs = TIMEFRAME_MS[input.timeframe];
  const closed = input.candles.filter((c) => c.openTime + tfMs <= input.at);
  const btc =
    input.btc4h === null
      ? null
      : input.btc4h.filter((c) => c.openTime + H4 <= input.at);
  const date = new Date(input.at);
  return {
    v: ENTRY_CONTEXT_VERSION,
    atrPct: null,
    adx14: null,
    bbWidthPct: null,
    rsi14: null,
    volumeRatio: null,
    ema200DistPct: null,
    change24hPct: null,
    ...symbolContext(closed),
    universeRank: input.universeRank,
    universeSize: input.universeSize,
    ...btcContext(btc),
    // Ставка — доли с 4–6 значащими знаками после запятой: не округляем.
    funding:
      input.funding !== null && Number.isFinite(input.funding)
        ? input.funding
        : null,
    hourUtc: date.getUTCHours(),
    weekday: date.getUTCDay(),
  };
}
