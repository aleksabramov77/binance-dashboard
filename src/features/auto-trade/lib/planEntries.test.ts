import { describe, expect, it } from "vitest";
import { makeSetup } from "./autoTradeFixtures";
import { type PlanContext, planEntries } from "./planEntries";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const ctx = (patch: Partial<PlanContext> = {}): PlanContext => ({
  now: NOW,
  openSymbols: { spot: [], futures: [] },
  holds: {},
  setupStatuses: ["ready", "watch"],
  ...patch,
});

describe("planEntries", () => {
  it("берёт ready и watch, сохраняя порядок", () => {
    const a = makeSetup({ symbol: "AUSDT" });
    const b = makeSetup({ symbol: "BUSDT", status: "watch" });
    expect(planEntries([a, b], ctx()).candidates).toEqual([a, b]);
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
    expect(plan.candidates).toEqual([spot]);
    expect(plan.skipped[0].reason).toMatch(/уже есть позиция/);
  });

  it("пауза: до срока — пропуск, после — кандидат", () => {
    const s = makeSetup();
    const later = new Date(NOW + 60_000).toISOString();
    const earlier = new Date(NOW - 60_000).toISOString();
    expect(
      planEntries([s], ctx({ holds: { "BATUSDT:short": later } })).candidates,
    ).toEqual([]);
    expect(
      planEntries([s], ctx({ holds: { "BATUSDT:short": earlier } })).candidates,
    ).toEqual([s]);
  });

  it("не торгуемые в демо и не разрешённые статусы — пропуск", () => {
    const plan = planEntries(
      [
        makeSetup({ demoTradable: false }),
        makeSetup({ symbol: "WUSDT", status: "watch" }),
      ],
      ctx({ setupStatuses: ["ready"] }),
    );
    expect(plan.candidates).toEqual([]);
    expect(plan.skipped).toHaveLength(2);
  });

  it("два сетапа на один символ за цикл — только первый", () => {
    const plan = planEntries(
      [makeSetup(), makeSetup({ direction: "long", kind: "rebound-long" })],
      ctx(),
    );
    expect(plan.candidates).toHaveLength(1);
  });
});
