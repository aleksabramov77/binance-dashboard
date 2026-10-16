import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveState } from "@/entities/live-account";
import { fetchDemoEquity } from "@/shared/api/binance/demo.server";
import { fetchTickerPrices } from "@/shared/api/binance/public.server";
import { CooldownError } from "@/shared/lib/fetchRetry";
import {
  BALANCES_TTL_MS,
  COINM_REAL_HINT,
  clearAccountBalancesCache,
  getAccountBalances,
  realWallets,
} from "./accountBalances";
import { loadLastLiveState } from "./liveAccount";
import { clearTickerPricesCache } from "./tickerPrices";

vi.mock("./liveAccount", () => ({ loadLastLiveState: vi.fn() }));
vi.mock("@/shared/api/binance/demo.server", () => ({
  fetchDemoEquity: vi.fn(),
}));
vi.mock("@/shared/api/binance/public.server", () => ({
  fetchTickerPrices: vi.fn(),
}));
vi.mock("@/shared/lib/logger.server", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const NOW = Date.parse("2026-10-16T10:00:00Z");

const live = (over: Partial<LiveState["heartbeat"]> = {}): LiveState => ({
  heartbeat: {
    version: "test",
    handshake: false,
    sentAt: "2026-10-16T09:59:00.000Z",
    fixture: null,
    verdict: "ok",
    reasons: [],
    warnings: [],
    restrictions: { flags: null, checkedAt: null },
    uid: { status: "different", note: null },
    spot: { usdtFree: 50, usdtLocked: 10, equityUsd: 72.5, unpriced: [] },
    usdm: { walletBalance: 40, availableBalance: 35, unrealizedProfit: -1.5 },
    balancesNote: null,
    error: null,
    ...over,
  },
  receivedAt: "2026-10-16T09:59:00.000Z",
  status: "ok",
  statusSince: "2026-10-16T09:00:00.000Z",
  silentSince: null,
});

const withKeys = () => {
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
  vi.mocked(loadLastLiveState).mockResolvedValue(live());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("getAccountBalances", () => {
  it("Demo — equity по кошелькам, Real — субсчёт из пульса; ошибки и активы без цены — в подсказке", async () => {
    withKeys();
    const r = await getAccountBalances();
    expect(r.demo).toEqual({
      spot: { usd: 10_000, hint: null },
      usdm: { usd: 5_000, hint: "Без цены в $, не учтены: SNDKB" },
      coinm: { usd: null, hint: "Ошибка: Binance: Invalid API-key (-2015)" },
    });
    const at = "2026-10-16T09:59:00.000Z";
    expect(r.real).toEqual({
      spot: { usd: 72.5, hint: "субсчёт", at },
      usdm: { usd: 38.5, hint: "субсчёт", at },
      coinm: { usd: null, hint: COINM_REAL_HINT },
    });
  });

  it("без ключа Demo и без пульса — «—» с подсказкой и без запросов к бирже", async () => {
    vi.stubEnv("BINANCE_DEMO_API_KEY", "");
    vi.mocked(loadLastLiveState).mockResolvedValue(null);
    const r = await getAccountBalances();
    expect(r.demo.spot).toEqual({
      usd: null,
      hint: "Ключ Binance Demo не задан (BINANCE_DEMO_API_KEY / SECRET)",
    });
    expect(r.real.spot.usd).toBeNull();
    expect(r.real.spot.hint).toMatch(/Воркер реального счёта не подключён/);
    expect(r.real.coinm.hint).toBe(COINM_REAL_HINT);
    expect(fetchDemoEquity).not.toHaveBeenCalled();
  });

  it("пауза после 429/418 — «—» с причиной, без исключения", async () => {
    withKeys();
    vi.mocked(fetchTickerPrices).mockRejectedValue(
      new CooldownError("Binance на паузе", 429),
    );
    const r = await getAccountBalances();
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
    expect(loadLastLiveState).toHaveBeenCalledTimes(1);
    expect(fetchTickerPrices).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 2);
    await getAccountBalances();
    expect(fetchDemoEquity).toHaveBeenCalledTimes(2);
    expect(loadLastLiveState).toHaveBeenCalledTimes(2);
  });
});

describe("realWallets", () => {
  const SILENT = 5 * 60_000;

  it("нет пульса, ключ не задан, ключ заблокирован — «—» с причиной; COIN-M — не торгуется", () => {
    expect(realWallets(null, NOW, SILENT).spot.hint).toMatch(/не подключён/);
    expect(
      realWallets(live({ verdict: "no-key" }), NOW, SILENT).usdm.hint,
    ).toMatch(/не задан ключ/);
    const blocked = realWallets(
      live({ verdict: "blocked", reasons: ["вывод"] }),
      NOW,
      SILENT,
    );
    expect(blocked.spot).toEqual({
      usd: null,
      hint: expect.stringMatching(/заблокирован/),
    });
    expect(blocked.coinm).toEqual({ usd: null, hint: COINM_REAL_HINT });
  });

  it("без цен — USDT free + locked с оговоркой; без USDⓈ-M — причина из пульса", () => {
    const r = realWallets(
      live({
        spot: { usdtFree: 50, usdtLocked: 10, equityUsd: null, unpriced: [] },
        usdm: null,
        balancesNote: "фьючерсы недоступны",
      }),
      NOW,
      SILENT,
    );
    expect(r.spot.usd).toBe(60);
    expect(r.spot.hint).toMatch(/только USDT/);
    expect(r.usdm).toMatchObject({
      usd: null,
      hint: "Субсчёт: фьючерсы недоступны",
    });
  });

  it("воркер молчит — остаток на время пульса с пометкой", () => {
    const r = realWallets(live(), NOW + 10 * 60_000, SILENT);
    expect(r.spot.usd).toBe(72.5);
    expect(r.spot.hint).toMatch(/воркер молчит/);
  });
});
