import { describe, expect, it } from "vitest";
import { formatPair, splitSymbol } from "./symbol";

describe("splitSymbol / formatPair", () => {
  it("делит по известной котируемой валюте", () => {
    expect(splitSymbol("BATUSDT")).toEqual({ base: "BAT", quote: "USDT" });
    expect(splitSymbol("BTCUSDC")).toEqual({ base: "BTC", quote: "USDC" });
    expect(formatPair("MAGICUSDT")).toBe("MAGIC-USDT");
  });

  it("кросс-пары к BTC/ETH/BNB", () => {
    expect(splitSymbol("ETHBTC")).toEqual({ base: "ETH", quote: "BTC" });
    expect(formatPair("SOLBNB")).toBe("SOL-BNB");
  });

  it("неизвестная котируемая — символ как есть", () => {
    expect(splitSymbol("ABCXYZ")).toEqual({ base: "ABCXYZ", quote: "" });
    expect(formatPair("ABCXYZ")).toBe("ABCXYZ");
  });
});
