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
  invalidOwnerId: null,
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
  thread: null,
  ...over,
});

function channel(over: Partial<TelegramChannelDeps> = {}) {
  const send = vi.fn<NonNullable<TelegramChannelDeps["send"]>>(async () => ({
    messageId: null,
    replied: false,
  }));
  const deps: TelegramChannelDeps = {
    config: () => config,
    policy: () => lab,
    send,
    host: () => ({ production: true, server: true }),
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
    const { ch, send } = channel({
      host: () => ({ production: false, server: false }),
    });
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

  it("локальная прод-сборка (APP_HOST не vm) — не отправляет (ревью PR #105)", async () => {
    const { ch, send } = channel({
      host: () => ({ production: true, server: false }),
    });
    expect(await ch.deliver(note())).toMatchObject({
      status: "skipped",
      reason: "не прод-сервер: production-сборка вне VM (APP_HOST ≠ vm)",
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
    const { ch, send } = channel({
      host: () => ({ production: false, server: false }),
    });
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

  it("тема удалена (message thread not found) — один повтор в чат без темы, с отметкой (ревью PR #105)", async () => {
    const send = vi
      .fn<NonNullable<TelegramChannelDeps["send"]>>()
      .mockRejectedValueOnce(
        new Error(
          "Telegram sendMessage 400: Bad Request: message thread not found",
        ),
      )
      .mockResolvedValueOnce({ messageId: null, replied: false });
    const { ch } = channel({ send });
    expect(await ch.deliver(note({ urgent: true }))).toEqual({
      status: "sent",
      target: {
        topic: "🧪 Лаборатория",
        topicId: null,
        to: "-1001234",
        silent: false,
      },
      note: "тема 14 не найдена — отправлено в чат без темы",
    });
    expect(send.mock.calls.map((c) => c[3])).toEqual([
      { messageThreadId: 14, silent: false },
      { messageThreadId: null, silent: false },
    ]);
  });

  it("тема удалена, и без темы не ушло — failed с обеими причинами; другие ошибки — без повтора", async () => {
    const gone = new Error(
      "Telegram sendMessage 400: Bad Request: message thread not found",
    );
    const twice = channel({
      send: vi
        .fn<NonNullable<TelegramChannelDeps["send"]>>()
        .mockRejectedValueOnce(gone)
        .mockRejectedValueOnce(
          new Error("Telegram sendMessage 403: Forbidden"),
        ),
    });
    expect(await twice.ch.deliver(note())).toMatchObject({
      status: "failed",
      reason:
        "Telegram sendMessage 400: Bad Request: message thread not found; без темы — Telegram sendMessage 403: Forbidden",
    });
    const forbidden = vi
      .fn<NonNullable<TelegramChannelDeps["send"]>>()
      .mockRejectedValue(new Error("Telegram sendMessage 403: Forbidden"));
    await channel({ send: forbidden }).ch.deliver(note());
    expect(forbidden).toHaveBeenCalledTimes(1);
    const noTopic = channel({
      policy: () => ({ ...lab, topicId: null }),
      send: vi
        .fn<NonNullable<TelegramChannelDeps["send"]>>()
        .mockRejectedValue(gone),
    });
    expect((await noTopic.ch.deliver(note())).status).toBe("failed");
  });

  it("сбой Bot API — failed с описанием Telegram", async () => {
    const { ch } = channel({
      send: async () => {
        throw new Error(
          "Telegram sendMessage 403: Forbidden: bot was kicked from the supergroup chat",
        );
      },
    });
    expect(await ch.deliver(note())).toMatchObject({
      status: "failed",
      reason:
        "Telegram sendMessage 403: Forbidden: bot was kicked from the supergroup chat",
      target: { topicId: 14 },
    });
  });
});

describe("Telegram-канал: ответ, дописать, отметка (spec 0068)", () => {
  const trades: TelegramTopicPolicy = {
    title: "💰 Сделки",
    topicId: 5,
    enabled: true,
    sound: "urgent",
  };
  const entryRef = {
    chatId: "-1001234",
    messageId: 70,
    text: "🟡 Вход · S98 BTCUSDT long · USDⓈ-M\nhttps://x.test/experiments/S98",
  };
  const exitNote = (thread: Partial<NonNullable<Notification["thread"]>>) =>
    note({
      category: "trades",
      urgent: true,
      text: "🟢 +$0,84 · S98 BTCUSDT long",
      event: "live.exit",
      thread: {
        ref: entryRef,
        label: "сообщение о входе",
        reply: true,
        append: "Итог: 🟢 +$0,84 (TP)",
        mark: "good",
        ...thread,
      },
    });
  function tradesChannel(over: Partial<TelegramChannelDeps> = {}) {
    const send = vi.fn<NonNullable<TelegramChannelDeps["send"]>>(
      async (_t, _c, _text, o) => ({
        messageId: 71,
        replied: o?.replyTo != null,
      }),
    );
    const edit = vi.fn<NonNullable<TelegramChannelDeps["edit"]>>(
      async () => {},
    );
    const react = vi.fn<NonNullable<TelegramChannelDeps["react"]>>(
      async () => {},
    );
    const ch = createTelegramChannel({
      config: () => config,
      policy: () => trades,
      send,
      edit,
      react,
      host: () => ({ production: true, server: true }),
      ...over,
    });
    return { ch, send, edit, react };
  }

  it("итог — ответом на вход; вход дописан строкой итога и отмечен 👍; ключ нового сообщения — в ответе", async () => {
    const { ch, send, edit, react } = tradesChannel();
    expect(await ch.deliver(exitNote({}))).toEqual({
      status: "sent",
      target: { topic: "💰 Сделки", topicId: 5, to: "-1001234", silent: false },
      reply: "ответ на сообщение о входе",
      amend: "дописано, отметка 👍",
      ref: {
        chatId: "-1001234",
        messageId: 71,
        text: "🟢 +$0,84 · S98 BTCUSDT long",
      },
    });
    expect(send.mock.calls[0][3]).toEqual({
      messageThreadId: 5,
      silent: false,
      replyTo: 70,
    });
    expect(edit).toHaveBeenCalledWith(
      "bot-token",
      "-1001234",
      70,
      `${entryRef.text}\nИтог: 🟢 +$0,84 (TP)`,
    );
    expect(react).toHaveBeenCalledWith("bot-token", "-1001234", 70, "👍");
  });

  it("убыток — отметка 👎; без отметки (PnL неизвестен) — реакции нет", async () => {
    const bad = tradesChannel();
    await bad.ch.deliver(exitNote({ mark: "bad" }));
    expect(bad.react.mock.calls[0][3]).toBe("👎");
    const none = tradesChannel();
    expect(await none.ch.deliver(exitNote({ mark: null }))).toMatchObject({
      amend: "дописано",
    });
    expect(none.react).not.toHaveBeenCalled();
  });

  it("номер входа не известен — обычное сообщение, «без ответа», дописывать нечего (AC6)", async () => {
    const { ch, send, edit, react } = tradesChannel();
    expect(await ch.deliver(exitNote({ ref: null }))).toMatchObject({
      status: "sent",
      reply: "без ответа: сообщение о входе не известно",
      amendError: "сообщение о входе не известно — не к чему дописать",
    });
    expect(send.mock.calls[0][3]).not.toHaveProperty("replyTo");
    expect(edit).not.toHaveBeenCalled();
    expect(react).not.toHaveBeenCalled();
    // Ключ другого чата или не того формата — тоже не известен.
    const other = tradesChannel();
    await other.ch.deliver(exitNote({ ref: { ...entryRef, chatId: "-999" } }));
    await other.ch.deliver(exitNote({ ref: { message_id: 70 } }));
    expect(other.send.mock.calls.map((c) => c[3]?.replyTo)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("сообщение о входе удалено — Telegram отправил без ответа: так и записано", async () => {
    const { ch } = tradesChannel({
      send: async () => ({ messageId: 72, replied: false }),
      edit: async () => {
        throw new Error(
          "Telegram editMessageText 400: message to edit not found",
        );
      },
      react: async () => {
        throw new Error("Telegram setMessageReaction 400: message not found");
      },
    });
    expect(await ch.deliver(exitNote({}))).toMatchObject({
      status: "sent",
      reply: "без ответа: сообщение о входе не найдено",
      amendError:
        "не дописано: Telegram editMessageText 400: message to edit not found; без отметки 👍: Telegram setMessageReaction 400: message not found",
    });
  });

  it("сбой правки не мешает итогу: отправлено, отметка поставлена, причина — в amendError (AC5)", async () => {
    const { ch, react } = tradesChannel({
      edit: async () => {
        throw new Error(
          "Telegram editMessageText 400: message can't be edited",
        );
      },
    });
    expect(await ch.deliver(exitNote({}))).toMatchObject({
      status: "sent",
      reply: "ответ на сообщение о входе",
      amend: "отметка 👍",
      amendError:
        "не дописано: Telegram editMessageText 400: message can't be edited",
    });
    expect(react).toHaveBeenCalledTimes(1);
  });

  it("не production — ничего не шлёт и не правит, но в итоге видно, что это был бы ответ", async () => {
    const { ch, send, edit, react } = tradesChannel({
      host: () => ({ production: false, server: false }),
    });
    expect(await ch.deliver(exitNote({}))).toMatchObject({
      status: "skipped",
      reason: "не production",
      reply: "ответ на сообщение о входе",
    });
    expect(send).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
    expect(react).not.toHaveBeenCalled();
  });

  it("только ответ (тревога «не закрылась») — без правки и отметки", async () => {
    const { ch, edit, react } = tradesChannel();
    const r = await ch.deliver(exitNote({ append: null, mark: null }));
    expect(r).toMatchObject({ reply: "ответ на сообщение о входе" });
    expect(r).not.toHaveProperty("amend");
    expect(r).not.toHaveProperty("amendError");
    expect(edit).not.toHaveBeenCalled();
    expect(react).not.toHaveBeenCalled();
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
