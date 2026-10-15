import { describe, expect, it } from "vitest";
import { type Setup, setupAnalysisSchema } from "@/entities/market-signal";
import { buildAnalysisPrompt } from "./buildPrompt";

const setup: Setup = {
  id: "KAIAUSDT:short",
  symbol: "KAIAUSDT",
  base: "KAIA",
  kind: "overheat-short",
  direction: "short",
  market: "usdm",
  status: "watch",
  entry: 0.05,
  stopLoss: 0.055,
  takeProfit1: 0.04,
  takeProfit2: 0.035,
  rr: 2,
  strength: 0.9,
  reasons: [],
  change24h: 0.45,
  quoteVolumeUsd: 218e6,
  indicators: {
    rsi1h: 92,
    rsi4h: 85,
    atr1h: 0.002,
    ema20: 0.04,
    ema50: 0.035,
    volumeRatio: 31,
    distanceAtr: 6.8,
  },
};

describe("buildAnalysisPrompt", () => {
  it("передаёт модели уровни с расстоянием от входа и индикаторы", () => {
    const prompt = buildAnalysisPrompt(setup);
    expect(prompt).toContain("KAIAUSDT (USDⓈ-M фьючерс)");
    expect(prompt).toContain("Stop Loss: 0.055 (10.00%)");
    expect(prompt).toContain("Take Profit 1 (EMA20): 0.04 (-20.00%)");
    expect(prompt).toContain("RSI 1h: 92.0; RSI 4h: 85.0");
    expect(prompt).toContain("оборот за 24 ч: $218 млн");
  });
});

describe("setupAnalysisSchema", () => {
  it("зажимает уверенность модели в диапазон 0–100", () => {
    const parsed = setupAnalysisSchema.parse({
      verdict: "wait",
      confidence: 140,
      summary: "",
      pros: [],
      cons: [],
      invalidation: "",
    });
    expect(parsed.confidence).toBe(100);
  });
});
