import { describe, expect, it } from "vitest";
import { NetworkError } from "@/shared/lib/fetchRetry";
import { orderErrorOutcome, UNKNOWN_OUTCOME_CODES } from "./orderOutcome";
import { BinanceApiError, ResponseFormatError } from "./signed";

describe("orderErrorOutcome", () => {
  it("явный отказ биржи (4xx с кодом) — ордера точно нет", () => {
    expect(
      orderErrorOutcome(
        new BinanceApiError("Filter failure: NOTIONAL", -1013, 400),
      ),
    ).toBe("rejected");
    expect(
      orderErrorOutcome(
        new BinanceApiError("Account has insufficient balance", -2010, 400),
      ),
    ).toBe("rejected");
  });

  it("-1006 и -1007 — исход неизвестен, даже с HTTP 4xx", () => {
    expect(UNKNOWN_OUTCOME_CODES).toEqual([-1006, -1007]);
    expect(
      orderErrorOutcome(
        new BinanceApiError(
          "Timeout waiting for response from backend server. Send status unknown; execution status unknown.",
          -1007,
          408,
        ),
      ),
    ).toBe("unknown");
    expect(
      orderErrorOutcome(new BinanceApiError("Unexpected", -1006, 400)),
    ).toBe("unknown");
  });

  it("HTTP 5xx — исход неизвестен, с кодом и без", () => {
    expect(
      orderErrorOutcome(new BinanceApiError("Unknown error", -1000, 503)),
    ).toBe("unknown");
    expect(
      orderErrorOutcome(
        new BinanceApiError("Binance ответил 502", undefined, 502),
      ),
    ).toBe("unknown");
  });

  it("обрыв сети и нераспознанный ответ — исход неизвестен", () => {
    expect(orderErrorOutcome(new NetworkError("fetch failed"))).toBe("unknown");
    expect(
      orderErrorOutcome(new ResponseFormatError("не распознан", 200, {})),
    ).toBe("unknown");
    expect(orderErrorOutcome("что-то странное")).toBe("unknown");
  });
});
