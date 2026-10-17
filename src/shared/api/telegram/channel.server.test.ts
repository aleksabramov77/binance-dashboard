import { describe, expect, it, vi } from "vitest";
import type { TelegramConfig } from "@/shared/config/env.server";
import type { Notification } from "@/shared/notify";
import {
  createTelegramChannel,
  type TelegramChannelDeps,
  type TelegramTopicPolicy,
  telegramMessageText,
} from "./channel.server";

// Telegram-канал (spec 0067, AC3): запрос — тема, звук, без темы; отправка — только production, не фикстуры; явная
// пробная команда — и вне production. Bot API не вызывается: send подменён.
const config: TelegramConfig = {
  token: "bot-token",
  chatId: "-1001234",
  ownerId: "42",
  webhookSecret: null,
};
const lab: TelegramTopicPolicy = {
  title: "🧪 Лаборатория",
  topicId: 14,
  enabled: true,
  sound: "urgent",
};
const note = (over: Partial<Notification> = {}): Notification => ({
  category: "lab",
  urgent: false,
  text: "▶️ Автоторговля включена",
  link: null,
  level: "info",
  event: "engine.toggle",
  fixture: false,
  test: false,
  ...over,
});

function channel(over: Partial<TelegramChannelDeps> = {}) {
  const send = vi.fn<NonNullable<TelegramChannelDeps["send"]>>(async () => {});
  const deps: TelegramChannelDeps = {
    config: () => config,
    policy: () => lab,
    send,
    nodeEnv: () => "production",
    ...over,
  };
  return { ch: createTelegramChannel(deps), send };
}

describe("Telegram-канал", () => {
  it("категория → тема (message_thread_id), не срочное — без звука; итог с запросом", async () => {
    const { ch, send } = channel();
    expect(await ch.deliver(note())).toEqual({
      status: "sent",
      target: {
        topic: "🧪 Лаборатория",
        topicId: 14,
        to: "-1001234",
        silent: true,
      },
    });
    expect(send).toHaveBeenCalledWith(
      "bot-token",
      "-1001234",
      "▶️ Автоторговля включена",
      { messageThreadId: 14, silent: true },
    );
  });

  it("срочное — со звуком; ссылка — строкой под текстом", async () => {
    const { ch, send } = channel();
    await ch.deliver(
      note({
        urgent: true,
        text: "⚠️ без защиты",
        link: "https://x.test/settings#live",
      }),
    );
    expect(send).toHaveBeenCalledWith(
      "bot-token",
      "-1001234",
      "⚠️ без защиты\nhttps://x.test/settings#live",
      { messageThreadId: 14, silent: false },
    );
  });

  it("у категории нет темы — сообщение в чат без темы", async () => {
    const { ch, send } = channel({ policy: () => ({ ...lab, topicId: null }) });
    const r = await ch.deliver(note());
    expect(r).toMatchObject({ status: "sent", target: { topicId: null } });
    expect(send.mock.calls[0][3]).toEqual({
      messageThreadId: null,
      silent: true,
    });
  });

  it("не production — не отправляет, но запрос (чат, тема, звук) в итоге", async () => {
    const { ch, send } = channel({ nodeEnv: () => "development" });
    expect(await ch.deliver(note({ urgent: true }))).toEqual({
      status: "skipped",
      reason: "не production",
      target: {
        topic: "🧪 Лаборатория",
        topicId: 14,
        to: "-1001234",
        silent: false,
      },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("фикстура — не отправляет и в production", async () => {
    const { ch, send } = channel();
    expect(await ch.deliver(note({ fixture: true }))).toMatchObject({
      status: "skipped",
      reason: "фикстура",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("явная пробная команда — отправляет и вне production", async () => {
    const { ch, send } = channel({ nodeEnv: () => undefined });
    expect((await ch.deliver(note({ test: true }))).status).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("Telegram не настроен — skipped с причиной, запрос без чата", async () => {
    const { ch, send } = channel({ config: () => null });
    expect(await ch.deliver(note({ test: true }))).toEqual({
      status: "skipped",
      reason: "Telegram не настроен (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)",
      target: { topic: "🧪 Лаборатория", topicId: 14, to: null, silent: true },
    });
    const noChat = channel({ config: () => ({ ...config, chatId: null }) });
    expect((await noChat.ch.deliver(note())).status).toBe("skipped");
    expect(send).not.toHaveBeenCalled();
    expect(noChat.send).not.toHaveBeenCalled();
  });

  it("политика: категория выключена — не отправлять; звук always / never — поверх срочности", async () => {
    const off = channel({ policy: () => ({ ...lab, enabled: false }) });
    expect(await off.ch.deliver(note())).toMatchObject({
      status: "skipped",
      reason: "категория выключена",
    });
    expect(off.send).not.toHaveBeenCalled();
    const loud = channel({ policy: () => ({ ...lab, sound: "always" }) });
    await loud.ch.deliver(note());
    expect(loud.send.mock.calls[0][3]).toMatchObject({ silent: false });
    const quiet = channel({ policy: async () => ({ ...lab, sound: "never" }) });
    await quiet.ch.deliver(note({ urgent: true }));
    expect(quiet.send.mock.calls[0][3]).toMatchObject({ silent: true });
  });

  it("сбой Bot API — failed с описанием Telegram", async () => {
    const { ch } = channel({
      send: async () => {
        throw new Error("Telegram sendMessage 400: message thread not found");
      },
    });
    expect(await ch.deliver(note())).toMatchObject({
      status: "failed",
      reason: "Telegram sendMessage 400: message thread not found",
      target: { topicId: 14 },
    });
  });
});

describe("telegramMessageText", () => {
  it("ссылка строкой ниже; без ссылки — только текст", () => {
    expect(telegramMessageText({ text: "a", link: "https://x" })).toBe(
      "a\nhttps://x",
    );
    expect(telegramMessageText({ text: "a", link: null })).toBe("a");
  });
});
