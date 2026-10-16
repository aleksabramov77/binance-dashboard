import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTickerPrices } from "@/shared/api/binance/public.server";
import {
  cachedTickerPrices,
  clearTickerPricesCache,
  PRICES_TTL_MS,
} from "./tickerPrices";

vi.mock("@/shared/api/binance/public.server", () => ({
  fetchTickerPrices: vi.fn(),
}));

beforeEach(() => {
  clearTickerPricesCache();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T10:00:00Z"));
  vi.mocked(fetchTickerPrices).mockResolvedValue(new Map([["BTCUSDT", 1]]));
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("cachedTickerPrices", () => {
  it("повтор в пределах 20 с не идёт на биржу — бюджеты и Demo делят один запрос", async () => {
    const first = await cachedTickerPrices("spot");
    vi.setSystemTime(Date.now() + PRICES_TTL_MS - 1);
    expect(await cachedTickerPrices("spot")).toBe(first);
    expect(fetchTickerPrices).toHaveBeenCalledTimes(1);
  });

  it("после 20 с и для другого рынка — новый запрос", async () => {
    await cachedTickerPrices("spot");
    await cachedTickerPrices("usdm");
    expect(fetchTickerPrices).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + PRICES_TTL_MS);
    await cachedTickerPrices("spot");
    expect(fetchTickerPrices).toHaveBeenCalledTimes(3);
  });

  it("ошибка не кэшируется", async () => {
    vi.mocked(fetchTickerPrices).mockRejectedValueOnce(new Error("сеть"));
    await expect(cachedTickerPrices("spot")).rejects.toThrow("сеть");
    await cachedTickerPrices("spot");
    expect(fetchTickerPrices).toHaveBeenCalledTimes(2);
  });
});
