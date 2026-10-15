import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CooldownError,
  getJsonWithRetry,
  HttpError,
  NetworkError,
  resetBinanceCooldowns,
  withRetry,
} from "./fetchRetry";
import { log } from "./logger.server";

const socketError = () =>
  Object.assign(new TypeError("fetch failed"), {
    cause: { code: "UND_ERR_SOCKET", message: "other side closed" },
  });

describe("withRetry", () => {
  it("повторяет при сетевом сбое и возвращает первый успешный ответ", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(socketError())
      .mockRejectedValueOnce(new SyntaxError("Unterminated string in JSON"))
      .mockResolvedValue("ok");
    await expect(withRetry("Binance", run, [0, 0, 0])).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("после всех попыток сообщает настоящую причину", async () => {
    const run = vi.fn().mockRejectedValue(socketError());
    const error = (await withRetry("Binance Demo", run, [0, 0]).catch(
      (e: unknown) => e,
    )) as Error;
    expect(error).toBeInstanceOf(NetworkError);
    expect(error.message).toBe(
      "Binance Demo: сеть не ответила — fetch failed (UND_ERR_SOCKET: other side closed)",
    );
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("не повторяет ответы сервера с ошибкой", async () => {
    const run = vi.fn().mockRejectedValue(new HttpError("400", 400));
    await expect(withRetry("x", run, [0, 0])).rejects.toBeInstanceOf(HttpError);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("getJsonWithRetry: пауза после 429/418 (0014)", () => {
  const SPOT = "https://api.binance.com/api/v3/ticker/price";
  const FUTURES = "https://fapi.binance.com/fapi/v1/ticker/price";
  const DEMO = "https://demo-fapi.binance.com/fapi/v1/ticker/price";
  const T0 = Date.parse("2026-10-14T18:31:01Z");

  const reply = (
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) => new Response(JSON.stringify(body), { status, headers });

  beforeEach(() => {
    resetBinanceCooldowns();
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("после 418 не ходит на тот же хост до конца бана, после — ходит", async () => {
    const bannedUntil = T0 + 4 * 60_000;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        reply(418, {
          code: -1003,
          msg: `Way too much request weight used; IP banned until ${bannedUntil}. Please use WebSocket Streams for live updates to avoid bans.`,
        }),
      )
      .mockImplementation(async () => reply(200, []));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getJsonWithRetry(SPOT, "Binance")).rejects.toBeInstanceOf(
      HttpError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(bannedUntil - 1000);
    const error = (await getJsonWithRetry(SPOT, "Binance").catch(
      (e: unknown) => e,
    )) as HttpError;
    expect(error).toBeInstanceOf(HttpError);
    expect(error.message).toBe(
      "Binance: пауза до 18:35:01 UTC после ответа 418",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(bannedUntil);
    await expect(getJsonWithRetry(SPOT, "Binance")).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("после 429 ждёт Retry-After, без него — 60 с", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        reply(429, { code: -1003 }, { "Retry-After": "30" }),
      )
      .mockResolvedValueOnce(reply(429, { code: -1003 }))
      .mockImplementation(async () => reply(200, []));
    vi.stubGlobal("fetch", fetchMock);

    await getJsonWithRetry(SPOT, "Binance").catch(() => {});
    vi.setSystemTime(T0 + 29_000);
    await getJsonWithRetry(SPOT, "Binance").catch(() => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(T0 + 30_000);
    await getJsonWithRetry(SPOT, "Binance").catch(() => {});
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.setSystemTime(T0 + 30_000 + 59_000);
    await getJsonWithRetry(SPOT, "Binance").catch(() => {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.setSystemTime(T0 + 30_000 + 60_000);
    await expect(getJsonWithRetry(SPOT, "Binance")).resolves.toEqual([]);
  });

  it("пауза одного хоста не блокирует другой", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(429, { code: -1003 }))
      .mockImplementation(async () => reply(200, []));
    vi.stubGlobal("fetch", fetchMock);

    await getJsonWithRetry(SPOT, "Binance").catch(() => {});
    await expect(getJsonWithRetry(FUTURES, "Binance")).resolves.toEqual([]);
    await expect(getJsonWithRetry(DEMO, "Binance Demo")).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("параллельные 429/418: пауза не сокращается, в журнале одна запись", async () => {
    const warn = vi.spyOn(log, "warn");
    const bannedUntil = T0 + 4 * 60_000;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        reply(418, { code: -1003, msg: `IP banned until ${bannedUntil}.` }),
      )
      .mockResolvedValueOnce(reply(429, { code: -1003 }))
      .mockImplementation(async () => reply(200, []));
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([
      getJsonWithRetry(SPOT, "Binance").catch(() => {}),
      getJsonWithRetry(SPOT, "Binance").catch(() => {}),
    ]);
    expect(
      warn.mock.calls.filter(([event]) => event === "binance.cooldown"),
    ).toHaveLength(1);

    vi.setSystemTime(T0 + 2 * 60_000);
    const error = await getJsonWithRetry(SPOT, "Binance").catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CooldownError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("другие ошибки (400, 500) паузу не ставят", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(500, null))
      .mockImplementation(async () => reply(200, []));
    vi.stubGlobal("fetch", fetchMock);

    await getJsonWithRetry(SPOT, "Binance").catch(() => {});
    await expect(getJsonWithRetry(SPOT, "Binance")).resolves.toEqual([]);
  });
});
