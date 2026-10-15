import { describe, expect, it, vi } from "vitest";
import {
  getJsonWithRetry,
  HttpError,
  NetworkError,
  REQUEST_TIMEOUT_MS,
  withRetry,
} from "./fetchRetry";

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

  it("таймаут запроса (AbortSignal.timeout) — сетевой сбой, повторяется", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(
        new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        ),
      )
      .mockResolvedValue("ok");
    await expect(withRetry("Binance", run, [0])).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("getJsonWithRetry", () => {
  it("каждый запрос — с таймаутом больше 10 с Binance (-1007 важнее обрыва)", async () => {
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(10_000);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(getJsonWithRetry("https://x.test", "x")).resolves.toEqual({
        ok: true,
      });
      expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
