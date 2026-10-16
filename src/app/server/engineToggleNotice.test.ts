import { describe, expect, it, vi } from "vitest";
import {
  actorLabel,
  announceEngineToggle,
  type EngineToggleEvent,
  engineToggleLogEntry,
  engineToggleTelegramText,
  formatUtcTime,
  notifyEngineToggle,
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

describe("текст в Telegram", () => {
  it("выключение — с числами открытых позиций", () => {
    expect(engineToggleTelegramText(off())).toBe(
      "⏸ Автоторговля выключена в 07:05 UTC (octocat). Открыто 12 paper-сделок и 3 демо-позиции — стопы и тейки не проверяются до включения.",
    );
  });

  it("выключение без чисел, если подсчёт не удался", () => {
    expect(engineToggleTelegramText(off({ exposure: null }))).toBe(
      "⏸ Автоторговля выключена в 07:05 UTC (octocat). Стопы и тейки открытых paper-сделок и демо-позиций не проверяются до включения.",
    );
  });

  it("включение", () => {
    expect(
      engineToggleTelegramText(
        off({ enabled: true, by: null, authEnabled: false, exposure: null }),
      ),
    ).toBe("▶️ Автоторговля включена в 07:05 UTC (вход выключен).");
  });
});

describe("отправка уведомления", () => {
  it("Telegram не настроен — ничего не шлём и не ругаемся", async () => {
    const onError = vi.fn();
    expect(await notifyEngineToggle("текст", null, onError)).toBe("skipped");
    expect(onError).not.toHaveBeenCalled();
  });

  it("шлёт текст как есть", async () => {
    const send = vi.fn(async () => undefined);
    expect(await notifyEngineToggle("текст", send, vi.fn())).toBe("sent");
    expect(send).toHaveBeenCalledWith("текст");
  });

  it("ошибка Telegram не пробрасывается, а уходит в onError", async () => {
    const error = new Error("Telegram sendMessage 400: chat not found");
    const onError = vi.fn();
    await expect(
      notifyEngineToggle(
        "текст",
        async () => {
          throw error;
        },
        onError,
      ),
    ).resolves.toBe("failed");
    expect(onError).toHaveBeenCalledWith(error);
  });
});

describe("журнал и уведомление при переключении", () => {
  const deps = (send: ((text: string) => Promise<void>) | null) => {
    const tasks: (() => Promise<void>)[] = [];
    return {
      tasks,
      info: vi.fn(),
      warn: vi.fn(),
      send,
      defer: (task: () => Promise<void>) => {
        tasks.push(task);
      },
    };
  };

  it("пишет engine.toggle сразу, а Telegram — отложенно", async () => {
    const send = vi.fn(async () => undefined);
    const d = deps(send);
    announceEngineToggle(off(), d);
    expect(d.info).toHaveBeenCalledWith(
      "engine.toggle",
      "Автоторговля выключена (octocat)",
      expect.objectContaining({ enabled: false, origin: "ui" }),
    );
    expect(send).not.toHaveBeenCalled();
    await Promise.all(d.tasks.map((t) => t()));
    expect(send).toHaveBeenCalledWith(engineToggleTelegramText(off()));
    expect(d.warn).not.toHaveBeenCalled();
  });

  it("сбой Telegram — warn engine.toggle.notify с текстом ошибки, без исключения", async () => {
    const d = deps(async () => {
      throw new Error("Telegram sendMessage 401: Unauthorized");
    });
    announceEngineToggle(off({ enabled: true, exposure: null }), d);
    await expect(Promise.all(d.tasks.map((t) => t()))).resolves.toBeDefined();
    expect(d.warn).toHaveBeenCalledWith(
      "engine.toggle.notify",
      expect.stringContaining("Telegram sendMessage 401: Unauthorized"),
      { enabled: true },
    );
  });

  it("Telegram не настроен — только запись в журнал", async () => {
    const d = deps(null);
    announceEngineToggle(off(), d);
    await Promise.all(d.tasks.map((t) => t()));
    expect(d.info).toHaveBeenCalledTimes(1);
    expect(d.warn).not.toHaveBeenCalled();
  });
});
