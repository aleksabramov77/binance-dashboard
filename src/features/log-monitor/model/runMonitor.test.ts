import { describe, expect, it, vi } from "vitest";
import type { MonitorSnapshot } from "../lib/detectIssues";
import type { AlertRow } from "../lib/planAlerts";
import { type MonitorDeps, runMonitor } from "./runMonitor";

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
    notify: async (t) => {
      sent.push(t);
    },
    prune: async () => 0,
    logsUrl: "https://example.test/logs",
    ...patch,
  };
  return { d, sent, rows: () => rows };
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

  it("всё спокойно — ничего не отправляет", async () => {
    const m = deps(snapshot([]));
    expect((await runMonitor(m.d, NOW)).sent).toBe(false);
    expect(m.sent).toEqual([]);
  });
});
