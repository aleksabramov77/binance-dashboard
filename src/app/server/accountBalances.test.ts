import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWalletBalances } from "@/shared/api/binance/account.server";
import { fetchDemoEquity } from "@/shared/api/binance/demo.server";
import { fetchTickerPrices } from "@/shared/api/binance/public.server";
import { CooldownError } from "@/shared/lib/fetchRetry";
import {
  BALANCES_TTL_MS,
  clearAccountBalancesCache,
  getAccountBalances,
} from "./accountBalances";
import { clearTickerPricesCache } from "./tickerPrices";

vi.mock("@/shared/api/binance/account.server", () => ({
  fetchWalletBalances: vi.fn(),
}));
vi.mock("@/shared/api/binance/demo.server", () => ({
  fetchDemoEquity: vi.fn(),
}));
vi.mock("@/shared/api/binance/public.server", () => ({
  fetchTickerPrices: vi.fn(),
}));
vi.mock("@/shared/lib/logger.server", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const withKeys = () => {
  vi.stubEnv("BINANCE_API_KEY", "key");
  vi.stubEnv("BINANCE_API_SECRET", "secret");
  vi.stubEnv("BINANCE_DEMO_API_KEY", "demo-key");
  vi.stubEnv("BINANCE_DEMO_API_SECRET", "demo-secret");
};

beforeEach(() => {
  clearAccountBalancesCache();
  clearTickerPricesCache();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T10:00:00Z"));
  vi.mocked(fetchTickerPrices).mockResolvedValue(new Map([["BTCUSDT", 1]]));
  vi.mocked(fetchDemoEquity).mockResolvedValue({
    spot: { ok: true, usd: 10_000, unpriced: [] },
    usdm: { ok: true, usd: 5_000, unpriced: ["SNDKB"] },
    coinm: { ok: false, error: new Error("Binance: Invalid API-key (-2015)") },
  });
  vi.mocked(fetchWalletBalances).mockResolvedValue([
    { walletName: "Spot", balance: 120, activate: true },
    { walletName: "USDⓈ-M Futures", balance: 0, activate: true },
    { walletName: "COIN-M Futures", balance: 3, activate: true },
  ]);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("getAccountBalances", () => {
  it("Demo — equity по кошелькам, Real — wallet balance; ошибки и активы без цены — в подсказке", async () => {
    withKeys();
    const r = await getAccountBalances();
    expect(r.demo).toEqual({
      spot: { usd: 10_000, hint: null },
      usdm: { usd: 5_000, hint: "Без цены в $, не учтены: SNDKB" },
      coinm: { usd: null, hint: "Ошибка: Binance: Invalid API-key (-2015)" },
    });
    expect(r.real).toEqual({
      spot: { usd: 120, hint: null },
      usdm: { usd: 0, hint: null },
      coinm: { usd: 3, hint: null },
    });
  });

  it("без ключей — «—» с подсказкой и без запросов к бирже", async () => {
    vi.stubEnv("BINANCE_API_KEY", "");
    vi.stubEnv("BINANCE_DEMO_API_KEY", "");
    const r = await getAccountBalances();
    expect(r.demo.spot).toEqual({
      usd: null,
      hint: "Ключ Binance Demo не задан (BINANCE_DEMO_API_KEY / SECRET)",
    });
    expect(r.real.coinm.usd).toBeNull();
    expect(r.real.coinm.hint).toMatch(/Read-only ключ Binance не задан/);
    expect(fetchDemoEquity).not.toHaveBeenCalled();
    expect(fetchWalletBalances).not.toHaveBeenCalled();
  });

  it("пауза после 429/418 — «—» с причиной, без исключения", async () => {
    withKeys();
    vi.mocked(fetchWalletBalances).mockRejectedValue(
      new CooldownError("Binance на паузе", 429),
    );
    vi.mocked(fetchTickerPrices).mockRejectedValue(
      new CooldownError("Binance на паузе", 429),
    );
    const r = await getAccountBalances();
    expect(r.real.spot.usd).toBeNull();
    expect(r.real.spot.hint).toMatch(/429\/418/);
    expect(r.demo.usdm.usd).toBeNull();
    expect(r.demo.usdm.hint).toMatch(/429\/418/);
    expect(fetchDemoEquity).not.toHaveBeenCalled();
  });

  it("кэш 60 с: повторы и параллельные запросы не ходят на биржу, после 60 с — новый запрос", async () => {
    withKeys();
    await Promise.all([getAccountBalances(), getAccountBalances()]);
    vi.setSystemTime(Date.now() + BALANCES_TTL_MS - 1);
    await getAccountBalances();
    expect(fetchDemoEquity).toHaveBeenCalledTimes(1);
    expect(fetchWalletBalances).toHaveBeenCalledTimes(1);
    expect(fetchTickerPrices).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 2);
    await getAccountBalances();
    expect(fetchDemoEquity).toHaveBeenCalledTimes(2);
    expect(fetchWalletBalances).toHaveBeenCalledTimes(2);
  });
});
