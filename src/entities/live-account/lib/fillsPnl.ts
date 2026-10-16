// Реализованный PnL реальной сделки по фактическим исполнениям (spec 0049, AC4). На субсчёте по монете рынка — одна
// реальная позиция, поэтому исполнения символа с момента входа принадлежат этой сделке. Чистая функция.

export interface FillLike {
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
  /** Средняя цена выхода; null — выходов нет. */
  exitPrice: number | null;
  /** Комиссии в $: USDT — как есть, базовая монета — по цене исполнения; прочие (BNB) не учтены. */
  feesUsd: number;
  /** PnL в $: разница оборотов выхода и входа минус комиссии в USDT; null — выхода ещё нет. */
  realizedPnl: number | null;
  /** Комиссии в других монетах (BNB…), которые в $ не пересчитаны. */
  unpricedFees: string[];
}

const QUOTE = "USDT";

export function fillsPnl(
  fills: readonly FillLike[],
  input: { direction: "long" | "short"; since: number; baseAsset: string },
): FillsPnl {
  const entrySide = input.direction === "long" ? "BUY" : "SELL";
  const own = fills.filter((f) => f.time >= input.since);
  let entryQty = 0;
  let entryQuote = 0;
  let exitQty = 0;
  let exitQuote = 0;
  let feesUsd = 0;
  let quoteFees = 0;
  const unpriced = new Set<string>();
  for (const f of own) {
    if (f.side === entrySide) {
      entryQty += f.qty;
      entryQuote += f.quoteQty;
    } else {
      exitQty += f.qty;
      exitQuote += f.quoteQty;
    }
    if (f.commissionAsset === QUOTE) {
      feesUsd += f.commission;
      quoteFees += f.commission;
    } else if (f.commissionAsset === input.baseAsset && f.qty > 0)
      // Комиссия в покупаемой монете уже уменьшила проданный объём (оборот выхода) — в PnL второй раз не вычитаем.
      feesUsd += f.commission * (f.quoteQty / f.qty);
    else if (f.commission > 0) unpriced.add(f.commissionAsset);
  }
  const gross =
    input.direction === "long"
      ? exitQuote - entryQuote
      : entryQuote - exitQuote;
  return {
    entryQty,
    exitQty,
    exitPrice: exitQty > 0 ? exitQuote / exitQty : null,
    feesUsd,
    realizedPnl: exitQty > 0 ? gross - quoteFees : null,
    unpricedFees: [...unpriced],
  };
}
