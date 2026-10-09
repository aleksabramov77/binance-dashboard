import type { Setup, SetupRecheck } from "@/entities/market-signal";
import type { RuleCheck } from "./detectSetup";

/** Сдвиг уровня больше этого — показываем как изменение. */
const LEVEL_CHANGE = 0.005;

const fmt = (v: number) => String(Number(v.toPrecision(6)));
const moved = (a: number, b: number) => Math.abs(b - a) / a > LEVEL_CHANGE;

/**
 * Сравнивает исходный сетап со свежим пересчётом и решает, актуален ли вход.
 * stale — правила больше не выполняются или цена уже пробила стоп / дошла до цели.
 */
export function evaluateRecheck(
  original: Setup,
  price: number,
  fresh: Setup | null,
  checks: RuleCheck[],
  checkedAt: string,
): SetupRecheck {
  const isLong = original.direction === "long";
  const notes: string[] = [];

  const pastStop = isLong
    ? price <= original.stopLoss
    : price >= original.stopLoss;
  const pastTarget = isLong
    ? price >= original.takeProfit1
    : price <= original.takeProfit1;
  if (pastStop)
    notes.push(
      `Цена ${fmt(price)} уже за исходным стопом ${fmt(original.stopLoss)}.`,
    );
  if (pastTarget)
    notes.push(
      `Цена ${fmt(price)} уже дошла до цели TP1 ${fmt(original.takeProfit1)} — вход поздний.`,
    );

  const usable = fresh && fresh.direction === original.direction ? fresh : null;
  if (!usable) {
    notes.push("Условия сетапа больше не выполняются:");
    for (const c of checks.filter((c) => !c.ok)) notes.push(`✗ ${c.label}`);
  }
  if (pastStop || pastTarget || !usable) {
    return { checkedAt, status: "stale", price, fresh: usable, notes };
  }

  const levels: [string, number, number][] = [
    ["Вход", original.entry, usable.entry],
    ["Stop Loss", original.stopLoss, usable.stopLoss],
    ["Take Profit 1", original.takeProfit1, usable.takeProfit1],
    ["Take Profit 2", original.takeProfit2, usable.takeProfit2],
  ];
  for (const [label, before, after] of levels) {
    if (moved(before, after))
      notes.push(`${label}: ${fmt(before)} → ${fmt(after)}`);
  }
  if (original.status === "ready" && usable.status === "watch")
    notes.push("Разворотная свеча пропала — надёжнее дождаться новой.");
  if (original.status === "watch" && usable.status === "ready")
    notes.push("Появилась разворотная свеча — сигнал подтвердился.");

  return {
    checkedAt,
    status: notes.length > 0 ? "changed" : "actual",
    price,
    fresh: usable,
    notes,
  };
}
