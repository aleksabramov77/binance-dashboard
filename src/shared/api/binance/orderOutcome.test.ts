import { describe, expect, it } from "vitest";
import { NetworkError } from "@/shared/lib/fetchRetry";
import {
  nextRecheckDelay,
  ORDER_RECV_WINDOW_MS,
  orderErrorOutcome,
  UNKNOWN_MIN_WAIT_MS,
  UNKNOWN_OUTCOME_CODES,
  unknownOutcomeDeadline,
} from "./orderOutcome";
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

describe("ожидание при неизвестном исходе", () => {
  it("дедлайн — отправка + recvWindow + запас на часы, но не меньше паузы после ответа", () => {
    // Обрыв сети сразу после отправки: ждём, пока истечёт окно заявки.
    expect(unknownOutcomeDeadline(0, 200)).toBe(ORDER_RECV_WINDOW_MS + 1500);
    // -1007 через 10 с: окно уже прошло, но движок мог исполнить заявку чуть позже ответа.
    expect(unknownOutcomeDeadline(0, 10_000)).toBe(
      10_000 + UNKNOWN_MIN_WAIT_MS,
    );
  });

  it("проверки раз в секунду, последняя — начата после дедлайна", () => {
    const deadline = 6500;
    expect(nextRecheckDelay(300, deadline, 200)).toBe(1000);
    expect(nextRecheckDelay(6000, deadline, 5900)).toBe(501);
    // Проверка начата в 6501 — после дедлайна: её ответ окончательный.
    expect(nextRecheckDelay(6700, deadline, 6501)).toBeNull();
    // Проверка, начатая до дедлайна, но закончившаяся после, не окончательна.
    expect(nextRecheckDelay(6700, deadline, 6400)).toBe(1);
  });
});
