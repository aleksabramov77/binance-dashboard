import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchFlexiblePositions,
  fetchFlexibleRewards,
  fetchFundingAssets,
  fetchLockedPositions,
  fetchLockedRewards,
  fetchSpotAccount,
  fetchWalletBalances,
} from "@/shared/api/binance/account.server";
import { fetchTickerPrices } from "@/shared/api/binance/public.server";
import { loadPortfolio } from "./loadPortfolio";

vi.mock("@/shared/api/binance/account.server", () => ({
  fetchSpotAccount: vi.fn(),
  fetchFundingAssets: vi.fn(),
  fetchFlexiblePositions: vi.fn(),
  fetchLockedPositions: vi.fn(),
  fetchWalletBalances: vi.fn(),
  fetchFlexibleRewards: vi.fn(),
  fetchLockedRewards: vi.fn(),
}));
vi.mock("@/shared/api/binance/public.server", () => ({
  fetchTickerPrices: vi.fn(),
}));
vi.mock("@/shared/lib/logger.server", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("loadPortfolio без ключа", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("локально — инструкция по подключению ключа", async () => {
    vi.stubEnv("VERCEL", "");
    expect(await loadPortfolio(null)).toEqual({
      status: "not-configured",
      hosting: "local",
    });
  });

  it("в облаке (VERCEL=1) — портфель только на компьютере", async () => {
    vi.stubEnv("VERCEL", "1");
    expect(await loadPortfolio(null)).toEqual({
      status: "not-configured",
      hosting: "cloud",
    });
  });
});

describe("loadPortfolio: начисления за вчера", () => {
  // Каждый тест — свои сутки: кэш наград живёт в модуле до смены окна.
  let day = 1;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 9, day++, 12)));
    vi.mocked(fetchSpotAccount).mockResolvedValue({
      balances: [{ asset: "BNB", free: 1, locked: 0 }],
    });
    vi.mocked(fetchFundingAssets).mockResolvedValue([]);
    vi.mocked(fetchWalletBalances).mockResolvedValue([]);
    vi.mocked(fetchFlexiblePositions).mockResolvedValue([
      {
        asset: "USDT",
        productId: "USDT001",
        totalAmount: 1000,
        latestAnnualPercentageRate: 0.0365,
        tierAnnualPercentageRate: null,
      },
    ]);
    vi.mocked(fetchLockedPositions).mockResolvedValue([
      {
        positionId: "11",
        projectId: "BNB*30",
        asset: "BNB",
        amount: 2,
        duration: 30,
        APY: 0.1,
      },
      {
        positionId: "12",
        projectId: "BNB*60",
        asset: "BNB",
        amount: 1,
        duration: 60,
        APY: 0.12,
      },
    ]);
    vi.mocked(fetchTickerPrices).mockResolvedValue(new Map([["BNBUSDT", 600]]));
    vi.mocked(fetchFlexibleRewards).mockResolvedValue([
      {
        asset: "USDT",
        rewards: 0.07,
        productId: "USDT001",
        type: "REALTIME",
        time: 0,
      },
      {
        asset: "USDT",
        rewards: 0.05,
        productId: "USDT001",
        type: "BONUS",
        time: 0,
      },
    ]);
    vi.mocked(fetchLockedRewards).mockResolvedValue([
      { positionId: "11", asset: "BNB", amount: 0.001, time: 0 },
    ]);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  const yesterday = async () => {
    const portfolio = await loadPortfolio({
      apiKey: "key",
      apiSecret: "secret",
    });
    if (portfolio.status !== "ok") throw new Error(portfolio.status);
    return portfolio.holdings.map((h) => [
      h.place,
      h.positionId ?? h.asset,
      h.yesterdayUsd,
    ]);
  };

  it("Flexible — сумма начислений по продукту, Locked — по позиции, без начислений — 0, Spot — null", async () => {
    const rows = await yesterday();
    expect(rows).toEqual([
      ["spot", "BNB", null],
      ["flexible", "USDT", expect.closeTo(0.12)],
      ["locked", "11", expect.closeTo(0.6)],
      ["locked", "12", 0],
    ]);
    expect(fetchFlexibleRewards).toHaveBeenCalledWith(expect.anything(), {
      startTime: Date.UTC(2026, 8, 30),
      endTime: Date.UTC(2026, 9, 1) - 1,
      type: "ALL",
    });
  });

  it("история не загрузилась — у всех строк null, портфель на месте", async () => {
    vi.mocked(fetchLockedRewards).mockRejectedValue(new Error("418"));
    const rows = await yesterday();
    expect(rows.map((r) => r[2])).toEqual([null, null, null, null]);
  });

  // Текущие сутки теста (beforeEach уже сдвинул day).
  const today = (hours: number, minutes = 0) =>
    Date.UTC(2026, 9, day - 1, hours, minutes);

  it("повторная загрузка в те же сутки историю не запрашивает", async () => {
    await yesterday();
    await yesterday();
    expect(fetchFlexibleRewards).toHaveBeenCalledTimes(1);
    expect(fetchLockedRewards).toHaveBeenCalledTimes(1);
    expect(fetchSpotAccount).toHaveBeenCalledTimes(2);
  });

  it("после дозревания (≥ 6 ч UTC) кэш держится до полуночи", async () => {
    vi.setSystemTime(today(6));
    await yesterday();
    vi.setSystemTime(today(23, 59));
    await yesterday();
    expect(fetchFlexibleRewards).toHaveBeenCalledTimes(1);
  });

  it("первые 6 ч UTC ответ дозревает — кэш 15 минут", async () => {
    vi.setSystemTime(today(2));
    await yesterday();
    vi.setSystemTime(today(2, 14));
    await yesterday();
    expect(fetchFlexibleRewards).toHaveBeenCalledTimes(1);
    vi.setSystemTime(today(2, 15));
    await yesterday();
    expect(fetchFlexibleRewards).toHaveBeenCalledTimes(2);
  });

  it("после сбоя истории следующая загрузка пробует снова", async () => {
    vi.mocked(fetchFlexibleRewards).mockRejectedValueOnce(new Error("429"));
    await yesterday();
    const rows = await yesterday();
    expect(fetchFlexibleRewards).toHaveBeenCalledTimes(2);
    expect(rows[1]?.[2]).toBeCloseTo(0.12);
  });
});
