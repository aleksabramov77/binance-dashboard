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
  /** Вход зеркала: монета и сторона могут быть общими с другими зеркалами (PR 2d). */
  mirror: true;
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

/** Зеркало, которое держит или открывает позицию (из БД). */
export interface ActiveMirror {
  market: "spot" | "usdm";
  symbol: string;
  direction: "long" | "short";
  /** Свои ссылки на стоп/тейк (PR 2b). false — строка до них: монета занята до её закрытия. */
  hasRefs: boolean;
}

/**
 * Что делать с кандидатами: открыть зеркало или пропустить (с причиной). Несколько зеркал на одну
 * монету допустимы (spec 0012, PR 2d): у каждого свои TP/SL на свой объём; лимит — MIRROR.maxPerCoin.
 * Фьючерсы в One-way: встречная сторона по монете — пропуск (лонг и шорт там — одна позиция, вход
 * закрыл бы чужую); в Hedge — открываем. Режим неизвестен (null) — встречный кандидат ждёт прогона.
 * Старые входы и монеты, которых нет на демо, пропускаем.
 */
export function planMirror(
  candidates: MirrorTradeInput[],
  active: ActiveMirror[],
  now: number,
  listing: MirrorListing = { missing: new Set(), unknown: new Set() },
  futuresMode: "oneway" | "hedge" | null = "oneway",
): MirrorDecision[] {
  const taken: ActiveMirror[] = [...active];
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
    const sameCoin = taken.filter((m) => key(m) === key(t));
    // Строка до PR 2b (без своих ссылок) закрывается снятием всех защитных ордеров своей стороны
    // символа — сняла бы и стоп второго зеркала. Пока она открыта, монета занята.
    if (sameCoin.some((m) => !m.hasRefs)) {
      decisions.push({
        tradeId: t.tradeId,
        kind: "skip",
        reason: `По ${t.symbol} (${t.market}) открыто старое зеркало, чьи стоп и тейк закрывают всю позицию, — второе зеркало после его закрытия.`,
      });
      continue;
    }
    if (MIRROR.maxPerCoin !== null && sameCoin.length >= MIRROR.maxPerCoin) {
      decisions.push({
        tradeId: t.tradeId,
        kind: "skip",
        reason: `По ${t.symbol} (${t.market}) уже ${sameCoin.length} зеркал — лимит на монету ${MIRROR.maxPerCoin}.`,
      });
      continue;
    }
    if (
      t.market === "usdm" &&
      futuresMode !== "hedge" &&
      sameCoin.some((m) => m.direction !== t.direction)
    ) {
      if (futuresMode === null) continue;
      decisions.push({
        tradeId: t.tradeId,
        kind: "skip",
        reason: `По ${t.symbol} есть встречная позиция другого зеркала — нужен Hedge mode (счёт в One-way).`,
      });
      continue;
    }
    // Лимит прогона: остальные кандидаты дождутся следующей минуты (не пропускаем навсегда).
    if (opened >= MIRROR.maxEntriesPerRun) continue;
    taken.push({
      market: t.market,
      symbol: t.symbol,
      direction: t.direction,
      hasRefs: true,
    });
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
        mirror: true,
        ...mirrorLevels(t),
      },
    });
  }
  return decisions;
}
