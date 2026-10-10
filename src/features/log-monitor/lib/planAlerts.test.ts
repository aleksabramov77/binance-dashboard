import { describe, expect, it } from "vitest";
import type { Issue } from "./detectIssues";
import { type AlertRow, planAlerts } from "./planAlerts";

const T0 = Date.parse("2026-10-11T12:00:00Z");
const H = 3_600_000;
const issue: Issue = {
  key: "http5xx:/api/x",
  severity: "critical",
  title: "Ручка /api/x",
  details: "4 ответа 5xx",
};
const at = (ms: number) => new Date(ms).toISOString();

describe("planAlerts", () => {
  it("новая проблема — уведомить сразу", () => {
    const plan = planAlerts([issue], [], T0, 2 * H);
    expect(plan.notify).toEqual([issue]);
    expect(plan.rows[0]).toMatchObject({
      status: "active",
      lastSent: at(T0),
      firstSeen: at(T0),
    });
  });

  it("та же проблема через 15 мин — молчим, через 2 ч — напоминаем", () => {
    const prev: AlertRow[] = planAlerts([issue], [], T0, 2 * H).rows;
    expect(planAlerts([issue], prev, T0 + 15 * 60_000, 2 * H).notify).toEqual(
      [],
    );
    const later = planAlerts([issue], prev, T0 + 2 * H, 2 * H);
    expect(later.notify).toEqual([issue]);
    expect(later.rows[0].firstSeen).toBe(at(T0));
  });

  it("пропала — один раз «восстановлено»", () => {
    const prev = planAlerts([issue], [], T0, 2 * H).rows;
    const plan = planAlerts([], prev, T0 + 15 * 60_000, 2 * H);
    expect(plan.resolved.map((r) => r.key)).toEqual([issue.key]);
    expect(plan.rows[0].status).toBe("resolved");
    expect(planAlerts([], plan.rows, T0 + 30 * 60_000, 2 * H).resolved).toEqual(
      [],
    );
  });

  it("вернулась после восстановления — снова новая", () => {
    const resolved = planAlerts(
      [],
      planAlerts([issue], [], T0, 2 * H).rows,
      T0 + 60_000,
      2 * H,
    ).rows;
    expect(planAlerts([issue], resolved, T0 + 120_000, 2 * H).notify).toEqual([
      issue,
    ]);
  });
});
