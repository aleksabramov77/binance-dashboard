import { describe, expect, it, vi } from "vitest";
import {
  type AnnounceDeps,
  actorLabel,
  announceEngineToggle,
  type EngineToggleEvent,
  engineToggleLogEntry,
  engineToggleNotice,
  engineToggleNoticeText,
  formatUtcTime,
} from "./engineToggleNotice";

const AT = new Date("2026-10-16T07:05:42.000Z");

const off = (over: Partial<EngineToggleEvent> = {}): EngineToggleEvent => ({
  enabled: false,
  by: "octocat",
  authEnabled: true,
  at: AT,
  exposure: { openPaper: 12, openDemo: 3 },
  ...over,
});

describe("кто переключил", () => {
  it("логин из сессии; без настроенного входа — «вход выключен»", () => {
    expect(actorLabel({ by: "octocat", authEnabled: true })).toBe("octocat");
    expect(actorLabel({ by: null, authEnabled: false })).toBe("вход выключен");
    expect(actorLabel({ by: null, authEnabled: true })).toBe(
      "логин неизвестен",
    );
  });

  it("время — UTC, 24 часа", () => {
    expect(formatUtcTime(new Date("2026-10-16T23:59:59.000Z"))).toBe(
      "23:59 UTC",
    );
    expect(formatUtcTime(AT)).toBe("07:05 UTC");
  });
});

describe("запись engine.toggle", () => {
  it("выключение: кто, origin ui и открытые позиции", () => {
    expect(engineToggleLogEntry(off())).toEqual({
      message: "Автоторговля выключена (octocat)",
      data: {
        enabled: false,
        by: "octocat",
        origin: "ui",
        openPaper: 12,
        openDemo: 3,
      },
    });
  });

  it("включение без входа: by = null, в сообщении «вход выключен», без чисел", () => {
    expect(
      engineToggleLogEntry(
        off({ enabled: true, by: null, authEnabled: false, exposure: null }),
      ),
    ).toEqual({
      message: "Автоторговля включена (вход выключен)",
      data: { enabled: true, by: null, origin: "ui" },
    });
  });

  it("выключение, подсчёт не удался — числа null", () => {
    expect(engineToggleLogEntry(off({ exposure: null })).data).toMatchObject({
      openPaper: null,
      openDemo: null,
    });
  });
});

describe("текст уведомления", () => {
  it("выключение — с числами открытых позиций", () => {
    expect(engineToggleNoticeText(off())).toBe(
      "⏸ Автоторговля выключена в 07:05 UTC (octocat). Открыто 12 paper-сделок и 3 демо-позиции — стопы и тейки не проверяются до включения.",
    );
  });

  it("выключение без чисел, если подсчёт не удался", () => {
    expect(engineToggleNoticeText(off({ exposure: null }))).toBe(
      "⏸ Автоторговля выключена в 07:05 UTC (octocat). Стопы и тейки открытых paper-сделок и демо-позиций не проверяются до включения.",
    );
  });

  it("включение", () => {
    expect(
      engineToggleNoticeText(
        off({ enabled: true, by: null, authEnabled: false, exposure: null }),
      ),
    ).toBe("▶️ Автоторговля включена в 07:05 UTC (вход выключен).");
  });
});

describe("уведомление при переключении (spec 0067)", () => {
  const deps = () => {
    const tasks: (() => Promise<void>)[] = [];
    const notify = vi.fn<AnnounceDeps["notify"]>(async (input) => ({
      category: input.category,
      urgent: input.urgent ?? false,
      status: "sent",
      channels: [],
    }));
    return {
      tasks,
      notify,
      defer: (task: () => Promise<void>) => {
        tasks.push(task);
      },
    };
  };

  it("одна запись engine.toggle с уведомлением «Лаборатория», тихо — после ответа", async () => {
    const d = deps();
    announceEngineToggle(off(), d);
    expect(d.notify).not.toHaveBeenCalled();
    await Promise.all(d.tasks.map((t) => t()));
    expect(d.notify).toHaveBeenCalledTimes(1);
    expect(d.notify).toHaveBeenCalledWith({
      level: "info",
      event: "engine.toggle",
      message: "Автоторговля выключена (octocat)",
      data: {
        enabled: false,
        by: "octocat",
        origin: "ui",
        openPaper: 12,
        openDemo: 3,
      },
      category: "lab",
      text: engineToggleNoticeText(off()),
    });
    // Тихо: срочность не задана.
    expect(d.notify.mock.calls[0][0].urgent).toBeUndefined();
  });

  it("вызов — без канала: ни Telegram, ни chat id, ни темы", () => {
    const input = engineToggleNotice(off({ enabled: true, exposure: null }));
    expect(JSON.stringify(input)).not.toMatch(/telegram|chat|thread/i);
    expect(input).toMatchObject({ category: "lab", event: "engine.toggle" });
  });
});
