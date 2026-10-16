import { describe, expect, it, vi } from "vitest";
import { liveHeartbeatSchema } from "@/entities/live-account";
import { BinanceApiError } from "@/shared/api/binance/signed";
import { CooldownError, NetworkError } from "@/shared/lib/fetchRetry";
import {
  emptyMemory,
  fixtureHeartbeat,
  fixtureRefusal,
  hasAnyTradeKey,
  noKeyHeartbeat,
  RESTRICTIONS_EVERY_MS,
  runCheck,
  toWire,
  type WorkerDeps,
} from "./liveWorker";

vi.mock("@/shared/lib/logger.server", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const T0 = Date.parse("2026-10-16T12:00:00Z");
const base = {
  version: "test",
  sentAt: new Date(T0).toISOString(),
  fixture: null,
};

const GOOD = {
  ipRestrict: true,
  enableReading: true,
  enableSpotAndMarginTrading: true,
  enableFutures: true,
  enableWithdrawals: false,
  enableInternalTransfer: false,
  permitsUniversalTransfer: false,
  enableMargin: false,
  createTime: 1,
};

function deps(over: Partial<WorkerDeps> = {}) {
  let now = T0;
  const d = {
    now: () => now,
    fetchRestrictions: vi.fn(async (): Promise<unknown> => GOOD),
    fetchSpotAccount: vi.fn(async () => ({
      uid: 111,
      balances: [
        { asset: "USDT", free: 50, locked: 10 },
        { asset: "BTC", free: 0.0001, locked: 0 },
      ],
    })),
    fetchFuturesAccount: vi.fn(async () => ({
      totalWalletBalance: 40,
      availableBalance: 35,
      totalUnrealizedProfit: -1,
    })),
    fetchPrices: vi.fn(async () => new Map([["BTCUSDT", 100_000]])),
    ...over,
  };
  return { d, advance: (ms: number) => (now += ms) };
}

describe("runCheck", () => {
  it("ключ годится: права, UID другой, остатки Spot (equity в $) и USDⓈ-M", async () => {
    const { d } = deps();
    const memory = { ...emptyMemory(), mainAccount: { uid: 999 } };
    const h = await runCheck(d, memory, base);
    expect(h).toMatchObject({
      verdict: "ok",
      reasons: [],
      uid: { status: "different", note: null },
      spot: { usdtFree: 50, usdtLocked: 10, equityUsd: 70, unpriced: [] },
      usdm: { walletBalance: 40, availableBalance: 35, unrealizedProfit: -1 },
      error: null,
    });
    expect(h.restrictions.flags?.ipRestrict).toBe(true);
    expect(liveHeartbeatSchema.safeParse(h).success).toBe(true);
  });

  it("права перечитываются раз в 10 минут, не каждый пульс", async () => {
    const { d, advance } = deps();
    const memory = emptyMemory();
    await runCheck(d, memory, base);
    advance(60_000);
    await runCheck(d, memory, base);
    expect(d.fetchRestrictions).toHaveBeenCalledTimes(1);
    advance(RESTRICTIONS_EVERY_MS);
    await runCheck(d, memory, base);
    expect(d.fetchRestrictions).toHaveBeenCalledTimes(2);
  });

  it("разрешён вывод — блокировка, дальше проверки прав на биржу не ходит", async () => {
    const { d } = deps({
      fetchRestrictions: vi.fn(async () => ({
        ...GOOD,
        enableWithdrawals: true,
      })),
    });
    const h = await runCheck(d, emptyMemory(), base);
    expect(h.verdict).toBe("blocked");
    expect(h.reasons).toEqual([
      expect.stringMatching(/разрешён вывод средств/),
    ]);
    expect(h.spot).toBeNull();
    expect(d.fetchSpotAccount).not.toHaveBeenCalled();
    expect(d.fetchFuturesAccount).not.toHaveBeenCalled();
  });

  it("UID совпал с основным счётом — блокировка без остатков", async () => {
    const { d } = deps();
    const memory = { ...emptyMemory(), mainAccount: { uid: 111 } };
    const h = await runCheck(d, memory, base);
    expect(h.verdict).toBe("blocked");
    expect(h.reasons).toEqual([
      "Это ключ основного счёта — нужен ключ субсчёта",
    ]);
    expect(h.uid?.status).toBe("same");
    expect(h.spot).toBeNull();
    expect(d.fetchFuturesAccount).not.toHaveBeenCalled();
  });

  it("UID основного ещё не известен — ожидание; без read-only ключа — пропуск с пометкой", async () => {
    const { d } = deps();
    expect((await runCheck(d, emptyMemory(), base)).uid?.status).toBe(
      "pending",
    );
    const h = await runCheck(
      d,
      { ...emptyMemory(), mainAccount: { uid: null, reason: "нет ключа" } },
      base,
    );
    expect(h.verdict).toBe("ok");
    expect(h.uid).toEqual({
      status: "skipped",
      note: "проверка пропущена: нет ключа",
    });
  });

  it("-2015 (ключ или IP) — блокировка «Binance не принял ключ»", async () => {
    const { d } = deps({
      fetchRestrictions: vi.fn(async () => {
        throw new BinanceApiError("Invalid API-key, IP", -2015, 401);
      }),
    });
    const h = await runCheck(d, emptyMemory(), base);
    expect(h.verdict).toBe("blocked");
    expect(h.reasons).toEqual([
      "Binance не принял ключ: проверьте ключ и IP-whitelist",
    ]);
  });

  it("биржа недоступна или 429 — пульс с ошибкой, блокировка не снимается", async () => {
    const { d, advance } = deps({
      fetchRestrictions: vi
        .fn<() => Promise<unknown>>()
        .mockResolvedValueOnce({ ...GOOD, ipRestrict: false })
        .mockRejectedValueOnce(new CooldownError("Binance на паузе", 429))
        .mockRejectedValueOnce(new NetworkError("fetch failed")),
    });
    const memory = emptyMemory();
    expect((await runCheck(d, memory, base)).verdict).toBe("blocked");
    advance(60_000);
    const paused = await runCheck(d, memory, base);
    expect(paused.verdict).toBe("blocked");
    expect(paused.error).toMatch(/Права ключа не прочитаны: Binance на паузе/);
    advance(60_000);
    expect((await runCheck(d, memory, base)).verdict).toBe("blocked");
    expect(d.fetchSpotAccount).not.toHaveBeenCalled();
  });

  it("первая проверка не удалась из-за сети — блокировка до первой удачной проверки", async () => {
    const { d } = deps({
      fetchRestrictions: vi.fn(async () => {
        throw new NetworkError("fetch failed");
      }),
    });
    const h = await runCheck(d, emptyMemory(), base);
    expect(h.verdict).toBe("blocked");
    expect(h.reasons[0]).toMatch(/ещё не проверены/);
    expect(h.error).toMatch(/fetch failed/);
  });

  it("годный ключ и сбой чтения остатков — оценка остаётся, ошибка в пульсе", async () => {
    const { d } = deps({
      fetchFuturesAccount: vi.fn(async () => {
        throw new NetworkError("fetch failed");
      }),
      fetchPrices: vi.fn(async () => {
        throw new NetworkError("нет цен");
      }),
    });
    const h = await runCheck(
      d,
      { ...emptyMemory(), mainAccount: { uid: 1 } },
      base,
    );
    expect(h.verdict).toBe("ok");
    expect(h.usdm).toBeNull();
    expect(h.spot).toMatchObject({ usdtFree: 50, equityUsd: null });
    expect(h.error).toMatch(/USDⓈ-M не прочитан/);
  });

  it("фьючерсы не разрешены — предупреждение, USDⓈ-M не читается", async () => {
    const { d } = deps({
      fetchRestrictions: vi.fn(async () => ({ ...GOOD, enableFutures: false })),
    });
    const h = await runCheck(
      d,
      { ...emptyMemory(), mainAccount: { uid: 1 } },
      base,
    );
    expect(h.verdict).toBe("ok");
    expect(h.warnings).toEqual([expect.stringMatching(/фьючерсы недоступны/)]);
    expect(d.fetchFuturesAccount).not.toHaveBeenCalled();
    expect(h.balancesNote).toMatch(/фьючерсы недоступны/);
  });
});

describe("пульс без ключа, фикстуры и отправка", () => {
  it("без ключа — пульс «ключ не задан»", () => {
    const h = noKeyHeartbeat(base);
    expect(h.verdict).toBe("no-key");
    expect(liveHeartbeatSchema.safeParse(h).success).toBe(true);
  });

  it.each([
    "ok",
    "blocked",
    "main-account",
  ] as const)("фикстура %s проходит схему пульса", (fixture) => {
    const h = fixtureHeartbeat(fixture, { ...base, fixture });
    expect(liveHeartbeatSchema.safeParse(h).success).toBe(true);
    expect(h.verdict).toBe(fixture === "ok" ? "ok" : "blocked");
  });

  it("фикстура — только без ключа и только на localhost/127.0.0.1", () => {
    expect(
      fixtureRefusal({ hasTradeKey: false, appUrl: "http://localhost:5001" }),
    ).toBeNull();
    expect(
      fixtureRefusal({ hasTradeKey: false, appUrl: "http://127.0.0.1:5001" }),
    ).toBeNull();
    expect(
      fixtureRefusal({ hasTradeKey: true, appUrl: "http://localhost:5001" }),
    ).toMatch(/BINANCE_TRADE_API_KEY/);
    expect(
      fixtureRefusal({
        hasTradeKey: false,
        appUrl: "https://binance-dashboard-gold.vercel.app",
      }),
    ).toMatch(/не localhost/);
    expect(fixtureRefusal({ hasTradeKey: false, appUrl: "мусор" })).toMatch(
      /не распознан/,
    );
  });

  it("фикстура запрещена при любом из BINANCE_TRADE_API_KEY / SECRET, даже без пары", () => {
    expect(hasAnyTradeKey({})).toBe(false);
    expect(hasAnyTradeKey({ BINANCE_TRADE_API_KEY: " " })).toBe(false);
    expect(hasAnyTradeKey({ BINANCE_TRADE_API_KEY: "dummy" })).toBe(true);
    expect(hasAnyTradeKey({ BINANCE_TRADE_API_SECRET: "dummy" })).toBe(true);
    expect(
      fixtureRefusal({
        hasTradeKey: hasAnyTradeKey({ BINANCE_TRADE_API_KEY: "dummy" }),
        appUrl: "http://localhost:5004",
      }),
    ).toMatch(/BINANCE_TRADE_API_KEY или BINANCE_TRADE_API_SECRET/);
  });

  it("в отправляемом пульсе нет ключа и секрета", async () => {
    const { d } = deps();
    const h = await runCheck(
      d,
      { ...emptyMemory(), mainAccount: { uid: 1 } },
      base,
    );
    const wire = JSON.stringify(
      toWire({ ...h, apiKey: "KEY123", apiSecret: "SECRET456" } as typeof h),
    );
    expect(wire).not.toMatch(/KEY123|SECRET456|apiKey|apiSecret/);
  });
});
