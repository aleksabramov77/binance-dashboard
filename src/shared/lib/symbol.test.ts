import { describe, expect, it } from "vitest";
import { formatPair, splitSymbol } from "./symbol";

describe("splitSymbol / formatPair", () => {
  it("делит по известной котируемой валюте", () => {
    expect(splitSymbol("BATUSDT")).toEqual({ base: "BAT", quote: "USDT" });
    expect(splitSymbol("BTCUSDC")).toEqual({ base: "BTC", quote: "USDC" });
    expect(formatPair("MAGICUSDT")).toBe("MAGIC-USDT");
  });

  it("неизвестная котируемая — символ как есть", () => {
    expect(splitSymbol("ETHBTC")).toEqual({ base: "ETHBTC", quote: "" });
    expect(formatPair("ETHBTC")).toBe("ETHBTC");
  });
});
