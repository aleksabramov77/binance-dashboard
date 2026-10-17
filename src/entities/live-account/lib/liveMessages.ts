import { splitSymbol } from "@/shared/lib";
import { LIVE } from "../config/liveMirror";
import { livePrice, liveUsd } from "./money";

// Тексты журнала и Telegram реального зеркала (spec 0049, AC8; карточка сделки — spec 0068, вариант B, вид — версия 3).
// Чистые функции: id эксперимента — настоящий (в журнале и Telegram), в тестах и документации — фиктивный. Карточка
// сделки — одно сообщение на сделку: шапка в две строки, строка статуса (если нужна), лесенка цен, время, комиссии и
// баланс. Текст — HTML (монета жирным, всё остальное экранировано) или простой текст для журнала.

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

/** Отступ между ценой и процентом/суммой в лесенке: два en space (U+2002). */
const GAP = "  ";

/** Экранирование для parse_mode HTML Telegram: &, <, >. */
export const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** «+4,0 %» / «−2,0 %» — возможная прибыль (TP) или убыток (SL) от цены входа. */
function pctText(level: number, entry: number, sign: "+" | "−"): string {
  const pct = Math.abs(((level - entry) / entry) * 100);
  return `${sign}${pct.toFixed(1).replace(".", ",")} %`;
}

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

/** «18.10 · 08:10 UTC». */
const utcDateTime = (iso: string) =>
  `${iso.slice(8, 10)}.${iso.slice(5, 7)} · ${iso.slice(11, 16)} UTC`;

/** Баланс субсчёта: после закрытия (от воркера) или по последнему пульсу — с временем пульса. */
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
  /** Когда закрыта, ISO. */
  closedAt: string;
  /** Время в сделке, мс; null — не известно. */
  heldMs: number | null;
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
  | { kind: "cancelled"; message: string; at: string }
  | { kind: "closed"; exit: LiveCardExit };

/** Со звуком — итог и проблемы; ход входа (⏳, 🟡) — тихо. */
export const liveCardUrgent = (status: LiveCardStatus): boolean =>
  status.kind !== "filled" && status.kind !== "protected";

/** Проблема с позицией — вместо «🔗 Binance» кнопка «✍️ Выставить вручную на Binance». */
export const liveCardProblem = (status: LiveCardStatus): boolean =>
  status.kind === "unprotected" || status.kind === "close_failed";

/** Страница монеты на Binance: фьючерс — /futures/BTCUSDT, спот — /trade/BTC_USDT. */
export function liveBinanceUrl(s: Pick<LiveTradeSubject, "symbol" | "market">) {
  if (s.market === "usdm")
    return `https://www.binance.com/en/futures/${s.symbol}`;
  const { base, quote } = splitSymbol(s.symbol);
  return `https://www.binance.com/en/trade/${quote ? `${base}_${quote}` : s.symbol}`;
}

/** 🟢 — прибыль, 🔴 — убыток, ⚪ — ноль или PnL неизвестен. */
const outcomeColor = (pnl: number | null) =>
  pnl === null || pnl === 0 ? "⚪" : pnl > 0 ? "🟢" : "🔴";

/** Первая строка шапки: значок статуса, PnL (у закрытой), направление. */
function headLine(s: LiveTradeSubject, status: LiveCardStatus): string {
  const dir = s.direction === "long" ? "📈 LONG" : "📉 SHORT";
  switch (status.kind) {
    case "filled":
      return `⏳ ${dir}`;
    case "protected":
      return `🟡 ${dir}`;
    case "unprotected":
    case "close_failed":
      return `⚠️ ${dir}`;
    case "cancelled":
      return `⚪ Вход отменён ${dir}`;
    case "closed": {
      const e = status.exit;
      const pnl =
        e.realizedPnl === null
          ? "PnL ?"
          : `${e.pnlEstimated ? "≈ " : ""}${liveUsd(e.realizedPnl, true)}`;
      return `${outcomeColor(e.realizedPnl)} ${pnl} ${dir}`;
    }
  }
}

/** Код ошибки Binance из текста: «… (-2010)» → «-2010». */
const apiCode = (message: string) =>
  /\((-\d{3,5})\)/.exec(message)?.[1] ??
  /(?:^|\s)(-\d{4})\b/.exec(message)?.[1];

/** Строки статуса: только у ⏳, ⚠️, ⚪ отменён и у закрытой с оценкой / неизвестным PnL / остатком / повторами. */
function statusLines(status: LiveCardStatus): string[] {
  switch (status.kind) {
    case "filled":
      return ["⏳ Вход исполнен, ставлю SL/TP…"];
    case "protected":
      return [];
    case "unprotected":
    case "close_failed": {
      const code = apiCode(status.message);
      // Что сделать — кнопка «✍️ Выставить вручную на Binance» под карточкой.
      return [
        status.kind === "unprotected"
          ? `⚠️ Причина: ${status.message}`
          : `⚠️ Причина: позиция не закрылась — ${status.message} Повторяю каждый прогон воркера.`,
        ...(code ? [`🧾 Код API: ${code}`] : []),
      ];
    }
    case "cancelled":
      return [`↩️ ${status.message}`];
    case "closed": {
      const e = status.exit;
      return [
        e.realizedPnl === null
          ? "❔ Цена выхода и исполнения не прочитаны — в порогах автовыключения считается убытком"
          : e.pnlEstimated
            ? "≈ PnL — оценка: исполнения Binance не прочитаны"
            : null,
        e.leftover
          ? `🪙 ${liveLeftoverText(e.leftover).replace(/^о/, "О")}, в PnL не входит`
          : null,
        e.attempts && e.attempts > 1
          ? `🔁 Закрыта после ${e.attempts} попыток`
          : null,
      ].filter((l) => l !== null);
    }
  }
}

/** Лесенка по цене (long: TP, вход, SL сверху вниз; short: SL, вход, TP); нет TP — без строки. */
function ladder(s: LiveTradeSubject, e: LiveCardEntry): string[] {
  const entry = e.entryPrice !== null && e.entryPrice > 0 ? e.entryPrice : null;
  const stop = e.stopLoss !== null && e.stopLoss > 0 ? e.stopLoss : null;
  const amount =
    e.notionalUsd === null
      ? ""
      : `${GAP}${liveUsd(e.notionalUsd)}${e.raised ? ` (${RAISED[e.raised]})` : ""}`;
  const level = (icon: string, price: number, sign: "+" | "−") =>
    `${icon} ${livePrice(price)}${entry ? `${GAP}${pctText(price, entry, sign)}` : ""}`;
  const tp = e.takeProfit === null ? null : level("🟩", e.takeProfit, "+");
  const sl = stop === null ? "🟥 SL нет" : level("🟥", stop, "−");
  const mid = `➡️ ${entry === null ? "цена входа: нет данных" : livePrice(entry)}${amount}`;
  const rows = s.direction === "long" ? [tp, mid, sl] : [sl, mid, tp];
  return rows.filter((l) => l !== null);
}

/** Чем закрыта (не TP/SL) — после времени у 🏁. */
const CLOSED_BY: Record<string, string> = {
  mirror: "вслед за paper-сделкой",
  close_all: "«Закрыть всё»",
};

/** Время: ➡️ вход; закрыта по TP — 🟩, по SL — 🟥; иначе 🏁 время · причина; ⏱ в сделке — у закрытой. */
function timeLines(e: LiveCardEntry, status: LiveCardStatus): string[] {
  const lines = [`➡️ ${utcDateTime(e.openedAt)}`];
  if (status.kind === "cancelled")
    lines.push(`🏁 ${utcDateTime(status.at)} · вход отменён биржей`);
  if (status.kind !== "closed") return lines;
  const x = status.exit;
  const at = utcDateTime(x.closedAt);
  if (x.closedBy === "tp") lines.push(`🟩 ${at}`);
  else if (x.closedBy === "sl") lines.push(`🟥 ${at}`);
  else {
    const by = x.closedBy ? (CLOSED_BY[x.closedBy] ?? x.closedBy) : "закрыта";
    const price =
      x.exitPrice && x.exitPrice > 0 ? ` по ${livePrice(x.exitPrice)}` : "";
    lines.push(`🏁 ${at} · ${by}${price}`);
  }
  if (x.heldMs !== null) lines.push(`⏱ В сделке: ${liveHeldText(x.heldMs)}`);
  return lines;
}

/** Комиссии (у закрытой) и баланс — сразу под временем, без пустой строки. */
function reportLines(status: LiveCardStatus, balance: LiveBalance | null) {
  const fees =
    status.kind === "closed"
      ? [
          `💸 Комиссии: ${
            status.exit.feesUsd === null
              ? "нет данных"
              : `${status.exit.pnlEstimated ? "≈ " : ""}${liveUsd(status.exit.feesUsd)}`
          }`,
        ]
      : [];
  return [
    ...fees,
    balance
      ? `🏦 Баланс: ${liveUsd(balance.usd)}${balance.asOf ? ` (на ${balance.asOf})` : ""}`
      : "🏦 Баланс: нет данных",
  ];
}

/**
 * Карточка сделки (spec 0068, вид — версия 3): шапка в две строки (статус · PnL · направление / монета · рынок ·
 * эксперимент), строка статуса (у 🟡 и у 🟢/🔴 по TP/SL — нет), лесенка цен, время, комиссии и баланс. format html —
 * для Telegram (монета жирным, текст экранирован), plain — для журнала. Ссылки — кнопками у канала, не в тексте.
 */
export function liveCardText(
  s: LiveTradeSubject,
  entry: LiveCardEntry,
  status: LiveCardStatus,
  balance: LiveBalance | null,
  format: "html" | "plain" = "plain",
): string {
  const esc = format === "html" ? escapeHtml : (t: string) => t;
  const { base, quote } = splitSymbol(s.symbol);
  const pair = esc(quote ? `${base}/${quote}` : s.symbol);
  const coin = format === "html" ? `<b>${pair}</b>` : pair;
  const blocks = [
    [
      esc(headLine(s, status)),
      `${coin} · ${MARKET[s.market]} · ${esc(s.experimentId)}`,
    ],
    statusLines(status).map(esc),
    ladder(s, entry).map(esc),
    [...timeLines(entry, status), ...reportLines(status, balance)].map(esc),
  ];
  return blocks
    .filter((b) => b.length > 0)
    .map((b) => b.join("\n"))
    .join("\n\n");
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
