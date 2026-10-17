import { describe, expect, it, vi } from "vitest";
import type { NotifyStatus } from "@/shared/notify";
import type { MonitorSnapshot } from "../lib/detectIssues";
import type { AlertRow } from "../lib/planAlerts";
import { type MonitorAlert, type MonitorDeps, runMonitor } from "./runMonitor";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const snapshot = (
  paths: { path: string; window: number }[],
): MonitorSnapshot => ({
  now: NOW,
  errorsByEvent: [],
  http5xxByPath: paths,
  engine: null,
  cronFailures: [],
  earnLastAt: NOW,
});

function deps(snap: MonitorSnapshot, patch: Partial<MonitorDeps> = {}) {
  let rows: AlertRow[] = [];
  const sent: string[] = [];
  const alerts: MonitorAlert[] = [];
  const d: MonitorDeps = {
    collect: async () => snap,
    samples: async () => [
      { ts: "t", level: "error", event: "http", message: "GET /api/x → 500" },
    ],
    loadAlerts: async () => rows,
    saveAlerts: async (r) => {
      rows = r;
    },
    analyze: async () => "Упал Binance — проверьте ответы /api/x.",
    notify: async (alert) => {
      alerts.push(alert);
      sent.push(alert.text);
      return "sent";
    },
    prune: async () => 0,
    logsUrl: "https://example.test/logs",
    ...patch,
  };
  return { d, sent, alerts, rows: () => rows };
}

const X = { path: "/api/x", window: 5 };
const Y = { path: "/api/y", window: 5 };
const MIN = 60_000;

/** Монитор с общим состоянием на несколько прогонов: снимок и итог доставки — свои у каждого прогона. */
function monitor() {
  let rows: AlertRow[] = [];
  let paths: { path: string; window: number }[] = [];
  let status: NotifyStatus = "sent";
  const alerts: (MonitorAlert & { status: NotifyStatus })[] = [];
  const d: MonitorDeps = {
    collect: async (now) => ({ ...snapshot(paths), now, earnLastAt: now }),
    samples: async () => [],
    loadAlerts: async () => rows,
    saveAlerts: async (r) => {
      rows = r;
    },
    notify: async (alert) => {
      alerts.push({ ...alert, status });
      return status;
    },
    prune: async () => 0,
    logsUrl: null,
  };
  return {
    alerts,
    rows: () => rows,
    run: (
      current: { path: string; window: number }[],
      at: number,
      delivery: NotifyStatus = "sent",
    ) => {
      paths = current;
      status = delivery;
      return runMonitor(d, at);
    },
  };
}

describe("runMonitor", () => {
  it("проблема → разбор ИИ и одно сообщение; повтор через 15 мин — тишина", async () => {
    const m = deps(snapshot([{ path: "/api/x", window: 5 }]));
    const r = await runMonitor(m.d, NOW);
    expect(r).toMatchObject({ notified: 1, sent: true });
    expect(m.sent[0]).toContain("Ручка /api/x");
    expect(m.sent[0]).toContain("🤖 Упал Binance");
    await runMonitor(m.d, NOW + 15 * 60_000);
    expect(m.sent).toHaveLength(1);
  });

  it("ИИ упал — уведомление уходит без разбора", async () => {
    const m = deps(snapshot([{ path: "/api/x", window: 5 }]), {
      analyze: vi.fn().mockRejectedValue(new Error("402 нет кредитов")),
    });
    const r = await runMonitor(m.d, NOW);
    expect(r.analysisError).toContain("402");
    expect(m.sent[0]).not.toContain("🤖");
  });

  it("Telegram не настроен — состояние без lastSent, чтобы отправить позже", async () => {
    const m = deps(snapshot([{ path: "/api/x", window: 5 }]), {
      notify: undefined,
    });
    const r = await runMonitor(m.d, NOW);
    expect(r.sent).toBe(false);
    expect(m.rows()[0].lastSent).toBeNull();
  });

  it("срочность (spec 0067): новая тревога — со звуком, «восстановлено» — тихо; в уведомлении — ключи", async () => {
    const m = deps(snapshot([{ path: "/api/x", window: 5 }]));
    await runMonitor(m.d, NOW);
    expect(m.alerts[0]).toMatchObject({
      urgent: true,
      issues: ["http5xx:/api/x"],
      resolved: [],
    });
    const calm = deps(snapshot([]), { loadAlerts: async () => m.rows() });
    await runMonitor(calm.d, NOW + 15 * 60_000);
    expect(calm.alerts[0]).toMatchObject({
      urgent: false,
      issues: [],
      resolved: ["http5xx:/api/x"],
    });
  });

  it("уведомление не доставлено — состояние без lastSent, повтор в следующий прогон со звуком", async () => {
    const m = deps(snapshot([{ path: "/api/x", window: 5 }]), {
      notify: async () => "failed",
    });
    expect((await runMonitor(m.d, NOW)).sent).toBe(false);
    expect(m.rows()[0].lastSent).toBeNull();
    const retry = deps(snapshot([{ path: "/api/x", window: 5 }]), {
      loadAlerts: async () => m.rows(),
    });
    await runMonitor(retry.d, NOW + 15 * 60_000);
    expect(retry.alerts[0]).toMatchObject({ urgent: true });
  });

  it("«восстановлено» не доставлено (failed) — следующий прогон отправляет его снова (ревью PR #105)", async () => {
    const m = monitor();
    await m.run([X], NOW);
    expect((await m.run([], NOW + 15 * MIN, "failed")).sent).toBe(false);
    // Строка — как до прогона: тревога активна, «восстановлено» спланируется снова.
    expect(m.rows().map((r) => [r.key, r.status])).toEqual([
      ["http5xx:/api/x", "active"],
    ]);
    expect((await m.run([], NOW + 30 * MIN)).sent).toBe(true);
    await m.run([], NOW + 45 * MIN);
    expect(m.alerts.map((a) => [a.issues, a.resolved, a.status])).toEqual([
      [["http5xx:/api/x"], [], "sent"],
      [[], ["http5xx:/api/x"], "failed"],
      [[], ["http5xx:/api/x"], "sent"],
    ]);
  });

  it("тревога не доставлена (failed) — повтор со звуком; доставленная раньше — не дублируется", async () => {
    const m = monitor();
    await m.run([X], NOW);
    await m.run([X, Y], NOW + 15 * MIN, "failed");
    await m.run([X, Y], NOW + 30 * MIN);
    await m.run([X, Y], NOW + 45 * MIN);
    expect(m.alerts.map((a) => [a.issues, a.urgent, a.status])).toEqual([
      [["http5xx:/api/x"], true, "sent"],
      [["http5xx:/api/y"], true, "failed"],
      [["http5xx:/api/y"], true, "sent"],
    ]);
  });

  it("не отправлялось (skipped: не прод-сервер, канал не настроен) — обработано, без повторов каждые 15 мин", async () => {
    const m = monitor();
    await m.run([X], NOW, "skipped");
    await m.run([X], NOW + 15 * MIN, "skipped");
    await m.run([], NOW + 30 * MIN, "skipped");
    await m.run([], NOW + 45 * MIN, "skipped");
    expect(m.alerts.map((a) => [a.issues, a.resolved])).toEqual([
      [["http5xx:/api/x"], []],
      [[], ["http5xx:/api/x"]],
    ]);
  });

  it("всё спокойно — ничего не отправляет", async () => {
    const m = deps(snapshot([]));
    expect((await runMonitor(m.d, NOW)).sent).toBe(false);
    expect(m.sent).toEqual([]);
  });
});
