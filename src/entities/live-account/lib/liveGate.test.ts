import { describe, expect, it, vi } from "vitest";
import { createLiveGate, type LiveGateDeps } from "./liveGate";

const open = (
  tradeId: string,
  market: "spot" | "usdm" = "spot",
  extra: Record<string, unknown> = {},
) => ({
  tradeId,
  kind: "open" as const,
  request: {
    market,
    symbol: "ADAUSDT",
    quantity: 100,
    stopLoss: 0.4,
    fitMinNotional: true,
    takeProfit: 0.6,
    ...extra,
  },
});

function deps(over: Partial<LiveGateDeps> = {}): LiveGateDeps {
  return {
    halted: false,
    openCount: 0,
    dailyPnl: new Map(),
    experimentOf: () => "S98",
    futuresMode: async () => "oneway",
    size: async () => ({
      ok: true,
      quantity: 20,
      notionalUsd: 10,
      raised: false,
    }),
    freeUsd: async () => 100,
    spotSlippage: 0.005,
    ...over,
  };
}

describe("createLiveGate", () => {
  it("всё в порядке — вход с объёмом $10 и без повторного подъёма до минимума", async () => {
    const r = await createLiveGate(deps()).check(open("t1"));
    expect(r).toEqual({
      ...open("t1"),
      request: { ...open("t1").request, quantity: 20, fitMinNotional: false },
    });
  });

  it("аварийный стоп — «входы остановлены»", async () => {
    const r = await createLiveGate(deps({ halted: true })).check(open("t1"));
    expect(r).toEqual({
      tradeId: "t1",
      kind: "skip",
      reason: "входы остановлены",
    });
  });

  it("5 открытых позиций — «лимит 5 позиций»; счётчик растёт с каждым входом прогона", async () => {
    expect(
      await createLiveGate(deps({ openCount: 5 })).check(open("t1")),
    ).toMatchObject({ kind: "skip", reason: "лимит 5 позиций" });
    const gate = createLiveGate(deps({ openCount: 4 }));
    const first = await gate.check(open("t1"));
    expect(first?.kind).toBe("open");
    if (first?.kind === "open") gate.spend(first);
    expect(await gate.check(open("t2"))).toMatchObject({
      reason: "лимит 5 позиций",
    });
  });

  it("дневной лимит — на эксперимент: S98 −$15 не входит, PS99 торгует", async () => {
    const gate = createLiveGate(
      deps({
        dailyPnl: new Map([["S98", -15.2]]),
        experimentOf: (id) => (id === "a" ? "S98" : "PS99"),
      }),
    );
    expect(await gate.check(open("a"))).toMatchObject({
      kind: "skip",
      reason:
        "дневной лимит убытка эксперимента: −$15,20 за сутки — входы до 00:00 UTC",
    });
    expect((await gate.check(open("b")))?.kind).toBe("open");
  });

  it("убыток меньше $15 — вход идёт", async () => {
    const gate = createLiveGate(deps({ dailyPnl: new Map([["S98", -14.99]]) }));
    expect((await gate.check(open("a")))?.kind).toBe("open");
  });

  it("минимум биржи выше $50 — пропуск с суммой", async () => {
    const gate = createLiveGate(
      deps({ size: async () => ({ ok: false, minUsd: 100 }) }),
    );
    expect(await gate.check(open("a"))).toMatchObject({
      reason: "минимум биржи $100,00 > $50",
    });
  });

  it("мало USDT на кошельке — пропуск; списание за вход прогона учитывается", async () => {
    const gate = createLiveGate(deps({ freeUsd: async () => 15 }));
    const first = await gate.check(open("a"));
    expect(first?.kind).toBe("open");
    if (first?.kind === "open") gate.spend(first);
    // 15 − 10,05 = 4,95 < 10,05.
    expect(await gate.check(open("b"))).toMatchObject({
      kind: "skip",
      reason: "мало средств на субсчёте: $4,95",
    });
  });

  it("фьючерсы не в One-way — пропуск; режим не узнали — ждать (null)", async () => {
    expect(
      await createLiveGate(deps({ futuresMode: async () => "hedge" })).check(
        open("a", "usdm"),
      ),
    ).toMatchObject({
      kind: "skip",
      reason: "реальные фьючерсы не в One-way (Hedge mode)",
    });
    expect(
      await createLiveGate(deps({ futuresMode: async () => null })).check(
        open("a", "usdm"),
      ),
    ).toBeNull();
  });

  it("fail-closed: объём, средства или эксперимент не прочитаны — вход ждёт (null), биржа не трогается", async () => {
    const freeUsd = vi.fn(async () => 100);
    expect(
      await createLiveGate(
        deps({
          size: async () => {
            throw new Error("сеть");
          },
          freeUsd,
        }),
      ).check(open("a")),
    ).toBeNull();
    expect(
      await createLiveGate(
        deps({
          freeUsd: async () => {
            throw new Error("сеть");
          },
        }),
      ).check(open("a")),
    ).toBeNull();
    expect(
      await createLiveGate(deps({ experimentOf: () => undefined })).check(
        open("a"),
      ),
    ).toBeNull();
  });
});
