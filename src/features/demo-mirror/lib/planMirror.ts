import { MIRROR } from "../config/mirror";

// Чистая часть demo-зеркала (spec 008): отбор paper-сделок и уровни заявки на Binance Demo.

export interface MirrorTradeInput {
  tradeId: string;
  market: "spot" | "usdm";
  symbol: string;
  direction: "long" | "short";
  openedAt: string;
  entryPrice: number;
  quantity: number;
  stop: number | null;
  takeProfit: number | null;
}

export interface MirrorOrderRequest {
  symbol: string;
  market: "spot" | "usdm";
  direction: "long" | "short";
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  leverage: number;
  /** Объём ниже минимума символа — поднять до минимума (не больше чем втрое). */
  fitMinNotional: boolean;
  /** У paper-сделки нет TP — на бирже только стоп (тейк закроет само зеркало). */
  stopOnly: boolean;
}

export type MirrorDecision =
  | { tradeId: string; kind: "open"; request: MirrorOrderRequest }
  | { tradeId: string; kind: "skip"; reason: string };

const key = (t: Pick<MirrorTradeInput, "market" | "symbol">) =>
  `${t.market}:${t.symbol}`;

/**
 * Уровни заявки. Стоп и TP — текущие paper-уровни. Если их нет, ставим «страховочные»:
 * стоп в fallbackStopPct от входа, TP — в fallbackTakeProfitR R (практически недостижим):
 * такую сделку закроет само зеркало, когда закроется paper-сделка.
 */
export function mirrorLevels(t: MirrorTradeInput): {
  stopLoss: number;
  takeProfit: number;
} {
  const long = t.direction === "long";
  const stopLoss =
    t.stop ??
    t.entryPrice *
      (long ? 1 - MIRROR.fallbackStopPct : 1 + MIRROR.fallbackStopPct);
  const risk = Math.abs(t.entryPrice - stopLoss);
  const far = risk * MIRROR.fallbackTakeProfitR;
  const takeProfit =
    t.takeProfit ??
    (long
      ? t.entryPrice + far
      : Math.max(t.entryPrice * 0.1, t.entryPrice - far));
  return { stopLoss, takeProfit };
}

/** Есть ли символы на демо-рынке (ключи market:symbol, см. listingKey). */
export interface MirrorListing {
  /** Символа точно нет на демо — пропуск без запроса на вход. */
  missing: Set<string>;
  /** Проверить не удалось (сеть) — кандидат ждёт следующего прогона. */
  unknown: Set<string>;
}

export const listingKey = key;

const MARKET_NAME = { spot: "демо-споте", usdm: "демо-фьючерсах" } as const;

/**
 * Что делать с кандидатами: открыть зеркало или пропустить (с причиной).
 * Один символ рынка — одна демо-позиция: TP/SL на фьючерсах общие для символа, на споте OCO
 * продал бы монеты другой сделки. Старые входы и монеты, которых нет на демо, пропускаем.
 */
export function planMirror(
  candidates: MirrorTradeInput[],
  busy: Set<string>,
  now: number,
  listing: MirrorListing = { missing: new Set(), unknown: new Set() },
): MirrorDecision[] {
  const taken = new Set(busy);
  const decisions: MirrorDecision[] = [];
  let opened = 0;
  for (const t of candidates) {
    if (now - Date.parse(t.openedAt) > MIRROR.maxEntryAgeMs) {
      decisions.push({
        tradeId: t.tradeId,
        kind: "skip",
        reason: "Вход старше 10 минут — цена ушла, не зеркалим.",
      });
      continue;
    }
    if (!t.symbol.endsWith("USDT")) {
      decisions.push({
        tradeId: t.tradeId,
        kind: "skip",
        reason: `${t.symbol}: демо-зеркало торгует только пары к USDT.`,
      });
      continue;
    }
    if (t.market === "spot" && t.direction === "short") {
      decisions.push({
        tradeId: t.tradeId,
        kind: "skip",
        reason: "Шорт на споте невозможен.",
      });
      continue;
    }
    if (listing.missing.has(key(t))) {
      decisions.push({
        tradeId: t.tradeId,
        kind: "skip",
        reason: `${t.symbol}: нет на ${MARKET_NAME[t.market]}.`,
      });
      continue;
    }
    // Справочник демо не загрузился — не пропускаем навсегда, повторим на следующей минуте.
    if (listing.unknown.has(key(t))) continue;
    if (taken.has(key(t))) {
      decisions.push({
        tradeId: t.tradeId,
        kind: "skip",
        reason: `По ${t.symbol} (${t.market}) уже есть зеркальная позиция.`,
      });
      continue;
    }
    // Лимит прогона: остальные кандидаты дождутся следующей минуты (не пропускаем навсегда).
    if (opened >= MIRROR.maxEntriesPerRun) continue;
    taken.add(key(t));
    opened++;
    decisions.push({
      tradeId: t.tradeId,
      kind: "open",
      request: {
        symbol: t.symbol,
        market: t.market,
        direction: t.direction,
        quantity: t.quantity,
        leverage: t.market === "usdm" ? MIRROR.leverage : 1,
        fitMinNotional: true,
        stopOnly: t.takeProfit === null,
        ...mirrorLevels(t),
      },
    });
  }
  return decisions;
}
