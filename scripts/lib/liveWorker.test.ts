import { describe, expect, it, vi } from "vitest";
import {
  isHandshake,
  type LiveHeartbeat,
  liveHeartbeatSchema,
} from "@/entities/live-account";
import { MAIN_UID_PENDING_REASON } from "@/shared/api/binance";
import { BinanceApiError } from "@/shared/api/binance/signed";
import { CooldownError, NetworkError } from "@/shared/lib/fetchRetry";
import {
  applyReply,
  appUrlRefusal,
  demoVenueRefusal,
  emptyMemory,
  fixtureHeartbeat,
  fixtureRefusal,
  hasAnyTradeKey,
  MAX_RESTRICTIONS_AGE_MS,
  noKeyHeartbeat,
  pulseWithHandshake,
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

  it("UID основного ещё не известен (первый цикл после старта) — блокировка без остатков", async () => {
    const { d } = deps();
    const h = await runCheck(d, emptyMemory(), base);
    expect(h.verdict).toBe("blocked");
    expect(h.uid?.status).toBe("pending");
    expect(h.reasons).toEqual([expect.stringMatching(/ждём UID основного/)]);
    expect(h.spot).toBeNull();
    expect(h.usdm).toBeNull();
    expect(d.fetchFuturesAccount).not.toHaveBeenCalled();
  });

  it("без read-only ключа у приложения — проверка пропущена с пометкой, ключ годится", async () => {
    const { d } = deps();
    const memory = emptyMemory();
    applyReply(memory, { uid: null, reason: "нет ключа", transient: false });
    const h = await runCheck(d, memory, base);
    expect(h.verdict).toBe("ok");
    expect(h.uid).toEqual({
      status: "skipped",
      note: "проверка пропущена: нет ключа",
    });
  });

  it("ошибка чтения UID основного при известном UID — держим известный, ключ годится", async () => {
    const { d } = deps();
    const memory = emptyMemory();
    applyReply(memory, { uid: 999 });
    applyReply(memory, { uid: null, reason: "429", transient: true });
    expect(memory.mainAccount).toEqual({ uid: 999 });
    expect((await runCheck(d, memory, base)).verdict).toBe("ok");
  });

  it("ошибка чтения UID основного без известного UID — блокировка «не прочитан», без остатков", async () => {
    const { d } = deps();
    const memory = emptyMemory();
    applyReply(memory, { uid: null, reason: "сеть", transient: true });
    const h = await runCheck(d, memory, base);
    expect(h.verdict).toBe("blocked");
    expect(h.uid?.status).toBe("unread");
    expect(h.reasons[0]).toMatch(/UID основного счёта не прочитан \(сеть\)/);
    expect(h.spot).toBeNull();
  });

  it("ключ основного счёта: перезапуск воркера не даёт «годится» — рукопожатие, затем снова блокировка", async () => {
    const { d } = deps();
    const before = emptyMemory();
    applyReply(before, { uid: 111 });
    expect((await runCheck(d, before, base)).verdict).toBe("blocked");
    // Перезапуск: память пустая.
    const after = emptyMemory();
    const handshake = await runCheck(d, after, base);
    expect(handshake.verdict).toBe("blocked");
    expect(handshake.uid?.status).toBe("pending");
    applyReply(after, { uid: 111 });
    const full = await runCheck(d, after, base);
    expect(full.verdict).toBe("blocked");
    expect(full.uid?.status).toBe("same");
    expect(full.spot).toBeNull();
  });

  it("старт → рукопожатие → Spot падает во втором цикле: блокировка «UID субсчёта не прочитан», не рукопожатие", async () => {
    const { d } = deps({
      fetchSpotAccount: vi
        .fn<WorkerDeps["fetchSpotAccount"]>()
        .mockResolvedValueOnce({ uid: 111, balances: [] })
        .mockRejectedValue(new CooldownError("Binance на паузе", 429)),
    });
    const memory = emptyMemory();
    const first = await runCheck(d, memory, base);
    expect(isHandshake(first)).toBe(true);
    applyReply(memory, { uid: 999 });
    const second = await runCheck(d, memory, base);
    expect(isHandshake(second)).toBe(false);
    expect(second.verdict).toBe("blocked");
    expect(second.uid).toBeNull();
    expect(second.reasons[0]).toMatch(/UID субсчёта не прочитан/);
    expect(second.error).toMatch(/Binance на паузе/);
  });

  it("старт → рукопожатие → -2015 во втором цикле: «Binance не принял ключ», не рукопожатие", async () => {
    const rejected = new BinanceApiError("Invalid API-key, IP", -2015, 401);
    const { d, advance } = deps({
      fetchRestrictions: vi
        .fn<() => Promise<unknown>>()
        .mockResolvedValueOnce(GOOD)
        .mockRejectedValue(rejected),
      fetchSpotAccount: vi
        .fn<WorkerDeps["fetchSpotAccount"]>()
        .mockResolvedValueOnce({ uid: 111, balances: [] })
        .mockRejectedValue(rejected),
    });
    const memory = emptyMemory();
    expect(isHandshake(await runCheck(d, memory, base))).toBe(true);
    applyReply(memory, { uid: 999 });
    const second = await runCheck(d, memory, base);
    expect(second.reasons).toEqual([
      "Binance не принял ключ: проверьте ключ и IP-whitelist",
    ]);
    expect(isHandshake(second)).toBe(false);
    // Следующий цикл: права перечитываются (ключ заблокирован), снова отказ — тоже не рукопожатие.
    advance(60_000);
    const third = await runCheck(d, memory, base);
    expect(third.reasons).toEqual([
      "Binance не принял ключ: проверьте ключ и IP-whitelist",
    ]);
    expect(third.uid?.status).not.toBe("pending");
    expect(isHandshake(third)).toBe(false);
  });

  it("аккаунт Spot ни разу не прочитан — UID субсчёта неизвестен, блокировка", async () => {
    const { d } = deps({
      fetchSpotAccount: vi.fn(async () => {
        throw new NetworkError("fetch failed");
      }),
    });
    const memory = emptyMemory();
    applyReply(memory, { uid: 999 });
    const h = await runCheck(d, memory, base);
    expect(h.verdict).toBe("blocked");
    expect(h.reasons[0]).toMatch(/UID субсчёта не прочитан/);
  });

  it("права не перепроверены дольше предела — «годится» снимается", async () => {
    const { d, advance } = deps({
      fetchRestrictions: vi
        .fn<() => Promise<unknown>>()
        .mockResolvedValueOnce(GOOD)
        .mockRejectedValue(new CooldownError("Binance на паузе", 429)),
    });
    const memory = { ...emptyMemory(), mainAccount: { uid: 999 } };
    expect((await runCheck(d, memory, base)).verdict).toBe("ok");
    advance(RESTRICTIONS_EVERY_MS);
    const stillOk = await runCheck(d, memory, base);
    expect(stillOk.verdict).toBe("ok");
    expect(stillOk.error).toMatch(/Права ключа не прочитаны/);
    advance(MAX_RESTRICTIONS_AGE_MS - RESTRICTIONS_EVERY_MS + 60_000);
    const stale = await runCheck(d, memory, base);
    expect(stale.verdict).toBe("blocked");
    expect(stale.reasons[0]).toMatch(
      /права ключа не перепроверены 21 мин: Binance на паузе/,
    );
    expect(stale.spot).toBeNull();
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

describe("pulseWithHandshake", () => {
  const reply = (mainAccount?: { uid: number }) => ({
    ok: true as const,
    verdict: "ok" as const,
    mainAccount,
  });

  it("старт с годным ключом: рукопожатие и ровно один повтор — полный пульс «годится»", async () => {
    const { d } = deps();
    const memory = emptyMemory();
    const send = vi.fn(async (_h: LiveHeartbeat) => reply({ uid: 999 }));
    const sent = await pulseWithHandshake({
      memory,
      build: () => runCheck(d, memory, base),
      send,
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(isHandshake(sent[0])).toBe(true);
    expect(sent[1].verdict).toBe("ok");
    // Следующий цикл по таймеру — один пульс, без повтора.
    const next = await pulseWithHandshake({
      memory,
      build: () => runCheck(d, memory, base),
      send,
    });
    expect(next).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("повтор после рукопожатия — не больше одного, даже если второй пульс снова «ждём UID»", async () => {
    const memory = emptyMemory();
    const handshake = noKeyHeartbeat(base);
    const build = vi.fn(async () => ({
      ...handshake,
      handshake: true,
      verdict: "blocked" as const,
      reasons: [MAIN_UID_PENDING_REASON],
      uid: { status: "pending" as const, note: MAIN_UID_PENDING_REASON },
    }));
    const send = vi.fn(async () => reply({ uid: 999 }));
    await pulseWithHandshake({ memory, build, send });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("приложение не прислало UID — повтора нет", async () => {
    const { d } = deps();
    const memory = emptyMemory();
    const send = vi.fn(async () => reply());
    const sent = await pulseWithHandshake({
      memory,
      build: () => runCheck(d, memory, base),
      send,
    });
    expect(sent).toHaveLength(1);
  });

  it.each([
    "cooldown",
    "reject",
  ] as const)("сценарий ревью (%s во втором цикле): цикл конечен, второй пульс сохраняемый", async (scenario) => {
    const rejected = new BinanceApiError("Invalid API-key", -2015, 401);
    let restrictionCalls = 0;
    let spotCalls = 0;
    const { d } = deps({
      fetchRestrictions: vi.fn(async () => {
        restrictionCalls++;
        if (scenario === "reject" && restrictionCalls > 1) throw rejected;
        return GOOD;
      }),
      fetchSpotAccount: vi.fn(async () => {
        spotCalls++;
        if (spotCalls > 1)
          throw scenario === "reject"
            ? rejected
            : new CooldownError("Binance на паузе", 429);
        return { uid: 1, balances: [] };
      }),
    });
    const memory = emptyMemory();
    const send = vi.fn(async (_h: LiveHeartbeat) => reply({ uid: 2 }));
    for (let timerTick = 0; timerTick < 4; timerTick++)
      await pulseWithHandshake({
        memory,
        build: () => runCheck(d, memory, base),
        send,
      });
    // 4 цикла таймера: первый — рукопожатие + один повтор, остальные — по одному пульсу.
    expect(send).toHaveBeenCalledTimes(5);
    const pulses = send.mock.calls.map(([h]) => h);
    expect(isHandshake(pulses[0])).toBe(true);
    for (const h of pulses.slice(1)) {
      expect(isHandshake(h)).toBe(false);
      expect(h.verdict).toBe("blocked");
    }
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

  it.each([
    "http://localhost.evil.com",
    "http://127.0.0.1@evil.com",
    "http://localhost@evil.com",
    "http://evil.com#@localhost",
    "http://evil.com/?localhost",
  ])("фикстура: враждебный адрес %s — отказ", (appUrl) => {
    expect(fixtureRefusal({ hasTradeKey: false, appUrl })).toMatch(
      /не localhost/,
    );
  });

  it("адрес приложения: https или http только на localhost/127.0.0.1", () => {
    expect(
      appUrlRefusal("https://binance-dashboard-gold.vercel.app"),
    ).toBeNull();
    expect(appUrlRefusal("http://localhost:5003")).toBeNull();
    expect(appUrlRefusal("http://127.0.0.1:5003")).toBeNull();
    for (const url of [
      "http://binance-dashboard-gold.vercel.app",
      "http://localhost.evil.com",
      "http://127.0.0.1@evil.com",
      "ftp://localhost",
    ])
      expect(appUrlRefusal(url)).toMatch(/должен быть https/);
    expect(appUrlRefusal("мусор")).toMatch(/не распознан/);
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

describe("demoVenueRefusal: площадка демо — только локально (ревью PR #89)", () => {
  const ok = {
    production: false,
    hasTradeKey: false,
    appUrl: "http://localhost:5002",
  };
  it("localhost и 127.0.0.1 без торгового ключа — можно", () => {
    expect(demoVenueRefusal(ok)).toBeNull();
    expect(
      demoVenueRefusal({ ...ok, appUrl: "http://127.0.0.1:5002" }),
    ).toBeNull();
  });
  it("production — нельзя", () => {
    expect(demoVenueRefusal({ ...ok, production: true })).toMatch(/production/);
  });
  it("задан торговый ключ (окружение VM, даже без NODE_ENV) — нельзя", () => {
    expect(demoVenueRefusal({ ...ok, hasTradeKey: true })).toMatch(
      /BINANCE_TRADE_API_KEY/,
    );
  });
  it("приложение не на localhost — нельзя; адрес не распознан — нельзя", () => {
    expect(demoVenueRefusal({ ...ok, appUrl: "https://example.com" })).toMatch(
      /не localhost/,
    );
    expect(demoVenueRefusal({ ...ok, appUrl: "не адрес" })).toMatch(
      /не распознан/,
    );
  });
});
