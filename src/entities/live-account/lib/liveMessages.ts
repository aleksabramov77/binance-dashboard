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

/** «остаток 0.00000986 BTC ≈ $0,81 на субсчёте». */
export function liveLeftoverText(l: {
  qty: number;
  asset: string;
  usd: number;
}): string {
  return `остаток ${l.qty.toFixed(8).replace(/\.?0+$/, "")} ${l.asset} ≈ ${liveUsd(l.usd)} на субсчёте`;
}

/**
 * «🔴 Закрыта: S98 BTCUSDT +$0,84 (TP)». PnL null — не посчитан. Остаток монеты (в PnL не входит) и «после N
 * попыток» — в той же строке.
 */
export function liveExitText(
  s: LiveTradeSubject,
  o: {
    realizedPnl: number | null;
    closedBy: string | null;
    leftover?: { qty: number; asset: string; usd: number } | null;
    attempts?: number;
    /** PnL — оценка по ценам входа и выхода (исполнения не прочитаны). */
    pnlEstimated?: boolean;
  },
): string {
  const pnl =
    o.realizedPnl === null
      ? "PnL не посчитан"
      : o.pnlEstimated
        ? `≈ ${liveUsd(o.realizedPnl, true)} (оценка)`
        : liveUsd(o.realizedPnl, true);
  const by = o.closedBy ? ` (${CLOSED_BY[o.closedBy] ?? o.closedBy})` : "";
  const extra = [
    o.leftover ? `${liveLeftoverText(o.leftover)}, в PnL не входит` : null,
    o.attempts && o.attempts > 1 ? `закрыта после ${o.attempts} попыток` : null,
  ].filter(Boolean);
  return `🔴 Закрыта: ${subject(s)} ${pnl}${by}${extra.length ? ` · ${extra.join(" · ")}` : ""}`;
}

export function liveCloseFailedText(s: LiveTradeSubject, message: string) {
  return `⚠️ Реальная позиция не закрылась: ${subject(s)} — ${message} Закрытие повторяется каждый прогон воркера, пока позиция не закроется.`;
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
  remaining?: number;
  runs?: number;
}): string {
  const errors = r.errors.length
    ? ` Ошибки: ${r.errors.slice(0, 3).join("; ")}`
    : "";
  if (r.remaining)
    return `🛑 «Закрыть всё»: закрыто ${r.closed}, не закрылось ${r.failed} — осталось ${r.remaining}, закрытие повторяется каждый прогон воркера.${errors}`;
  const runs = r.runs && r.runs > 1 ? ` за ${r.runs} прогонов` : "";
  return `🛑 «Закрыть всё» выполнено${runs}: реальных позиций не осталось (в последнем прогоне закрыто ${r.closed}).${errors}`;
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
