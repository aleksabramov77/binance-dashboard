import { LIVE } from "../config/liveMirror";
import { liveUsd } from "./money";

// Тексты журнала и Telegram реального зеркала (spec 0049, AC8). Чистые функции: id эксперимента — настоящий
// (в журнале и Telegram), в тестах и документации — фиктивный.

const DIRECTION = { long: "long", short: "short" } as const;

/** Почему объём выше $10 — по причине из sizeEntry: «минимум биржи» — только когда сработал minNotional. */
const RAISED = {
  minNotional: "минимум биржи",
  minQty: "минимальное количество монеты на бирже",
  spotStop: "стоп после комиссии должен пройти минимум ордера",
} as const;

export interface LiveTradeSubject {
  experimentId: string;
  symbol: string;
  market: "spot" | "usdm";
  direction: "long" | "short";
}

const subject = (s: LiveTradeSubject) =>
  `${s.experimentId} ${s.symbol}${s.market === "usdm" ? " (USDⓈ-M)" : ""} ${DIRECTION[s.direction]}`;

/** «🟢 Реальная сделка: S98 BTCUSDT long $50 (минимум биржи), SL …, TP …». */
export function liveEntryText(
  s: LiveTradeSubject,
  o: {
    notionalUsd: number;
    raised: "minNotional" | "minQty" | "spotStop" | null;
    stopLoss: number;
    takeProfit: number | null;
  },
): string {
  return `🟢 Реальная сделка: ${subject(s)} ${liveUsd(o.notionalUsd)}${o.raised ? ` (${RAISED[o.raised]})` : ""}, SL ${o.stopLoss}${o.takeProfit === null ? "" : `, TP ${o.takeProfit}`}`;
}

export function liveUnprotectedText(s: LiveTradeSubject, message: string) {
  return `⚠️ Реальная сделка без защиты: ${subject(s)} — ${message} Закройте позицию на Binance вручную или «Закрыть всё».`;
}

const CLOSED_BY: Record<string, string> = {
  tp: "TP",
  sl: "SL",
  mirror: "закрыта paper-сделка",
  close_all: "«Закрыть всё»",
};

/** «🔴 Закрыта: S98 BTCUSDT +$0,84 (TP)». PnL null — не посчитан. */
export function liveExitText(
  s: LiveTradeSubject,
  o: { realizedPnl: number | null; closedBy: string | null },
): string {
  const pnl =
    o.realizedPnl === null ? "PnL не посчитан" : liveUsd(o.realizedPnl, true);
  const by = o.closedBy ? ` (${CLOSED_BY[o.closedBy] ?? o.closedBy})` : "";
  return `🔴 Закрыта: ${subject(s)} ${pnl}${by}`;
}

export function liveCloseFailedText(s: LiveTradeSubject, message: string) {
  return `⚠️ Реальная позиция не закрылась: ${subject(s)} — ${message} Повтор на следующем прогоне.`;
}

/** Сработал дневной лимит эксперимента (один раз за сутки). */
export function liveDailyLimitText(experimentId: string, pnl: number) {
  return `⛔ Дневной лимит убытка: ${experimentId} ${liveUsd(pnl)} за сутки (лимит −$${LIVE.dailyLossUsd}) — новые реальные входы ${experimentId} до 00:00 UTC. Остальные эксперименты торгуют.`;
}

export type LiveHaltAction = "stop" | "resume" | "close_all";

export function liveHaltText(action: LiveHaltAction, by: string): string {
  if (action === "stop")
    return `⏸ Реальный счёт: входы остановлены (${by}). Открытые позиции доживают со своими TP/SL.`;
  if (action === "resume")
    return `▶️ Реальный счёт: входы возобновлены (${by}).`;
  return `🛑 Реальный счёт: «Закрыть всё» (${by}) — входы остановлены, воркер закроет все позиции по рынку на ближайшем прогоне.`;
}

export function liveCloseAllDoneText(r: {
  closed: number;
  failed: number;
  errors: string[];
}): string {
  const errors = r.errors.length
    ? ` Ошибки: ${r.errors.slice(0, 3).join("; ")}`
    : "";
  return `🛑 «Закрыть всё» выполнено: закрыто ${r.closed}, не закрылось ${r.failed}.${errors}`;
}

export function liveToggleText(
  experimentId: string,
  enabled: boolean,
  by: string,
): string {
  return enabled
    ? `💰 Реальный счёт включён для ${experimentId} (${by}): $${LIVE.notionalUsd} на сделку, лимит −$${LIVE.dailyLossUsd} за сутки.`
    : `💤 Реальный счёт выключен для ${experimentId} (${by}): новых входов нет, открытые позиции доживают со своими TP/SL.`;
}
