import { describe, expect, it, vi } from "vitest";
import { HttpError, NetworkError, withRetry } from "./fetchRetry";

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
