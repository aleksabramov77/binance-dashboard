import { describe, expect, it } from "vitest";
import { planSpaceAlerts, type SpaceAlertRow } from "./planSpaceAlerts";

const T0 = Date.parse("2026-10-15T12:00:00Z");
const MIN15 = 15 * 60_000;

/** Состояние после прогона: прежние строки, поверх — записанные. */
function apply(prev: SpaceAlertRow[], upserts: SpaceAlertRow[]) {
  const byKey = new Map(prev.map((r) => [r.key, r]));
  for (const r of upserts) byKey.set(r.key, r);
  return [...byKey.values()];
}

describe("planSpaceAlerts", () => {
  it("места много — ничего не шлём и не пишем", () => {
    expect(planSpaceAlerts(80, [], T0)).toEqual({
      notifyThreshold: null,
      upserts: [],
    });
  });

  it("прошли 50 % — одно уведомление о 50", () => {
    const plan = planSpaceAlerts(49.5, [], T0);
    expect(plan.notifyThreshold).toBe(50);
    expect(plan.upserts).toEqual([
      {
        key: "db.space.50",
        status: "sent",
        title: "Свободного места в базе ≤ 50 %",
        firstSeen: new Date(T0).toISOString(),
        lastSeen: new Date(T0).toISOString(),
        lastSent: new Date(T0).toISOString(),
      },
    ]);
  });

  it("ровно на пороге — порог пройден", () => {
    expect(planSpaceAlerts(30, [], T0).notifyThreshold).toBe(30);
  });

  it("сразу 55 → 25 — одно сообщение о 30, пороги 50 и 40 помечены отправленными", () => {
    const plan = planSpaceAlerts(25, [], T0);
    expect(plan.notifyThreshold).toBe(30);
    expect(plan.upserts.map((r) => [r.key, r.status])).toEqual([
      ["db.space.50", "sent"],
      ["db.space.40", "sent"],
      ["db.space.30", "sent"],
    ]);
  });

  it("повторный прогон без изменений — тишина", () => {
    const first = planSpaceAlerts(25, [], T0);
    const again = planSpaceAlerts(25, first.upserts, T0 + MIN15);
    expect(again).toEqual({ notifyThreshold: null, upserts: [] });
  });

  it("дальше вниз — сообщение только о новом пороге", () => {
    const first = planSpaceAlerts(25, [], T0);
    const next = planSpaceAlerts(19, first.upserts, T0 + MIN15);
    expect(next.notifyThreshold).toBe(20);
    expect(next.upserts.map((r) => r.key)).toEqual(["db.space.20"]);
  });

  it("свободно чуть выше порога (в пределах 2 п.п.) — порог не перезаряжается", () => {
    const first = planSpaceAlerts(29, [], T0);
    const plan = planSpaceAlerts(31.5, first.upserts, T0 + MIN15);
    expect(plan.upserts).toEqual([]);
    expect(
      planSpaceAlerts(29, first.upserts, T0 + 2 * MIN15).notifyThreshold,
    ).toBeNull();
  });

  it("почистили: свободно > 32 % — 30 перезаряжается и срабатывает снова", () => {
    const first = planSpaceAlerts(29, [], T0);
    const cleaned = planSpaceAlerts(33, first.upserts, T0 + MIN15);
    expect(cleaned.notifyThreshold).toBeNull();
    expect(cleaned.upserts.map((r) => [r.key, r.status])).toEqual([
      ["db.space.30", "cleared"],
    ]);
    expect(cleaned.upserts[0].firstSeen).toBe(first.upserts[2].firstSeen);

    const state = apply(first.upserts, cleaned.upserts);
    const again = planSpaceAlerts(29.9, state, T0 + 2 * MIN15);
    expect(again.notifyThreshold).toBe(30);
    expect(again.upserts.map((r) => [r.key, r.status])).toEqual([
      ["db.space.30", "sent"],
    ]);
  });

  it("лимит превышен (свободно < 0) — сообщение о 5 %", () => {
    expect(planSpaceAlerts(-3, [], T0).notifyThreshold).toBe(5);
  });

  it("чужие ключи alert_state не трогает", () => {
    const other: SpaceAlertRow = {
      key: "http5xx:/api/x",
      status: "sent",
      title: "x",
      firstSeen: "",
      lastSeen: "",
      lastSent: null,
    };
    expect(planSpaceAlerts(90, [other], T0).upserts).toEqual([]);
  });
});
