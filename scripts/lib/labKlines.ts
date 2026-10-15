// Свечи ТФ экспериментов для отчёта лаборатории (spec 0030): «что было через 4/12/24 свечи после выхода» и грубый
// гипотетический исход отсечённых сигналов. Свечи не хранятся (история Binance неизменна): `pnpm lab:report
// --after-exit` догружает их публичным API по требованию. Расчёты — чистые функции над загруженным набором.
import {
  type Candle,
  type ExperimentMarket,
  type PaperTrade,
  type SkippedSignal,
  TIMEFRAME_MS,
  type Timeframe,
} from "@binance-dashboard/trading-core";

/** Через сколько свечей ТФ после выхода смотрим цену. */
export const AFTER_EXIT_BARS = [4, 12, 24] as const;
/** Горизонт гипотетического исхода отсечённого сигнала, свечей ТФ. */
export const SKIPPED_HORIZON_BARS = 48;
/** Binance отдаёт не больше 1000 свечей за запрос. */
const PAGE = 1000;

/** Свечи по (рынок, символ, ТФ), по возрастанию openTime, только закрытые. */
export type KlineSet = Map<string, Candle[]>;

export const klineKey = (market: string, symbol: string, tf: string) =>
  `${market}:${symbol}:${tf}`;

export interface KlineRequest {
  market: ExperimentMarket;
  symbol: string;
  tf: Timeframe;
  /** openTime первой нужной свечи, мс. */
  from: number;
  /** openTime последней нужной свечи, мс. */
  to: number;
}

type ClosedTrade = PaperTrade & { closedAt: string; exitPrice: number };

const isClosed = (t: PaperTrade): t is ClosedTrade =>
  t.closedAt !== null && t.exitPrice !== null;

const barOf = (time: number, tfMs: number) => Math.floor(time / tfMs) * tfMs;

/**
 * Какие свечи нужны: после выхода каждой закрытой сделки — 24 свечи её ТФ, после свечи каждого отсечённого
 * сигнала — горизонт исхода. Запросы одного (рынок, символ, ТФ) склеиваются в один диапазон.
 */
export function klineRequests(
  trades: PaperTrade[],
  skipped: SkippedSignal[],
  timeframeOf: (experimentId: string) => Timeframe | undefined,
): KlineRequest[] {
  const byKey = new Map<string, KlineRequest>();
  const add = (
    market: ExperimentMarket,
    symbol: string,
    tf: Timeframe,
    from: number,
    to: number,
  ) => {
    const key = klineKey(market, symbol, tf);
    const prev = byKey.get(key);
    byKey.set(
      key,
      prev
        ? {
            ...prev,
            from: Math.min(prev.from, from),
            to: Math.max(prev.to, to),
          }
        : { market, symbol, tf, from, to },
    );
  };
  const last = AFTER_EXIT_BARS[AFTER_EXIT_BARS.length - 1];
  for (const t of trades) {
    const tf = timeframeOf(t.experimentId);
    if (!tf || !isClosed(t)) continue;
    const ms = TIMEFRAME_MS[tf];
    const base = barOf(Date.parse(t.closedAt), ms);
    add(t.market, t.symbol, tf, base, base + last * ms);
  }
  for (const s of skipped) {
    const tf = timeframeOf(s.experimentId);
    if (!tf) continue;
    const ms = TIMEFRAME_MS[tf];
    add(s.market, s.symbol, tf, s.bar + ms, s.bar + SKIPPED_HORIZON_BARS * ms);
  }
  return [...byKey.values()];
}

export type FetchKlines = (
  market: ExperimentMarket,
  symbol: string,
  interval: string,
  limit: number,
  startTime: number,
) => Promise<Candle[]>;

/**
 * Загрузка свечей по запросам: страницами по 1000 от from до to (не дальше now), по concurrency запросов
 * одновременно. Незакрытые к now свечи отбрасываются. Сбой одного символа — onError, остальные грузятся.
 */
export async function loadKlines(
  requests: KlineRequest[],
  fetchKlines: FetchKlines,
  now: number,
  onError: (request: KlineRequest, error: unknown) => void,
  concurrency = 4,
): Promise<KlineSet> {
  const set: KlineSet = new Map();
  const queue = [...requests];
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const ms = TIMEFRAME_MS[r.tf];
      const end = Math.min(r.to, now - ms);
      const candles: Candle[] = [];
      try {
        for (let start = r.from; start <= end; ) {
          const batch = (
            await fetchKlines(r.market, r.symbol, r.tf, PAGE, start)
          ).filter((c) => c.openTime >= start && c.openTime + ms <= now);
          candles.push(...batch);
          const lastBar = batch.at(-1);
          if (!lastBar || batch.length < PAGE) break;
          start = lastBar.openTime + ms;
        }
        set.set(klineKey(r.market, r.symbol, r.tf), candles);
      } catch (error) {
        onError(r, error);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return set;
}

export interface AfterExitRow {
  /** Через сколько свечей ТФ после свечи выхода. */
  bars: number;
  /** Причина выхода или «все». */
  reason: string;
  n: number;
  /** Средний ход цены от цены выхода в сторону сделки, %: > 0 — цена шла дальше «за нас» (вышли рано). */
  avgMovePct: number | null;
  /** То же в R (риск до начального стопа); только сделки со стопом. */
  avgMoveR: number | null;
  /** Доля сделок, у которых цена пошла дальше в сторону сделки. */
  continuedShare: number | null;
}

/** Ход цены через bars свечей после свечи выхода; null — свечи ещё нет или нет в наборе. */
export function afterExitMove(
  t: PaperTrade,
  candles: Candle[],
  tfMs: number,
  bars: number,
): { movePct: number; moveR: number | null } | null {
  if (!isClosed(t) || t.exitPrice <= 0) return null;
  const target = barOf(Date.parse(t.closedAt), tfMs) + bars * tfMs;
  const c = candles.find((x) => x.openTime === target);
  if (!c) return null;
  const sign = t.direction === "long" ? 1 : -1;
  const risk =
    t.initialStop === null ? 0 : Math.abs(t.entryPrice - t.initialStop);
  return {
    movePct: sign * (c.close / t.exitPrice - 1) * 100,
    moveR: risk > 0 ? (sign * (c.close - t.exitPrice)) / risk : null,
  };
}

const avg = (values: number[]): number | null =>
  values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;

/** «Что было после выхода» по закрытым сделкам эксперимента: все сделки и по причинам выхода. */
export function afterExitStats(
  trades: PaperTrade[],
  klines: KlineSet,
  tf: Timeframe,
): AfterExitRow[] {
  const tfMs = TIMEFRAME_MS[tf];
  const closed = trades.filter(isClosed);
  const reasons = ["все", ...new Set(closed.map((t) => t.exitReason ?? "—"))];
  const rows: AfterExitRow[] = [];
  for (const reason of reasons) {
    const group =
      reason === "все"
        ? closed
        : closed.filter((t) => (t.exitReason ?? "—") === reason);
    for (const bars of AFTER_EXIT_BARS) {
      const moves = group.flatMap((t) => {
        const m = afterExitMove(
          t,
          klines.get(klineKey(t.market, t.symbol, tf)) ?? [],
          tfMs,
          bars,
        );
        return m ? [m] : [];
      });
      if (!moves.length) continue;
      rows.push({
        bars,
        reason,
        n: moves.length,
        avgMovePct: avg(moves.map((m) => m.movePct)),
        avgMoveR: avg(
          moves.map((m) => m.moveR).filter((r): r is number => r !== null),
        ),
        continuedShare:
          moves.filter((m) => m.movePct > 0).length / moves.length,
      });
    }
  }
  return rows;
}

export type SkippedResult = "tp" | "sl" | "open";

/**
 * Грубый исход отсечённого сигнала по свечам ТФ: со свечи после сигнала первая, задевшая стоп или тейк (обе в
 * одной свече — стоп), в пределах SKIPPED_HORIZON_BARS; не задела — «open» по close последней свечи горизонта.
 * Трейлинг, безубыток, тайм-стоп, выход по сигналу и комиссии не учитываются. null — без стопа или нет свечей.
 */
export function skippedOutcome(
  s: SkippedSignal,
  candles: Candle[],
  tfMs: number,
): { result: SkippedResult; r: number } | null {
  if (s.stop === null) return null;
  const risk = Math.abs(s.entryPrice - s.stop);
  if (risk === 0) return null;
  const long = s.direction === "long";
  const sign = long ? 1 : -1;
  const window = candles.filter(
    (c) =>
      c.openTime > s.bar && c.openTime <= s.bar + SKIPPED_HORIZON_BARS * tfMs,
  );
  if (!window.length) return null;
  for (const c of window) {
    const stopHit = long ? c.low <= s.stop : c.high >= s.stop;
    if (stopHit) return { result: "sl", r: -1 };
    if (s.takeProfit !== null) {
      const tpHit = long ? c.high >= s.takeProfit : c.low <= s.takeProfit;
      if (tpHit)
        return {
          result: "tp",
          r: (sign * (s.takeProfit - s.entryPrice)) / risk,
        };
    }
  }
  const lastClose = window[window.length - 1].close;
  return { result: "open", r: (sign * (lastClose - s.entryPrice)) / risk };
}

export interface SkippedOutcomeStats {
  /** Сигналов с посчитанным исходом (со стопом и свечами). */
  n: number;
  tp: number;
  sl: number;
  open: number;
  /** Средний R до издержек, «open» — по close конца горизонта. */
  avgR: number | null;
  horizonBars: number;
}

export function skippedOutcomeStats(
  skipped: SkippedSignal[],
  klines: KlineSet,
  tf: Timeframe,
): SkippedOutcomeStats {
  const tfMs = TIMEFRAME_MS[tf];
  const outcomes = skipped.flatMap((s) => {
    const o = skippedOutcome(
      s,
      klines.get(klineKey(s.market, s.symbol, tf)) ?? [],
      tfMs,
    );
    return o ? [o] : [];
  });
  return {
    n: outcomes.length,
    tp: outcomes.filter((o) => o.result === "tp").length,
    sl: outcomes.filter((o) => o.result === "sl").length,
    open: outcomes.filter((o) => o.result === "open").length,
    avgR: avg(outcomes.map((o) => o.r)),
    horizonBars: SKIPPED_HORIZON_BARS,
  };
}
