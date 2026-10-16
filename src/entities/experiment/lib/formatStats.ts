import { formatUsd, pluralRu } from "@/shared/lib";

// Подписи метрик для таблиц лаборатории. null — метрики ещё нет (нет закрытых сделок).

const decimal2 = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const percent1 = new Intl.NumberFormat("ru-RU", {
  style: "percent",
  maximumFractionDigits: 1,
});

/** PnL со знаком: +12,50 $, −3 $. */
export const formatSignedUsd = (v: number) =>
  `${v > 0 ? "+" : ""}${formatUsd(v)}`;

/** Доля в процентах; то, что округляется до 0,0 %, — «0 %» без минуса (иначе Max DD 0 → «-0 %»). */
export const formatRate = (v: number | null) =>
  v === null ? "—" : percent1.format(Math.abs(v) < 0.0005 ? 0 : v);

/** Profit factor: без убыточных сделок, но с прибылью — ∞. */
export const formatProfitFactor = (
  pf: number | null,
  grossProfit: number,
): string =>
  pf === null ? (grossProfit > 0 ? "∞" : "—") : decimal2.format(pf);

export const formatR = (r: number | null) =>
  r === null ? "—" : `${r > 0 ? "+" : ""}${decimal2.format(r)} R`;

/** Класс цвета для PnL: зелёный, красный или нейтральный. */
export const pnlTone = (v: number | null) =>
  v === null || v === 0
    ? "text-muted-foreground"
    : v > 0
      ? "text-positive"
      : "text-destructive";

/** «у 1 сделки», «у 3 сделок». */
const DEALS_GEN = ["сделки", "сделок", "сделок"] as const;

/**
 * Подсказка к «≈» у Real PnL (spec 0054): сколько закрытых реальных сделок посчитано оценкой по ценам и сколько без
 * PnL. null — всё по исполнениям, «≈» не нужен.
 */
export function liveEstimateHint(live: {
  estimated: number;
  unknown: number;
}): string | null {
  const parts = [
    live.estimated > 0 &&
      `у ${pluralRu(live.estimated, DEALS_GEN)} PnL — оценка по ценам входа и выхода (исполнения не прочитаны)`,
    live.unknown > 0 &&
      `у ${pluralRu(live.unknown, DEALS_GEN)} PnL неизвестен — в сумму не входит`,
  ].filter((p) => p !== false);
  return parts.length ? `Приблизительно: ${parts.join("; ")}.` : null;
}
