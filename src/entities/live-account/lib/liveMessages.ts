import { LIVE } from "../config/liveMirror";
import { livePrice, liveUsd } from "./money";

// Тексты журнала и Telegram реального зеркала (spec 0049, AC8; карточка сделки — spec 0068, вариант B). Чистые
// функции: id эксперимента — настоящий (в журнале и Telegram), в тестах и документации — фиктивный. Карточка сделки —
// одно сообщение на сделку, всегда полное: статус в заголовке, данные входа, итог или «что случилось», время входа.

/** Почему объём выше $10 — по причине из sizeEntry: «минимум биржи» — только когда сработал minNotional. */
const RAISED = {
  minNotional: "минимум биржи",
  minQty: "минимальное количество монеты на бирже",
  spotStop: "стоп после комиссии должен пройти минимум ордера",
} as const;
export type LiveSizeRaised = keyof typeof RAISED;

const MARKET = { usdm: "USDⓈ-M", spot: "Spot" } as const;

export interface LiveTradeSubject {
  experimentId: string;
  symbol: string;
  market: "spot" | "usdm";
  direction: "long" | "short";
}

/** «S98 BTCUSDT long · USDⓈ-M». */
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

const optionalPrice = (v: number | null) =>
  v === null || v <= 0 ? "нет данных" : livePrice(v);

/** Чем закрыта — для строки цен итога. */
const CLOSED_LINE: Record<string, string> = {
  tp: "Закрыта по TP",
  sl: "Закрыта по SL",
  mirror: "Закрыта вслед за paper-сделкой",
  close_all: "Закрыта по «Закрыть всё»",
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

/** «18.10 12:40 UTC» — время входа в карточке. */
const utcDateTime = (iso: string) =>
  `${iso.slice(8, 10)}.${iso.slice(5, 7)} ${iso.slice(11, 16)} UTC`;

/** Баланс субсчёта для итога: после закрытия (от воркера) или по последнему пульсу — с временем пульса. */
export interface LiveBalance {
  usd: number;
  /** «12:40 UTC» — баланс из последнего пульса воркера; null — прочитан после закрытия. */
  asOf: string | null;
}

/** Данные входа карточки — одинаковые во всех статусах. */
export interface LiveCardEntry {
  /** Объём входа, $; null — не известен. */
  notionalUsd: number | null;
  raised: LiveSizeRaised | null;
  /** Цена входа по исполнению; null — не известна (проценты не считаются). */
  entryPrice: number | null;
  /** Свой стоп; null или ≤ 0 — нет. */
  stopLoss: number | null;
  /** Свой тейк; null — без тейка (строки TP нет). */
  takeProfit: number | null;
  /** Время входа, ISO. */
  openedAt: string;
}

/** Итог закрытой сделки. */
export interface LiveCardExit {
  realizedPnl: number | null;
  /** PnL — оценка по ценам входа и выхода (исполнения не прочитаны). */
  pnlEstimated?: boolean;
  closedBy: string | null;
  exitPrice: number | null;
  feesUsd: number | null;
  /** Время в сделке, мс; null — не известно. */
  heldMs: number | null;
  balance: LiveBalance | null;
  leftover?: { qty: number; asset: string; usd: number } | null;
  attempts?: number;
}

/**
 * Статус карточки (spec 0068, вариант B): ⏳ вход исполнен, ставлю SL/TP; 🟡 открыта, защищена; ⚠️ без защиты или не
 * закрылась; ⚪ вход отменён (после ⏳ позиции нет); 🟢/🔴/⚪ закрыта (прибыль / убыток / ноль или PnL неизвестен).
 */
export type LiveCardStatus =
  | { kind: "filled" }
  | { kind: "protected" }
  | { kind: "unprotected"; message: string }
  | { kind: "close_failed"; message: string }
  /** Вход исполнялся (была карточка ⏳), но позиции нет: биржа откатила вход. */
  | { kind: "cancelled"; message: string }
  | { kind: "closed"; exit: LiveCardExit };

/** Со звуком — итог и проблемы; ход входа (⏳, 🟡) — тихо. */
export const liveCardUrgent = (status: LiveCardStatus): boolean =>
  status.kind !== "filled" && status.kind !== "protected";

/** 🟢 — прибыль, 🔴 — убыток, ⚪ — ноль или PnL неизвестен. */
const outcomeColor = (pnl: number | null) =>
  pnl === null || pnl === 0 ? "⚪" : pnl > 0 ? "🟢" : "🔴";

const exitHead = (o: LiveCardExit) =>
  `${outcomeColor(o.realizedPnl)} ${
    o.realizedPnl === null
      ? "PnL неизвестен"
      : `${o.pnlEstimated ? "≈ " : ""}${liveUsd(o.realizedPnl, true)}`
  }`;

function cardHead(status: LiveCardStatus, entry: LiveCardEntry): string {
  switch (status.kind) {
    case "filled":
      return "⏳ Вход исполнен, ставлю SL/TP";
    case "protected":
      return entry.takeProfit === null
        ? "🟡 Открыта, SL стоит"
        : "🟡 Открыта, SL/TP стоят";
    case "unprotected":
      return "⚠️ Без защиты";
    case "close_failed":
      return "⚠️ Не закрылась";
    case "cancelled":
      return "⚪ Вход отменён";
    case "closed":
      return exitHead(status.exit);
  }
}

/** Итог закрытия: чем закрыта и цены, комиссии и время, баланс, пометки — каждая своей строкой (AC3–AC4). */
function exitLines(o: LiveCardExit, entryPrice: number | null): string[] {
  const closed = o.closedBy
    ? (CLOSED_LINE[o.closedBy] ?? `Закрыта (${o.closedBy})`)
    : "Закрыта";
  const fees = `Комиссии: ${o.feesUsd === null ? "нет данных" : liveUsd(o.feesUsd)}`;
  const leftover = o.leftover ? liveLeftoverText(o.leftover) : null;
  return [
    `${closed}: ${optionalPrice(entryPrice)} → ${optionalPrice(o.exitPrice)}`,
    o.heldMs === null ? fees : `${fees} · в сделке ${liveHeldText(o.heldMs)}`,
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
  ].filter((l) => l !== null);
}

/** Проблема: что случилось и что сделать (AC7). */
function problemLines(
  status: Extract<
    LiveCardStatus,
    { kind: "unprotected" | "close_failed" | "cancelled" }
  >,
): string[] {
  const next = {
    unprotected:
      "Что сделать: закройте позицию на Binance вручную или нажмите «Закрыть всё».",
    close_failed:
      "Что дальше: закрытие повторяется каждый прогон воркера, пока позиция не закроется.",
    cancelled: null,
  }[status.kind];
  return [`Что случилось: ${status.message}`, next].filter((l) => l !== null);
}

/**
 * Карточка сделки (spec 0068, вариант B): «<статус> · S98 BTCUSDT long · USDⓈ-M», объём (с причиной, если выше $10),
 * цена входа, SL и TP с процентом от цены входа (без TP — без строки), затем итог или «что случилось», время входа.
 * Ссылку добавляет канал строкой ниже.
 */
export function liveCardText(
  s: LiveTradeSubject,
  entry: LiveCardEntry,
  status: LiveCardStatus,
): string {
  const price =
    entry.entryPrice !== null && entry.entryPrice > 0 ? entry.entryPrice : null;
  const stop =
    entry.stopLoss !== null && entry.stopLoss > 0 ? entry.stopLoss : null;
  return [
    `${cardHead(status, entry)} · ${fullSubject(s)}`,
    `Объём: ${entry.notionalUsd === null ? "нет данных" : liveUsd(entry.notionalUsd)}${entry.raised ? ` (${RAISED[entry.raised]})` : ""}`,
    `Цена входа: ${price === null ? "нет данных" : livePrice(price)}`,
    stop === null ? "SL: нет" : levelLine("SL", stop, price),
    entry.takeProfit === null ? null : levelLine("TP", entry.takeProfit, price),
    ...(status.kind === "closed" ? exitLines(status.exit, price) : []),
    ...(status.kind === "unprotected" ||
    status.kind === "close_failed" ||
    status.kind === "cancelled"
      ? problemLines(status)
      : []),
    `Вход: ${utcDateTime(entry.openedAt)}`,
  ]
    .filter((l) => l !== null)
    .join("\n");
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
