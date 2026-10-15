import { describe, expect, it, vi } from "vitest";
import { createTtlCache } from "./ttlCache";

describe("кэш каталога в памяти", () => {
  it("отдаёт свежее значение без загрузки и перезагружает после срока", async () => {
    const cache = createTtlCache<number>(1_000);
    const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    expect(await cache.get(load, 0)).toBe(1);
    expect(await cache.get(load, 999)).toBe(1);
    expect(await cache.get(load, 1_000)).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("параллельные вызовы ждут одну загрузку; отвергнутое keep не кэшируется", async () => {
    const cache = createTtlCache<string>(1_000, (v) => v === "ok");
    const load = vi.fn().mockResolvedValue("error");
    await Promise.all([cache.get(load, 0), cache.get(load, 0)]);
    expect(load).toHaveBeenCalledTimes(1);
    await cache.get(load, 1);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
