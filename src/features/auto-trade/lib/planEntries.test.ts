import { describe, expect, it } from "vitest";
import { makeSetup } from "./autoTradeFixtures";
import { type PlanContext, planEntries } from "./planEntries";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const ctx = (patch: Partial<PlanContext> = {}): PlanContext => ({
  now: NOW,
  openSymbols: { spot: [], futures: [] },
  entries: {},
  limits: {
    setupStatuses: ["ready", "watch"],
    cooldownMs: 2 * 3600_000,
    maxOpenPositions: 20,
    maxEntriesPerCycle: 5,
  },
  ...patch,
});

describe("planEntries", () => {
  it("берёт ready и watch, сохраняя порядок", () => {
    const a = makeSetup({ symbol: "AUSDT" });
    const b = makeSetup({ symbol: "BUSDT", status: "watch" });
    expect(planEntries([a, b], ctx()).take).toEqual([a, b]);
  });

  it("пропускает уже открытый символ того же рынка, но не другого", () => {
    const fut = makeSetup({ symbol: "XUSDT" });
    const spot = makeSetup({
      symbol: "XUSDT",
      market: "spot",
      direction: "long",
    });
    const plan = planEntries(
      [fut, spot],
      ctx({ openSymbols: { spot: [], futures: ["XUSDT"] } }),
    );
    expect(plan.take).toEqual([spot]);
    expect(plan.skipped[0].reason).toMatch(/уже есть позиция/);
  });

  it("пауза после автовхода: в пределах cooldown — пропуск, после — вход", () => {
    const s = makeSetup();
    const recent = new Date(NOW - 3600_000).toISOString();
    const old = new Date(NOW - 3 * 3600_000).toISOString();
    expect(
      planEntries([s], ctx({ entries: { "BATUSDT:short": recent } })).take,
    ).toEqual([]);
    expect(
      planEntries([s], ctx({ entries: { "BATUSDT:short": old } })).take,
    ).toEqual([s]);
  });

  it("не торгуемые в демо и не разрешённые статусы — пропуск", () => {
    const plan = planEntries(
      [
        makeSetup({ demoTradable: false }),
        makeSetup({ symbol: "WUSDT", status: "watch" }),
      ],
      ctx({ limits: { ...ctx().limits, setupStatuses: ["ready"] } }),
    );
    expect(plan.take).toEqual([]);
    expect(plan.skipped).toHaveLength(2);
  });

  it("лимиты: входов за цикл и открытых символов (с учётом уже открытых)", () => {
    const setups = ["A", "B", "C"].map((x) =>
      makeSetup({ symbol: `${x}USDT` }),
    );
    const perCycle = planEntries(
      setups,
      ctx({ limits: { ...ctx().limits, maxEntriesPerCycle: 2 } }),
    );
    expect(perCycle.take.map((s) => s.symbol)).toEqual(["AUSDT", "BUSDT"]);
    const open = planEntries(
      setups,
      ctx({
        openSymbols: { spot: ["ZUSDT"], futures: ["YUSDT"] },
        limits: { ...ctx().limits, maxOpenPositions: 3 },
      }),
    );
    expect(open.take.map((s) => s.symbol)).toEqual(["AUSDT"]);
  });

  it("два сетапа на один символ за цикл — только первый", () => {
    const plan = planEntries(
      [makeSetup(), makeSetup({ direction: "long", kind: "rebound-long" })],
      ctx(),
    );
    expect(plan.take).toHaveLength(1);
  });
});
