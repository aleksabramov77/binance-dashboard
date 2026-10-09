import type { Setup } from "@/entities/market-signal";

export const ANALYSIS_SYSTEM_PROMPT = `Ты — скептичный риск-менеджер криптотрейдера. Тебе дают сетап, найденный простыми правилами
(сильное движение за 24 ч + экстремальный RSI + отрыв от EMA50), с уровнями входа, стопа и целей.

Задача — честно оценить сетап только по переданным данным:
- аргументы «за» и «против» (конкретно, с опорой на числа);
- главные риски: ловля падающего ножа / шорт против сильного импульса, ширина стопа, ликвидность,
  достижимость целей, перегретость старшего таймфрейма (RSI 4h);
- условие отмены идеи — что должно произойти, чтобы не входить или выйти раньше стопа;
- вердикт: take (входить по плану), wait (ждать подтверждения), skip (пропустить);
- confidence — уверенность в вердикте от 0 до 100. Не завышай: это эвристика, а не прогноз.

У тебя нет новостей и стакана — не выдумывай их и не ссылайся на них.
Пиши по-русски, коротко: 1–3 пункта в каждом списке, summary — 1–2 предложения.`;

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const rel = (price: number, entry: number) => pct((price - entry) / entry);

/** Данные сетапа в компактном виде для модели. */
export function buildAnalysisPrompt(setup: Setup): string {
  const ind = setup.indicators;
  return [
    `Инструмент: ${setup.symbol} (${setup.market === "spot" ? "Spot" : "USDⓈ-M фьючерс"})`,
    `Направление: ${setup.direction === "long" ? "LONG" : "SHORT"}; тип: ${setup.kind}; статус правил: ${setup.status === "ready" ? "есть разворотная свеча 1h" : "разворотной свечи ещё нет"}`,
    `Изменение за 24 ч: ${pct(setup.change24h)}; оборот за 24 ч: $${Math.round(setup.quoteVolumeUsd / 1e6)} млн`,
    `Вход (рынок): ${setup.entry}`,
    `Stop Loss: ${setup.stopLoss} (${rel(setup.stopLoss, setup.entry)})`,
    `Take Profit 1 (EMA20): ${setup.takeProfit1} (${rel(setup.takeProfit1, setup.entry)})`,
    `Take Profit 2 (EMA50): ${setup.takeProfit2} (${rel(setup.takeProfit2, setup.entry)})`,
    `R:R до TP1: ${setup.rr.toFixed(2)}; сила сигнала по правилам: ${Math.round(setup.strength * 100)}%`,
    `RSI 1h: ${ind.rsi1h.toFixed(1)}; RSI 4h: ${ind.rsi4h.toFixed(1)}`,
    `ATR 1h: ${ind.atr1h} (${rel(setup.entry + ind.atr1h, setup.entry)} от цены)`,
    `EMA20: ${ind.ema20}; EMA50: ${ind.ema50}; цена от EMA50: ${ind.distanceAtr.toFixed(2)} ATR`,
    `Объём последних 3 ч к среднему за сутки: ×${ind.volumeRatio.toFixed(2)}`,
  ].join("\n");
}

/** JSON Schema ответа (strict): та же форма, что setupAnalysisSchema. */
export const ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "verdict",
    "confidence",
    "summary",
    "pros",
    "cons",
    "invalidation",
  ],
  properties: {
    verdict: { type: "string", enum: ["take", "wait", "skip"] },
    confidence: { type: "number", description: "0–100" },
    summary: { type: "string" },
    pros: { type: "array", items: { type: "string" } },
    cons: { type: "array", items: { type: "string" } },
    invalidation: { type: "string" },
  },
} as const;
