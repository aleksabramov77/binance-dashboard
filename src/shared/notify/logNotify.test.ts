import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushLogs,
  type LogEntry,
  log,
  setLogSink,
  setNotifyChannels,
} from "@/shared/lib/logger.server";
import type { Notification, NotifyChannel } from ".";

// Единый вызов логгера с уведомлением (spec 0067, AC1–AC2): запись идёт в приёмник, уведомление — в фиктивный канал.
const fakeChannel = (
  name: string,
  deliver: NotifyChannel["deliver"] = async () => ({ status: "sent" }),
) => ({ name, deliver: vi.fn(deliver) });

let got: LogEntry[];
beforeEach(() => {
  // Журнал в тестах выключен (VITEST) — включаем, без файлов (VERCEL) и без строк в консоли.
  vi.stubEnv("VITEST", "");
  vi.stubEnv("VERCEL", "1");
  for (const level of ["log", "warn", "error"] as const)
    vi.spyOn(console, level).mockImplementation(() => {});
  got = [];
  setLogSink(async (batch) => {
    got.push(...batch);
  });
});
afterEach(async () => {
  // Буфер приёмника общий на процесс — дописываем его в приёмник этого теста, чтобы не попал в следующий.
  await flushLogs();
  setLogSink(null);
  setNotifyChannels([]);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("log.notify", () => {
  it("одна запись и одно уведомление; текст — message, по умолчанию тихо; итог — в записи и в ответе", async () => {
    const channel = fakeChannel("test");
    setNotifyChannels([channel]);
    const r = await log.notify({
      level: "info",
      event: "engine.toggle",
      message: "Автоторговля выключена (octocat)",
      data: { enabled: false, apiKey: "secret" },
      category: "lab",
    });
    await flushLogs();
    expect(channel.deliver).toHaveBeenCalledTimes(1);
    expect(channel.deliver.mock.calls[0][0]).toEqual<Notification>({
      category: "lab",
      urgent: false,
      text: "Автоторговля выключена (octocat)",
      link: null,
      level: "info",
      event: "engine.toggle",
      fixture: false,
      test: false,
    });
    expect(r).toEqual({
      category: "lab",
      urgent: false,
      status: "sent",
      channels: [{ channel: "test", status: "sent" }],
    });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      level: "info",
      event: "engine.toggle",
      message: "Автоторговля выключена (octocat)",
      // Секреты маскируются, как у обычных записей.
      data: { enabled: false, apiKey: "***" },
      notify: r,
    });
  });

  it("text, link, urgent, fixture и test доходят до канала", async () => {
    const channel = fakeChannel("test");
    setNotifyChannels([channel]);
    await log.notify({
      level: "error",
      event: "live.unprotected",
      message: "без защиты",
      category: "trades",
      urgent: true,
      text: "Binance Dashboard · без защиты",
      link: "https://example.test/settings#live",
      fixture: true,
      test: true,
    });
    expect(channel.deliver.mock.calls[0][0]).toMatchObject({
      urgent: true,
      text: "Binance Dashboard · без защиты",
      link: "https://example.test/settings#live",
      fixture: true,
      test: true,
    });
  });

  it("второй канал добавляется без правок вызова: оба получают уведомление, итог — по каждому", async () => {
    const telegram = fakeChannel("telegram");
    const mail = fakeChannel("mail", async () => ({
      status: "skipped",
      reason: "не настроен",
    }));
    setNotifyChannels([telegram, mail]);
    const r = await log.notify({
      level: "warn",
      event: "monitor.db_space",
      message: "≤ 20 %",
      category: "server",
      urgent: true,
    });
    expect(telegram.deliver).toHaveBeenCalledTimes(1);
    expect(mail.deliver).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({
      status: "sent",
      channels: [
        { channel: "telegram", status: "sent" },
        { channel: "mail", status: "skipped", reason: "не настроен" },
      ],
    });
  });

  it("канал не подключён — skipped «канал не подключён», запись есть", async () => {
    const r = await log.notify({
      level: "info",
      event: "mirror.auto",
      message: "S98 → демо-зеркало включено",
      category: "lab",
    });
    await flushLogs();
    expect(r).toMatchObject({
      status: "skipped",
      reason: "канал не подключён",
    });
    expect(got.map((e) => [e.event, e.notify?.status])).toEqual([
      ["mirror.auto", "skipped"],
    ]);
  });

  it("сбой канала — failed с причиной в записи и warn notify.failed; исключение канала — тоже failed", async () => {
    setNotifyChannels([
      fakeChannel("telegram", async () => ({
        status: "failed",
        reason: "Telegram sendMessage 400: chat not found",
      })),
      fakeChannel("mail", async () => {
        throw new Error("SMTP недоступен");
      }),
    ]);
    const r = await log.notify({
      level: "warn",
      event: "monitor.alert",
      message: "Тревога монитора: http5xx:/api/x",
      category: "errors",
      urgent: true,
    });
    await flushLogs();
    expect(r).toMatchObject({
      status: "failed",
      reason:
        "telegram: Telegram sendMessage 400: chat not found; mail: SMTP недоступен",
    });
    expect(got.map((e) => [e.level, e.event])).toEqual([
      ["warn", "monitor.alert"],
      ["warn", "notify.failed"],
      ["warn", "notify.failed"],
    ]);
    expect(got[1]).toMatchObject({
      message:
        "Уведомление monitor.alert не доставлено (telegram): Telegram sendMessage 400: chat not found",
      data: { event: "monitor.alert", category: "errors", channel: "telegram" },
    });
  });

  it("доставлено не туда, куда просили (тема не найдена) — sent и warn notify.fallback с категорией", async () => {
    setNotifyChannels([
      fakeChannel("telegram", async () => ({
        status: "sent",
        note: "тема 12 не найдена — отправлено в чат без темы",
      })),
    ]);
    const r = await log.notify({
      level: "error",
      event: "live.unprotected",
      message: "без защиты",
      category: "trades",
      urgent: true,
    });
    await flushLogs();
    expect(r.status).toBe("sent");
    expect(got.map((e) => [e.level, e.event])).toEqual([
      ["error", "live.unprotected"],
      ["warn", "notify.fallback"],
    ]);
    expect(got[1]).toMatchObject({
      message:
        "Уведомление live.unprotected (telegram): тема 12 не найдена — отправлено в чат без темы",
      data: {
        event: "live.unprotected",
        category: "trades",
        channel: "telegram",
      },
    });
  });

  it("skip — каналы не вызываются, причина в записи", async () => {
    const channel = fakeChannel("test");
    setNotifyChannels([channel]);
    const r = await log.notify({
      level: "error",
      event: "live.close_failed",
      message: "не закрылась",
      category: "trades",
      urgent: true,
      skip: "повтор (сообщение было)",
    });
    expect(channel.deliver).not.toHaveBeenCalled();
    expect(r).toMatchObject({
      status: "skipped",
      reason: "повтор (сообщение было)",
      urgent: true,
    });
  });

  it("старые log.info/warn/error — без изменений: запись без поля notify, канал не вызывается", async () => {
    const channel = fakeChannel("test");
    setNotifyChannels([channel]);
    log.info("b", "инфо", { x: 1 });
    log.warn("c", "предупреждение");
    log.error("d", "ошибка", undefined, new Error("сбой"));
    await flushLogs();
    expect(channel.deliver).not.toHaveBeenCalled();
    expect(got.map((e) => e.event)).toEqual(["b", "c", "d"]);
    expect(got.every((e) => !("notify" in e))).toBe(true);
    expect(got[2].error?.message).toBe("сбой");
  });
});
