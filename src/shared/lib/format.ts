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

/** Изменение в процентных пунктах: +0,52 п.п. */
export function formatPpDelta(delta: number): string {
  const pp = (delta * 100).toFixed(2).replace(".", ",");
  return `${delta > 0 ? "+" : ""}${pp} п.п.`;
}
