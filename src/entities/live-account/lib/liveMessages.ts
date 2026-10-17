import { LIVE } from "../config/liveMirror";
import { livePrice, liveUsd } from "./money";

// Тексты журнала и Telegram реального зеркала (spec 0049, AC8; вид сообщений о сделке — spec 0068). Чистые функции:
// id эксперимента — настоящий (в журнале и Telegram), в тестах и документации — фиктивный. Сообщение о сделке — по
// строке на факт: заголовок, объём и уровни (вход) или итог, цены, комиссии и баланс (выход).

/** Почему объём выше $10 — по причине из sizeEntry: «минимум биржи» — только когда сработал minNotional. */
const RAISED = {
  minNotional: "минимум биржи",
  minQty: "минимальное количество монеты на бирже",
  spotStop: "стоп после комиссии должен пройти минимум ордера",
} as const;

const MARKET = { usdm: "USDⓈ-M", spot: "Spot" } as const;

export interface LiveTradeSubject {
  experimentId: string;
  symbol: string;
  market: "spot" | "usdm";
  direction: "long" | "short";
}

/**
 * «S98 BTCUSDT long · USDⓈ-M» — заголовок любого сообщения о сделке, и итога тоже: ответ может уйти без цитаты (вход
 * удалён — Telegram шлёт без ответа), и тогда рынок виден только из заголовка.
 */
const fullSubject = (s: LiveTradeSubject) =>
  `${s.experimentId} ${s.symbol} ${s.direction} · ${MARKET[s.market]}`;

/** «−2,0 %» — уровень от цены входа. */
function pctFrom(level: number, entry: number): string {
  const pct = ((level - entry) / entry) * 100;
  const abs = Math.abs(pct).toFixed(1).replace(".", ",");
  return `${pct < 0 ? "−" : "+"}${abs} %`;
}

const levelLine = (name: string, level: number, entry: number | null) =>
  `${name}: ${livePrice(level)}${entry ? ` (${pctFrom(level, entry)})` : ""}`;

/**
 * Вход (spec 0068, AC1): «🟡 Вход · S98 BTCUSDT long · USDⓈ-M», объём (с причиной, если выше $10), цена входа, SL и
 * TP с процентом от цены входа; без TP — без строки TP.
 */
export function liveEntryText(
  s: LiveTradeSubject,
  o: {
    notionalUsd: number;
    raised: "minNotional" | "minQty" | "spotStop" | null;
    /** Цена входа по исполнению; null — не известна (проценты не считаются). */
    entryPrice: number | null;
    stopLoss: number;
    takeProfit: number | null;
  },
): string {
  const entry = o.entryPrice !== null && o.entryPrice > 0 ? o.entryPrice : null;
  return [
    `🟡 Вход · ${fullSubject(s)}`,
    `Объём: ${liveUsd(o.notionalUsd)}${o.raised ? ` (${RAISED[o.raised]})` : ""}`,
    `Цена входа: ${entry === null ? "нет данных" : livePrice(entry)}`,
    o.stopLoss > 0 ? levelLine("SL", o.stopLoss, entry) : "SL: нет",
    o.takeProfit === null ? null : levelLine("TP", o.takeProfit, entry),
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/** «Реальная сделка без защиты» (AC7): что случилось и что сделать — своими строками. */
export function liveUnprotectedText(s: LiveTradeSubject, message: string) {
  return [
    `⚠️ Реальная сделка без защиты · ${fullSubject(s)}`,
    `Что случилось: ${message}`,
    "Что сделать: закройте позицию на Binance вручную или нажмите «Закрыть всё».",
  ].join("\n");
}

/** Чем закрыта — для строки цен итога. */
const CLOSED_LINE: Record<string, string> = {
  tp: "Закрыта по TP",
  sl: "Закрыта по SL",
  mirror: "Закрыта вслед за paper-сделкой",
  close_all: "Закрыта по «Закрыть всё»",
};

/** Чем закрыта — коротко, в скобках строки «Итог: …». */
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

/** «2 ч 15 мин» — время в сделке. */
export function liveHeldText(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "меньше минуты";
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return `${hours} ч${minutes % 60 ? ` ${minutes % 60} мин` : ""}`;
  const days = Math.floor(hours / 24);
  return `${days} д${hours % 24 ? ` ${hours % 24} ч` : ""}`;
}

/** Итог сделки для заголовка и строки «Итог: …»: цвет по PnL и сумма. */
interface LiveOutcome {
  realizedPnl: number | null;
  /** PnL — оценка по ценам входа и выхода (исполнения не прочитаны). */
  pnlEstimated?: boolean;
  closedBy: string | null;
}

/** 🟢 — прибыль, 🔴 — убыток, ⚪ — ноль или PnL неизвестен. */
const outcomeColor = (pnl: number | null) =>
  pnl === null || pnl === 0 ? "⚪" : pnl > 0 ? "🟢" : "🔴";

const outcomeHead = (o: LiveOutcome) =>
  `${outcomeColor(o.realizedPnl)} ${
    o.realizedPnl === null
      ? "PnL неизвестен"
      : `${o.pnlEstimated ? "≈ " : ""}${liveUsd(o.realizedPnl, true)}`
  }`;

/** «Итог: 🟢 +$0,84 (TP)» — строка, которую бот дописывает к сообщению о входе (AC5). */
export function liveOutcomeLine(o: LiveOutcome): string {
  const by = o.closedBy ? ` (${CLOSED_BY[o.closedBy] ?? o.closedBy})` : "";
  return `Итог: ${outcomeHead(o)}${by}`;
}

/** Отметка итога на сообщении о входе: прибыль — good (👍), убыток — bad (👎), ноль и неизвестно — без отметки. */
export function liveOutcomeMark(pnl: number | null): "good" | "bad" | null {
  if (pnl === null || pnl === 0) return null;
  return pnl > 0 ? "good" : "bad";
}

/** Баланс субсчёта для итога: после закрытия (от воркера) или по последнему пульсу — с временем пульса. */
export interface LiveBalance {
  usd: number;
  /** «12:40 UTC» — баланс из последнего пульса воркера; null — прочитан после закрытия. */
  asOf: string | null;
}

const optionalPrice = (v: number | null) =>
  v === null || v <= 0 ? "нет данных" : livePrice(v);

/**
 * Итог сделки (spec 0068, AC3): «🟢 +$0,84 · S98 BTCUSDT long», чем закрыта и цены входа → выхода, комиссии и время в
 * сделке, баланс субсчёта; пометки — оценка PnL, PnL неизвестен (в порогах — убыток, spec 0053), остаток монеты (в PnL
 * не входит), «после N попыток» — каждая своей строкой. Заголовок всегда полный, с рынком (AC6).
 */
export function liveExitText(
  s: LiveTradeSubject,
  o: LiveOutcome & {
    entryPrice: number | null;
    exitPrice: number | null;
    feesUsd: number | null;
    /** Время в сделке, мс; null — не известно. */
    heldMs: number | null;
    balance: LiveBalance | null;
    leftover?: { qty: number; asset: string; usd: number } | null;
    attempts?: number;
  },
): string {
  const closed = o.closedBy
    ? (CLOSED_LINE[o.closedBy] ?? `Закрыта (${o.closedBy})`)
    : "Закрыта";
  const held = o.heldMs === null ? null : `в сделке ${liveHeldText(o.heldMs)}`;
  const fees = `Комиссии: ${o.feesUsd === null ? "нет данных" : liveUsd(o.feesUsd)}`;
  const leftover = o.leftover ? liveLeftoverText(o.leftover) : null;
  return [
    `${outcomeHead(o)} · ${fullSubject(s)}`,
    `${closed}: ${optionalPrice(o.entryPrice)} → ${optionalPrice(o.exitPrice)}`,
    held ? `${fees} · ${held}` : fees,
    o.balance
      ? `Баланс субсчёта: ${liveUsd(o.balance.usd)}${o.balance.asOf ? ` (на ${o.balance.asOf})` : ""}`
      : "Баланс: нет данных",
    o.realizedPnl === null
      ? "⚠️ Исполнения и цена не прочитаны — в порогах автовыключения сделка считается убыточной"
      : o.pnlEstimated
        ? "≈ PnL — оценка по ценам входа и выхода (исполнения не прочитаны)"
        : null,
    leftover
      ? `${leftover[0].toUpperCase()}${leftover.slice(1)}, в PnL не входит`
      : null,
    o.attempts && o.attempts > 1 ? `Закрыта после ${o.attempts} попыток` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/** «Реальная позиция не закрылась» (AC7): что случилось и что дальше — своими строками. */
export function liveCloseFailedText(s: LiveTradeSubject, message: string) {
  return [
    `⚠️ Реальная позиция не закрылась · ${fullSubject(s)}`,
    `Что случилось: ${message}`,
    "Закрытие повторяется каждый прогон воркера, пока позиция не закроется.",
  ].join("\n");
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
