import { describe, expect, it, vi } from "vitest";
import type { Setup, SetupRecheck } from "@/entities/market-signal";
import type {
  AutoTradeAction,
  TradeRequest,
  TradeResult,
} from "@/entities/trade";
import { makeSetup } from "../lib/autoTradeFixtures";
import { type AutoTradeDeps, dedupeSkips, runAutoTradeCycle } from "./runCycle";
import { emptyState } from "./stateStore";

const recheckOf = (
  setup: Setup,
  status: SetupRecheck["status"] = "actual",
): SetupRecheck => ({
  checkedAt: "",
  status,
  price: setup.entry,
  fresh: status === "stale" ? null : setup,
  notes: [],
});

const resultOf = (
  req: TradeRequest,
  status: TradeResult["status"],
): TradeResult => ({
  id: "t",
  at: "2026-10-10T12:00:00.000Z",
  environment: "demo",
  request: req,
  status,
  entryPrice: null,
  filledQuantity: null,
  steps: [],
  message: status,
});

function deps(
  setups: Setup[],
  patch: Partial<AutoTradeDeps> = {},
): AutoTradeDeps {
  return {
    scan: async () => ({
      scannedAt: "",
      universeSize: 1,
      gainers: [],
      losers: [],
      setups,
    }),
    recheck: async (s) => recheckOf(s),
    place: async (req) => resultOf(req, "protected"),
    overview: async () => ({
      configured: true,
      maxNotionalUsd: 1000,
      balances: { spot: 1000, futures: 1000 },
      openSymbols: { spot: [], futures: [] },
      error: null,
    }),
    ...patch,
  };
}

describe("runAutoTradeCycle", () => {
  it("входит по свежим уровням, ставит отметку паузы, пишет решение", async () => {
    const place = vi.fn(async (req: TradeRequest) =>
      resultOf(req, "protected"),
    );
    const setup = makeSetup();
    const fresh = makeSetup({ stopLoss: 0.135 });
    const state = await runAutoTradeCycle(
      { ...emptyState(), enabled: true },
      deps([setup], {
        place,
        recheck: async () => ({ ...recheckOf(fresh), status: "changed" }),
      }),
      Date.parse("2026-10-10T12:00:00Z"),
    );
    expect(place).toHaveBeenCalledOnce();
    const req = place.mock.calls[0][0];
    expect(req).toMatchObject({
      symbol: "BATUSDT",
      direction: "short",
      stopLoss: 0.135,
      takeProfit: 0.12,
      leverage: 2,
      setupId: "auto:BATUSDT:short",
    });
    expect(state.entries["BATUSDT:short"]).toBeDefined();
    expect(state.actions[0]).toMatchObject({
      outcome: "opened",
      symbol: "BATUSDT",
    });
    expect(state.lastCycleAt).not.toBeNull();
  });

  it("неактуальный после предпроверки — не входит", async () => {
    const place = vi.fn();
    const state = await runAutoTradeCycle(
      emptyState(),
      deps([makeSetup()], {
        place,
        recheck: async (s) => recheckOf(s, "stale"),
      }),
    );
    expect(place).not.toHaveBeenCalled();
    expect(state.actions[0].outcome).toBe("skipped");
  });

  it("отказ биржи — без паузы; ошибка одного сетапа не ломает остальные", async () => {
    const a = makeSetup({ symbol: "AUSDT" });
    const b = makeSetup({ symbol: "BUSDT" });
    const state = await runAutoTradeCycle(
      emptyState(),
      deps([a, b], {
        recheck: async (s) => {
          if (s.symbol === "AUSDT") throw new Error("сеть");
          return recheckOf(s);
        },
        place: async (req) => resultOf(req, "rejected"),
      }),
    );
    expect(state.actions.map((x) => x.outcome)).toEqual(["error", "rejected"]);
    expect(state.entries).toEqual({});
  });

  it("демо не настроено — цикл падает целиком", async () => {
    await expect(
      runAutoTradeCycle(
        emptyState(),
        deps([], {
          overview: async () => ({
            configured: false,
            maxNotionalUsd: 0,
            balances: null,
            openSymbols: null,
            error: null,
          }),
        }),
      ),
    ).rejects.toThrow(/не настроен/);
  });
});

describe("dedupeSkips", () => {
  const action = (patch: Partial<AutoTradeAction>): AutoTradeAction => ({
    at: "",
    symbol: "BATUSDT",
    market: "futures",
    direction: "short",
    setupStatus: "ready",
    outcome: "skipped",
    reason: "уже в сделке",
    ...patch,
  });

  it("одинаковый пропуск подряд не дублируется, новый повод — пишется", () => {
    const prev = [action({})];
    expect(dedupeSkips([action({})], prev)).toEqual([]);
    expect(dedupeSkips([action({ reason: "пауза" })], prev)).toHaveLength(1);
    expect(
      dedupeSkips([action({})], [action({ outcome: "opened" })]),
    ).toHaveLength(1);
  });
});
