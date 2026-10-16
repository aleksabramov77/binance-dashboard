// Реализованный PnL реальной сделки по фактическим исполнениям (spec 0049, AC4). На субсчёте по монете рынка — одна
// реальная позиция, поэтому исполнения символа с момента входа принадлежат этой сделке. Чистая функция.
//
// PnL считается только по закрытой части: выручка выхода − стоимость этого объёма по средней цене входа − все
// комиссии в $. Нераспроданный остаток (спот: комиссия покупки в монете и шаг продажи оставляют «пыль») лежит на
// субсчёте и в PnL не входит — он отдельно, с оценкой по цене выхода.

export interface FillLike {
  /** Ордер исполнения: с orderIds в расчёт идут только свои ордера сделки. */
  orderId?: number;
  /** Unix ms. */
  time: number;
  side: "BUY" | "SELL";
  qty: number;
  quoteQty: number;
  commission: number;
  commissionAsset: string;
}

export interface FillsPnl {
  entryQty: number;
  exitQty: number;
  /** Средняя цена входа; null — входа в исполнениях нет. */
  entryPrice: number | null;
  /** Средняя цена выхода; null — выходов нет. */
  exitPrice: number | null;
  /** Комиссии в $: USDT — как есть, базовая монета — по цене исполнения; прочие (BNB) не учтены. */
  feesUsd: number;
  /** PnL закрытой части в $ после всех комиссий; null — выхода ещё нет. */
  realizedPnl: number | null;
  /** Остаток монет на субсчёте после выхода (пыль): куплено − комиссия в монете − продано. */
  leftoverQty: number;
  /** Остаток в $ по цене выхода (или входа); 0 — остатка нет. */
  leftoverUsd: number;
  /** Комиссии в других монетах (BNB…), которые в $ не пересчитаны. */
  unpricedFees: string[];
}

const QUOTE = "USDT";
/** Остаток меньше этой доли купленного — погрешность округления, а не монеты. */
const DUST_EPS = 1e-9;

export function fillsPnl(
  fills: readonly FillLike[],
  input: {
    direction: "long" | "short";
    since: number;
    baseAsset: string;
    /** Свои ордера сделки (вход, свои TP/SL, своё закрытие): есть — фильтр по ним, а не по времени. */
    orderIds?: ReadonlySet<number>;
  },
): FillsPnl {
  const entrySide = input.direction === "long" ? "BUY" : "SELL";
  const ids = input.orderIds;
  const own = fills.filter((f) =>
    ids ? f.orderId !== undefined && ids.has(f.orderId) : f.time >= input.since,
  );
  let entryQty = 0;
  let entryQuote = 0;
  let exitQty = 0;
  let exitQuote = 0;
  let feesUsd = 0;
  let baseFeeQty = 0;
  const unpriced = new Set<string>();
  for (const f of own) {
    if (f.side === entrySide) {
      entryQty += f.qty;
      entryQuote += f.quoteQty;
    } else {
      exitQty += f.qty;
      exitQuote += f.quoteQty;
    }
    if (f.commissionAsset === QUOTE) feesUsd += f.commission;
    else if (f.commissionAsset === input.baseAsset && f.qty > 0) {
      // Комиссия в монете — её стоимость по цене исполнения; эти монеты на счёт не пришли.
      feesUsd += f.commission * (f.quoteQty / f.qty);
      if (f.side === entrySide) baseFeeQty += f.commission;
    } else if (f.commission > 0) unpriced.add(f.commissionAsset);
  }
  const entryPrice = entryQty > 0 ? entryQuote / entryQty : null;
  const exitPrice = exitQty > 0 ? exitQuote / exitQty : null;
  // Закрытая часть — по средней цене входа: остаток не продан и убытком не считается.
  const matchedCost = entryPrice === null ? 0 : entryPrice * exitQty;
  const gross =
    input.direction === "long"
      ? exitQuote - matchedCost
      : matchedCost - exitQuote;
  const left = entryQty - baseFeeQty - exitQty;
  const leftoverQty = left > entryQty * DUST_EPS ? left : 0;
  return {
    entryQty,
    exitQty,
    entryPrice,
    exitPrice,
    feesUsd,
    realizedPnl: exitQty > 0 && entryPrice !== null ? gross - feesUsd : null,
    leftoverQty,
    leftoverUsd: leftoverQty * (exitPrice ?? entryPrice ?? 0),
    unpricedFees: [...unpriced],
  };
}
