import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  CooldownError,
  getJsonWithRetry,
  resetBinanceCooldowns,
} from "@/shared/lib/fetchRetry";
import { BinanceApiError, signedRequest } from "./signed";

const API = "https://api.binance.com";
const DEMO = "https://demo-api.binance.com";
const creds = { apiKey: "key", apiSecret: "secret" };
const T0 = Date.parse("2026-10-15T10:00:00Z");

const reply = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) => new Response(JSON.stringify(body), { status, headers });

const read = (baseUrl = API, method: "GET" | "POST" = "GET") =>
  signedRequest(
    baseUrl,
    creds,
    method,
    "/sapi/v1/simple-earn/flexible/history/rewardsRecord",
    z.object({ total: z.number() }),
  );

describe("signedRequest: пауза после 429/418 (0014, 0022)", () => {
  beforeEach(() => {
    resetBinanceCooldowns();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetBinanceCooldowns();
  });

  it("429 ставит паузу по Retry-After: до её конца подписанные запросы к хосту не отправляются", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        reply(
          429,
          { code: -1003, msg: "Too much request weight used" },
          { "Retry-After": "30" },
        ),
      )
      .mockImplementation(async () => reply(200, { total: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(read()).rejects.toBeInstanceOf(BinanceApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(T0 + 29_000);
    await expect(read()).rejects.toBeInstanceOf(CooldownError);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(T0 + 30_000);
    await expect(read()).resolves.toEqual({ total: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("бан 418 из подписанного запроса останавливает и публичные запросы к тому же хосту", async () => {
    const bannedUntil = T0 + 5 * 60_000;
    const fetchMock = vi.fn().mockResolvedValueOnce(
      reply(418, {
        code: -1003,
        msg: `Way too much request weight used; IP banned until ${bannedUntil}.`,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(read()).rejects.toBeInstanceOf(BinanceApiError);
    vi.setSystemTime(bannedUntil - 1000);
    await expect(
      getJsonWithRetry(`${API}/api/v3/ticker/price`, "Binance"),
    ).rejects.toBeInstanceOf(CooldownError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("пауза, поставленная публичным запросом, не пускает подписанный — в том числе ордер", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(reply(429, {}, { "Retry-After": "60" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getJsonWithRetry(`${DEMO}/api/v3/ticker/price`, "Binance"),
    ).rejects.toThrow();
    await expect(read(DEMO, "POST")).rejects.toBeInstanceOf(CooldownError);
    await expect(read(DEMO)).rejects.toBeInstanceOf(CooldownError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("пауза одного хоста не мешает другому; ошибки кроме 429/418 паузу не ставят", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(400, { code: -1102, msg: "Mandatory" }))
      .mockImplementation(async () => reply(200, { total: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(read()).rejects.toBeInstanceOf(BinanceApiError);
    await expect(read()).resolves.toEqual({ total: 1 });
    await expect(read(DEMO)).resolves.toEqual({ total: 1 });
  });
});
