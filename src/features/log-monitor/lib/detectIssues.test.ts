import { describe, expect, it } from "vitest";
import { detectIssues, type MonitorSnapshot } from "./detectIssues";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const base = (patch: Partial<MonitorSnapshot> = {}): MonitorSnapshot => ({
  now: NOW,
  errorsByEvent: [],
  http5xxByPath: [],
  engine: { enabled: true, lastTickAt: NOW - 60_000, lastErrors: 0 },
  cronFailures: [],
  earnLastAt: NOW - 3_600_000,
  ...patch,
});
const keys = (s: MonitorSnapshot) => detectIssues(s).map((i) => i.key);

describe("detectIssues", () => {
  it("всё спокойно — проблем нет", () => {
    expect(keys(base())).toEqual([]);
  });

  it("ручка сыпет 5xx — критично", () => {
    const issues = detectIssues(
      base({ http5xxByPath: [{ path: "/api/earn", window: 4 }] }),
    );
    expect(issues).toMatchObject([
      { key: "http5xx:/api/earn", severity: "critical" },
    ]);
  });

  it("всплеск ошибок события — только выше обычного уровня", () => {
    // Обычно ~96 за сутки = 1 за окно: 5 — всплеск.
    expect(
      keys(
        base({
          errorsByEvent: [
            { event: "binance.request", window: 5, baseline: 96 },
          ],
        }),
      ),
    ).toEqual(["errors:binance.request"]);
    // Обычно ~4 за окно: 5 — не всплеск.
    expect(
      keys(
        base({
          errorsByEvent: [
            { event: "binance.request", window: 5, baseline: 384 },
          ],
        }),
      ),
    ).toEqual([]);
    // Событие http покрыто правилом 5xx.
    expect(
      keys(
        base({ errorsByEvent: [{ event: "http", window: 50, baseline: 0 }] }),
      ),
    ).toEqual([]);
  });

  it("движок включён и не тикает; выключен — не проблема", () => {
    expect(
      keys(
        base({
          engine: {
            enabled: true,
            lastTickAt: NOW - 10 * 60_000,
            lastErrors: 0,
          },
        }),
      ),
    ).toEqual(["engine:stalled"]);
    expect(
      keys(
        base({ engine: { enabled: true, lastTickAt: null, lastErrors: 0 } }),
      ),
    ).toEqual(["engine:stalled"]);
    expect(
      keys(
        base({ engine: { enabled: false, lastTickAt: null, lastErrors: 0 } }),
      ),
    ).toEqual([]);
    expect(
      keys(base({ engine: { enabled: true, lastTickAt: NOW, lastErrors: 2 } })),
    ).toEqual(["engine:errors"]);
  });

  it("упавший cron и старый снимок Earn", () => {
    expect(
      keys(
        base({
          cronFailures: [
            { job: "earn-snapshot", failed: 1, lastMessage: "timeout" },
          ],
          earnLastAt: NOW - 20 * 3_600_000,
        }),
      ),
    ).toEqual(["cron:earn-snapshot", "earn:stale"]);
  });
});
