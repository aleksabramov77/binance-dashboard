// Вход на споте (spec 0012, AC4): покупка и защита одной составной заявкой OTOCO/OTO.

/** Лимитная цена покупки выше текущей на эту долю — чтобы LIMIT FOK исполнился сразу, как рыночный. */
export const SPOT_ENTRY_SLIPPAGE = 0.005;

/**
 * Комиссия покупки на демо-споте — 0,1% (taker), удерживается в покупаемой монете (BNB на счёте
 * нет; проверено 2026-10-15: 40 BAT → комиссия 0,04 BAT). На столько меньше можно продать стопом.
 */
export const SPOT_TAKER_FEE = 0.001;

/** Доля → текст для сообщений: 0.001 → «0,1%». */
const pctText = (rate: number) =>
  `${String(Math.round(rate * 100 * 1000) / 1000).replace(".", ",")}%`;

/** Ставки для текстов ошибок и итогов — из тех же констант, чтобы не разошлись. */
export const SPOT_TAKER_FEE_TEXT = pctText(SPOT_TAKER_FEE);
export const SPOT_ENTRY_SLIPPAGE_TEXT = pctText(SPOT_ENTRY_SLIPPAGE);
