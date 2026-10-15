import type { SignedParams } from "./signed";

// Режим позиций USDⓈ-M Futures (spec 0012, PR 2c): One-way — одна позиция на символ (positionSide BOTH),
// Hedge — лонг и шорт раздельно (LONG / SHORT). Переключается только при пустом счёте (нет позиций и
// ордеров, -4067/-4068), поэтому код работает в обоих режимах. Чистые параметры ордеров — здесь.

export type PositionMode = "oneway" | "hedge";

/** Чья позиция: режим счёта и сторона сделки. */
export interface FuturesSide {
  mode: PositionMode;
  direction: "long" | "short";
}

export const positionSideOf = (s: FuturesSide): "LONG" | "SHORT" | "BOTH" =>
  s.mode === "hedge" ? (s.direction === "long" ? "LONG" : "SHORT") : "BOTH";

/** Вход: в Hedge positionSide обязателен; в One-way его не передаём (по умолчанию BOTH). */
export const entryParams = (s: FuturesSide): SignedParams =>
  s.mode === "hedge" ? { positionSide: positionSideOf(s) } : {};

/**
 * Уменьшение своей позиции: One-way — reduceOnly (не откроет встречную); Hedge — positionSide,
 * reduceOnly там не передаётся (биржа отклоняет).
 */
export const reduceParams = (s: FuturesSide): SignedParams =>
  s.mode === "hedge"
    ? { positionSide: positionSideOf(s) }
    : { reduceOnly: true };

/**
 * Защитный algo-ордер (STOP_MARKET / TAKE_PROFIT_MARKET) на свой объём, без closePosition: у каждого
 * зеркала свой TP/SL, сработавший не закрывает чужой объём.
 */
export const protectParams = (
  s: FuturesSide,
  quantity: string,
): SignedParams => ({
  quantity,
  ...reduceParams(s),
});
