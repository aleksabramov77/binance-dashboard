import { describe, expect, it } from "vitest";
import { redact } from "./logger.server";

describe("redact", () => {
  it("маскирует секреты по имени поля и в URL", () => {
    expect(
      redact({
        apiKey: "abc",
        BINANCE_API_SECRET: "s",
        nested: { Authorization: "Bearer x", symbol: "BTCUSDT" },
        url: "https://api.binance.com/api/v3/order?symbol=BTCUSDT&timestamp=1&signature=deadbeef",
      }),
    ).toEqual({
      apiKey: "***",
      BINANCE_API_SECRET: "***",
      nested: { Authorization: "***", symbol: "BTCUSDT" },
      url: "https://api.binance.com/api/v3/order?symbol=BTCUSDT&timestamp=1&signature=***",
    });
  });
});
