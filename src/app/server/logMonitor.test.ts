import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log, setNotifyChannels } from "@/shared/lib/logger.server";
import type { NotifyChannel } from "@/shared/notify";
import { notifyAlert, sendMonitorTest } from "./logMonitor";

// Уведомления монитора журнала (spec 0067): категория «Ошибки», новая тревога — со звуком, пробное — явная команда.
vi.mock("@/shared/lib/logger.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/shared/lib/logger.server")>();
  return {
    ...actual,
    log: { ...actual.log, notify: vi.fn(actual.log.notify) },
  };
});

const channel = {
  name: "test",
  deliver: vi.fn<NotifyChannel["deliver"]>(),
};

beforeEach(() => {
  channel.deliver.mockReset();
  channel.deliver.mockImplementation(async () => ({ status: "sent" }));
  setNotifyChannels([channel]);
  vi.stubEnv("SITE_URL", "https://binance.example.test");
});
afterEach(() => {
  setNotifyChannels([]);
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("notifyAlert", () => {
  it("тревога — запись monitor.alert (warn) с уведомлением «Ошибки»; ответ — итог доставки", async () => {
    expect(
      await notifyAlert({
        text: "⚠️ Binance Dashboard: проблема",
        urgent: true,
        issues: ["http5xx:/api/x"],
        resolved: [],
      }),
    ).toBe("sent");
    expect(vi.mocked(log.notify).mock.calls[0][0]).toEqual({
      level: "warn",
      event: "monitor.alert",
      message: "Тревога монитора: http5xx:/api/x",
      data: { issues: ["http5xx:/api/x"], resolved: [] },
      category: "errors",
      urgent: true,
      text: "⚠️ Binance Dashboard: проблема",
    });
  });

  it("только «восстановлено» — info, тихо; не доставлено — failed (монитор повторит)", async () => {
    channel.deliver.mockResolvedValueOnce({ status: "failed", reason: "502" });
    expect(
      await notifyAlert({
        text: "✅ Восстановлено: Ручка /api/x",
        urgent: false,
        issues: [],
        resolved: ["http5xx:/api/x"],
      }),
    ).toBe("failed");
    expect(vi.mocked(log.notify).mock.calls[0][0]).toMatchObject({
      level: "info",
      message: "Монитор: восстановлено — http5xx:/api/x",
      urgent: false,
    });
  });
});

describe("sendMonitorTest", () => {
  it("явная пробная команда: «Ошибки», тихо, текст и ссылка как раньше", async () => {
    expect(await sendMonitorTest()).toEqual({ sent: true });
    expect(channel.deliver.mock.calls[0][0]).toMatchObject({
      category: "errors",
      urgent: false,
      test: true,
      text: "✅ Binance Dashboard: уведомления работают. Монитор проверяет журнал каждые 15 минут.",
      link: "https://binance.example.test/logs",
    });
  });

  it("не отправлено — причина в ответе", async () => {
    channel.deliver.mockResolvedValueOnce({
      status: "skipped",
      reason: "Telegram не настроен (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)",
    });
    expect(await sendMonitorTest()).toEqual({
      sent: false,
      reason: "Telegram не настроен (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)",
    });
  });
});
