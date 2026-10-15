import { describe, expect, it, vi } from "vitest";
import { createKeyedCache } from "./keyedCache";

describe("createKeyedCache", () => {
  it("тот же ключ — одна загрузка, в том числе для параллельных вызовов", async () => {
    const cache = createKeyedCache<number, string>();
    const load = vi.fn(async () => "a");
    const [a, b] = await Promise.all([cache.get(1, load), cache.get(1, load)]);
    expect([a, b, await cache.get(1, load)]).toEqual(["a", "a", "a"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("новый ключ — загружает заново", async () => {
    const cache = createKeyedCache<number, string>();
    await cache.get(1, async () => "a");
    expect(await cache.get(2, async () => "b")).toBe("b");
  });

  it("срок истёк — загружает заново, до срока — отдаёт кэш", async () => {
    const cache = createKeyedCache<number, string>();
    await cache.get(1, async () => "a", { now: 0, ttlMs: 1000 });
    expect(await cache.get(1, async () => "b", { now: 999 })).toBe("a");
    expect(await cache.get(1, async () => "c", { now: 1000 })).toBe("c");
  });

  it("ошибка не кэшируется — следующий вызов загружает снова", async () => {
    const cache = createKeyedCache<number, string>();
    await expect(
      cache.get(1, async () => {
        throw new Error("429");
      }),
    ).rejects.toThrow("429");
    expect(await cache.get(1, async () => "a")).toBe("a");
  });
});
