/** «$10,05», «−$15,20», «+$0,84» — деньги для журнала и Telegram (без локали процесса). */
export function liveUsd(v: number, signed = false): string {
  const abs = `$${Math.abs(v).toFixed(2).replace(".", ",")}`;
  if (v < 0) return `−${abs}`;
  return signed && v > 0 ? `+${abs}` : abs;
}

const price = new Intl.NumberFormat("ru-RU", { maximumSignificantDigits: 6 });

/**
 * Цена для журнала и Telegram (spec 0068, AC2): 6 значащих цифр в русском формате — без хвостов float
 * (80.02897007822772 → «80,029»). Шаг цены биржи приложению не известен, а 6 цифр его покрывают у всех монет.
 */
export const livePrice = (v: number): string => price.format(v);
