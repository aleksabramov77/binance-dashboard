import {
  type Experiment,
  exitFill,
  type PaperTrade,
  settle,
  TIMEFRAME_MS,
} from "@binance-dashboard/trading-core";
import { lastClosedOpenTime } from "../lib/candles.ts";
import type { TradeClose } from "./store.ts";

// План «Сбросить тестовые капиталы» (spec 003, задача 3d). Чистая функция: что закрыть и какие
// метки свечей поставить. Атомарно применяет план хранилище (entities/experiment → resetRun),
// цены и время передаёт композиция (src/app/server). Среда-независимый модуль.

/** Ключ цены: рынок и символ — у spot и futures цены разные. */
export const priceKey = (market: string, symbol: string) =>
  `${market}:${symbol}`;

export interface ResetClose {
  id: string;
  close: TradeClose;
  /** Цены не было — закрыта по цене входа с PnL 0. */
  noPrice: boolean;
}

export interface ResetPlan {
  closes: ResetClose[];
  /**
   * Метки engine_state.bars для новой эпохи: последняя закрытая свеча TF каждого эксперимента
   * считается уже обработанной — по сигналам до сброса новая эпоха не входит.
   */
  bars: Record<string, number>;
}

export function planReset(input: {
  experiments: Experiment[];
  /** Открытые сделки текущей эпохи. */
  open: PaperTrade[];
  /** Последние цены: { "futures:BTCUSDT": 62000 }; нет цены — закрытие по цене входа. */
  prices: Record<string, number>;
  now: number;
}): ResetPlan {
  const closedAt = new Date(input.now).toISOString();
  const closes = input.open.map((t): ResetClose => {
    const raw = input.prices[priceKey(t.market, t.symbol)];
    if (raw === undefined || !Number.isFinite(raw) || raw <= 0)
      return {
        id: t.id,
        noPrice: true,
        close: {
          closedAt,
          exitPrice: t.entryPrice,
          exitReason: "manual",
          fees: t.fees,
          pnl: 0,
          rMultiple: 0,
        },
      };
    const exitPrice = exitFill(raw, t.direction, "manual");
    const s = settle({
      market: t.market,
      direction: t.direction,
      entryPrice: t.entryPrice,
      exitPrice,
      quantity: t.quantity,
      initialStop: t.initialStop,
    });
    return {
      id: t.id,
      noPrice: false,
      close: {
        closedAt,
        exitPrice,
        exitReason: "manual",
        fees: s.fees,
        pnl: s.pnl,
        rMultiple: s.rMultiple,
      },
    };
  });
  const bars = Object.fromEntries(
    input.experiments.map((e) => [
      e.id,
      lastClosedOpenTime(TIMEFRAME_MS[e.config.timeframe], input.now),
    ]),
  );
  return { closes, bars };
}
