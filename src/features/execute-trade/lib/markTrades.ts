import type { TradeMark, TradeStatus } from "@/entities/trade";
import type {
  DemoCloseKind,
  DemoProtectiveStop,
} from "@/shared/api/binance/demo.server";
import type { OrderAggregate } from "./groupFills";

/** Что сейчас на бирже по символу — для статусов. */
export interface SymbolState {
  /** orderId → своя сделка дашборда (clientIdGroup): ордера одной сделки не смешиваются с соседними. */
  groups: Map<number, string>;
  /** orderId исполненного ордера → тип выхода (TP/SL/…); ручных ордеров в карте нет. */
  closeKinds: Map<number, DemoCloseKind>;
  /** Активные защитные стопы. */
  openStops: DemoProtectiveStop[];
  /**
   * Позиция сейчас: futures — размер со знаком; spot — количество базовой монеты на балансе
   * (null — нет). entryPrice/unrealizedPnl — только futures.
   */
  position: {
    amount: number;
    entryPrice: number | null;
    unrealizedPnl: number | null;
    /** Hedge: размер по сторонам (LONG/SHORT → со знаком). */
    bySide?: Record<string, number>;
  } | null;
}

/** Оценка ордера: статус его сделки + PnL выхода (для спота считаем сами). */
export interface OrderMark extends TradeMark {
  pnl: number | null;
}

interface Trade {
  /** Сделка дашборда (clientIdGroup) или `side:<positionSide>` для ордеров без своего id. */
  key: string;
  /** 1 — лонг, −1 — шорт. */
  dir: 1 | -1;
  /** Оставшийся объём позиции (без знака). */
  remaining: number;
  entryQty: number;
  entryCost: number;
  /** Сумма PnL выходов; null — вход не в истории (PnL спота не посчитать). */
  pnl: number | null;
  lastExit: OrderAggregate | null;
  orders: {
    order: OrderAggregate;
    role: TradeMark["role"];
    pnl: number | null;
  }[];
}

/** Остаток меньше этой доли входа — позиция закрыта (на споте остаётся пыль от комиссии). */
const DUST: Record<OrderAggregate["market"], number> = {
  spot: 0.02,
  futures: 1e-6,
};

/**
 * Spot: сделка считается открытой, если на балансе осталось не меньше этой доли купленного.
 * Меньше — монету продали/перевели мимо истории (или это пыль).
 */
const SPOT_HELD_SHARE = 0.5;

const signOf = (o: OrderAggregate): 1 | -1 => (o.side === "BUY" ? 1 : -1);

/**
 * Один ордер в сделке своего ключа: рост |позиции| — вход, уменьшение — выход. Возвращает текущую
 * сделку ключа после ордера (новые сделки дописываются в trades).
 */
function applyOrder(
  cur: Trade | null,
  o: OrderAggregate,
  key: string,
  trades: Trade[],
): Trade | null {
  const dir = signOf(o);
  const isClosed = !cur || cur.remaining <= cur.entryQty * DUST[o.market];
  if (cur && !isClosed && dir !== cur.dir) {
    const closeQty = Math.min(o.quantity, cur.remaining);
    const pnl =
      o.market === "futures"
        ? (o.realizedPnl ?? 0)
        : (o.avgPrice - cur.entryCost / cur.entryQty) * closeQty * cur.dir;
    cur.pnl = cur.pnl === null ? null : cur.pnl + pnl;
    const reversal: number = o.quantity - cur.remaining;
    cur.remaining = Math.max(0, cur.remaining - o.quantity);
    cur.lastExit = o;
    cur.orders.push({ order: o, role: "exit", pnl });
    // Разворот одним ордером (шорт 10 закрыт покупкой 15): остаток — вход новой сделки.
    // Строка ордера получит статус новой сделки, роль «выход» и PnL закрытой.
    // Только futures: на споте шорта нет, а «лишняя» продажа — это вход за пределами
    // истории или монеты с депозита; излишек просто отбрасываем.
    if (o.market === "futures" && reversal > cur.entryQty * DUST[o.market]) {
      const next: Trade = {
        key,
        dir,
        remaining: reversal,
        entryQty: reversal,
        entryCost: reversal * o.avgPrice,
        pnl: 0,
        lastExit: null,
        orders: [{ order: o, role: "entry", pnl: null }],
      };
      trades.push(next);
      return next;
    }
    return cur;
  }
  if (cur && !isClosed) {
    cur.remaining += o.quantity;
    cur.entryQty += o.quantity;
    cur.entryCost += o.quoteQty;
    cur.orders.push({ order: o, role: "entry", pnl: null });
    return cur;
  }
  // Новая сделка. Ордер с PnL (futures) или продажа на споте без входа в истории —
  // это выход, вход которого остался за пределами загруженной истории.
  const orphanExit =
    o.market === "futures" ? (o.realizedPnl ?? 0) !== 0 : o.side === "SELL";
  if (orphanExit) {
    const pnl = o.market === "futures" ? o.realizedPnl : null;
    trades.push({
      key,
      dir: dir === 1 ? -1 : 1,
      remaining: 0,
      entryQty: o.quantity,
      entryCost: 0,
      pnl,
      lastExit: o,
      orders: [{ order: o, role: "exit", pnl }],
    });
    return null;
  }
  const next: Trade = {
    key,
    dir,
    remaining: o.quantity,
    entryQty: o.quantity,
    entryCost: o.quoteQty,
    pnl: 0,
    lastExit: null,
    orders: [{ order: o, role: "entry", pnl: null }],
  };
  trades.push(next);
  return next;
}

const isOpenTrade = (t: Trade | null): t is Trade =>
  t !== null && t.remaining > t.entryQty * DUST[t.orders[0].order.market];

/**
 * Разбивает ордера символа на сделки. Ордер своей сделки дашборда (groups: clientOrderId
 * `bd…-…`) идёт в её сделку — несколько зеркал по одной монете не склеиваются (spec 0012, PR 2d).
 * Ордер без своего id (ручной, старый, выход по рынку до PR 2d): если это выход для открытой
 * сделки дашборда той же стороны позиции — закрывает самую раннюю из них; иначе — общая
 * последовательность стороны позиции, как раньше.
 */
function splitTrades(
  orders: OrderAggregate[],
  groups: Map<number, string>,
): Trade[] {
  const trades: Trade[] = [];
  const current = new Map<string, Trade | null>();
  for (const o of [...orders].sort((a, b) => a.time - b.time)) {
    let key = groups.get(o.orderId);
    if (!key) {
      const exitFor = trades.find(
        (t) =>
          !t.key.startsWith("side:") &&
          current.get(t.key) === t &&
          isOpenTrade(t) &&
          t.dir !== signOf(o) &&
          t.orders[0].order.positionSide === o.positionSide,
      );
      key = exitFor ? exitFor.key : `side:${o.positionSide}`;
    }
    current.set(key, applyOrder(current.get(key) ?? null, o, key, trades));
  }
  return trades;
}

function closedStatus(
  kind: DemoCloseKind | undefined,
  pnl: number | null,
): TradeStatus {
  if (kind === "tp") return "tp";
  if (kind === "liquidation") return "liquidation";
  if (kind === "sl" || kind === "trailing")
    return pnl !== null && pnl > 0 ? "stop-profit" : "sl";
  if (pnl === null) return "unknown";
  return pnl > 0 ? "manual-profit" : "manual-loss";
}

/**
 * Статусы сделок одного символа (один рынок). Закрытая сделка — по последнему выходу
 * и итоговому PnL; открытая — по позиции и стопам на бирже. state = null (данные не
 * загрузились) → у всех «статус неизвестен».
 * Возвращает orderId → оценка.
 */
export function markTrades(
  orders: OrderAggregate[],
  state: SymbolState | null,
): Map<number, OrderMark> {
  const marks = new Map<number, OrderMark>();
  for (const trade of splitTrades(orders, state?.groups ?? new Map())) {
    const market = trade.orders[0].order.market;
    const isOpen = trade.remaining > trade.entryQty * DUST[market];
    let status: TradeStatus = "unknown";
    let stopPrice: number | null = null;
    let unrealizedPnl: number | null = null;

    if (state && !isOpen) {
      status = closedStatus(
        trade.lastExit
          ? state.closeKinds.get(trade.lastExit.orderId)
          : undefined,
        trade.pnl,
      );
    } else if (state?.position) {
      // Hedge: позиция своей стороны (LONG/SHORT), One-way — общая.
      const ps = trade.orders[0].order.positionSide;
      const amount =
        ps !== "BOTH"
          ? (state.position.bySide?.[ps] ?? 0)
          : state.position.amount;
      // Позиция на бирже должна совпадать по направлению (futures) или по монете (spot).
      const stillOpen =
        market === "futures"
          ? Math.sign(amount) === trade.dir
          : amount >= trade.remaining * SPOT_HELD_SHARE;
      if (stillOpen) {
        const entry =
          state.position.entryPrice || trade.entryCost / trade.entryQty;
        // Позицию защищают только стопы закрывающей стороны: SELL у лонга, BUY у шорта.
        // Стоп другой стороны — забытый ордер от прошлой сделки (closePosition висит).
        // У сделки дашборда — только её стопы (у соседних зеркал по монете — свои).
        const own = !trade.key.startsWith("side:");
        const stops = state.openStops.filter(
          (s) =>
            s.side === (trade.dir === 1 ? "SELL" : "BUY") &&
            (!own || s.group === trade.key),
        );
        // Trailing до активации может прийти с триггером 0 — цену SL из него не берём.
        const triggers = stops.map((s) => s.triggerPrice).filter((p) => p > 0);
        // Ближайший к цене стоп: у лонга — самый высокий, у шорта — самый низкий.
        stopPrice = triggers.length
          ? trade.dir === 1
            ? Math.max(...triggers)
            : Math.min(...triggers)
          : null;
        unrealizedPnl = state.position.unrealizedPnl;
        const lockedProfit =
          stops.some((s) => s.trailing) ||
          (stopPrice !== null &&
            (trade.dir === 1 ? stopPrice >= entry : stopPrice <= entry));
        status =
          stops.length === 0
            ? "open-unprotected"
            : lockedProfit
              ? "open-trailing"
              : "open";
      }
    }

    for (const { order, role, pnl } of trade.orders) {
      // Ордер-разворот уже размечен закрытой сделкой как выход с PnL: роль и PnL
      // оставляем (PnL виден в строке), статус берём у новой сделки.
      const prev = marks.get(order.orderId);
      marks.set(order.orderId, {
        status,
        role: prev?.role ?? role,
        stopPrice: isOpen ? stopPrice : null,
        unrealizedPnl: isOpen ? unrealizedPnl : null,
        pnl: prev ? prev.pnl : pnl,
      });
    }
  }
  return marks;
}
