const percent = new Intl.NumberFormat("ru-RU", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const usd = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usdPrecise = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const amount = new Intl.NumberFormat("ru-RU", { maximumSignificantDigits: 6 });
const dateTime = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatPercent = (value: number) => percent.format(value);
export const formatUsd = (value: number) =>
  (Math.abs(value) < 100 ? usdPrecise : usd).format(value);
export const formatAmount = (value: number) => amount.format(value);
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

const price = new Intl.NumberFormat("ru-RU", { maximumSignificantDigits: 5 });
/** Цена с 5 значащими цифрами: 82 520, 1,2345, 0,000012345. */
export const formatPrice = (value: number) => price.format(value);

/** Изменение в процентных пунктах: +0,52 п.п. */
export function formatPpDelta(delta: number): string {
  const pp = (delta * 100).toFixed(2).replace(".", ",");
  return `${delta > 0 ? "+" : ""}${pp} п.п.`;
}

/** Число со словом в нужной форме: 1 сделка, 2 сделки, 5 сделок (11–14 — «сделок»). */
export function pluralRu(
  n: number,
  [one, few, many]: readonly [one: string, few: string, many: string],
): string {
  const d10 = Math.abs(n) % 10;
  const d100 = Math.abs(n) % 100;
  if (d10 === 1 && d100 !== 11) return `${n} ${one}`;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}
