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
  replaces: null,
  links: [],
  html: null,
  ...over,
});

function channel(over: Partial<TelegramChannelDeps> = {}) {
  const send = vi.fn<NonNullable<TelegramChannelDeps["send"]>>(async () => ({
    messageId: null,
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
      .mockResolvedValueOnce({ messageId: null });
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

describe("Telegram-канал: замена карточки (spec 0068, вариант B)", () => {
  const trades: TelegramTopicPolicy = {
    title: "💰 Сделки",
    topicId: 5,
    enabled: true,
    sound: "urgent",
  };
  const oldRef = {
    chatId: "-1001234",
    messageId: 70,
    text: "🟡 Открыта · S98 BTCUSDT long · USDⓈ-M\nhttps://x.test/experiments/S98",
  };
  const card = (ref: unknown = oldRef, over: Partial<Notification> = {}) =>
    note({
      category: "trades",
      urgent: true,
      text: "🟢 +$0,84 · S98 BTCUSDT long · USDⓈ-M",
      event: "live.exit",
      replaces: { ref, label: "карточка" },
      ...over,
    });
  function cardChannel(over: Partial<TelegramChannelDeps> = {}) {
    const calls: string[] = [];
    const send = vi.fn<NonNullable<TelegramChannelDeps["send"]>>(async () => {
      calls.push("send");
      return { messageId: 71 };
    });
    const remove = vi.fn<NonNullable<TelegramChannelDeps["remove"]>>(
      async () => {
        calls.push("delete");
      },
    );
    const edit = vi.fn<NonNullable<TelegramChannelDeps["edit"]>>(async () => {
      calls.push("edit");
    });
    const ch = createTelegramChannel({
      config: () => config,
      policy: () => trades,
      send,
      remove,
      edit,
      host: () => ({ production: true, server: true }),
      ...over,
    });
    return { ch, send, remove, edit, calls };
  }

  it("сначала новая карточка, потом удаление прежней; ключ — новой (B2)", async () => {
    const { ch, remove, edit, calls } = cardChannel();
    expect(await ch.deliver(card())).toEqual({
      status: "sent",
      target: { topic: "💰 Сделки", topicId: 5, to: "-1001234", silent: false },
      replaced: "карточка заменена",
      ref: {
        chatId: "-1001234",
        messageId: 71,
        text: "🟢 +$0,84 · S98 BTCUSDT long · USDⓈ-M",
        html: false,
      },
    });
    expect(calls).toEqual(["send", "delete"]);
    expect(remove).toHaveBeenCalledWith("bot-token", "-1001234", 70);
    expect(edit).not.toHaveBeenCalled();
  });

  it("тихая карточка (⏳/🟡) — disable_notification, замена та же", async () => {
    const { ch, send, calls } = cardChannel();
    await ch.deliver(card(oldRef, { urgent: false }));
    expect(send.mock.calls[0][3]).toEqual({ messageThreadId: 5, silent: true });
    expect(calls).toEqual(["send", "delete"]);
  });

  it("прежней уже нет (удалили) — без ошибки: записано, warn не нужен (B3)", async () => {
    const { ch } = cardChannel({
      remove: async () => {
        throw new Error(
          "Telegram deleteMessage 400: Bad Request: message to delete not found",
        );
      },
    });
    const r = await ch.deliver(card());
    expect(r).toMatchObject({
      status: "sent",
      replaced: "карточка заменена (прежней уже нет)",
    });
    expect(r).not.toHaveProperty("replaceError");
  });

  it("старше 48 ч — не удалить: к прежней дописано «⤵️ обновлено ниже», причина — в replaceError (B3)", async () => {
    const { ch, edit } = cardChannel({
      remove: async () => {
        throw new Error(
          "Telegram deleteMessage 400: Bad Request: message can't be deleted",
        );
      },
    });
    const r = await ch.deliver(card());
    expect(r).toMatchObject({
      status: "sent",
      replaceError:
        "прежняя карточка не удалена: Telegram deleteMessage 400: Bad Request: message can't be deleted; дописано «⤵️ обновлено ниже»",
    });
    expect(edit).toHaveBeenCalledWith(
      "bot-token",
      "-1001234",
      70,
      `${oldRef.text}\n⤵️ обновлено ниже`,
      { html: false },
    );
  });

  it("старше 48 ч и дописать не вышло — тоже без исключения, новая карточка отправлена", async () => {
    const { ch } = cardChannel({
      remove: async () => {
        throw new Error("Telegram deleteMessage 400: message can't be deleted");
      },
      edit: async () => {
        throw new Error(
          "Telegram editMessageText 400: message to edit not found",
        );
      },
    });
    expect(await ch.deliver(card())).toMatchObject({
      status: "sent",
      replaceError: expect.stringMatching(
        /не удалена: .*; «⤵️ обновлено ниже» не дописано: Telegram editMessageText 400/,
      ),
      ref: { messageId: 71 },
    });
  });

  it("нет прав и прочие сбои удаления — replaceError, без правки", async () => {
    const { ch, edit } = cardChannel({
      remove: async () => {
        throw new Error(
          "Telegram deleteMessage 403: Forbidden: not enough rights",
        );
      },
    });
    expect(await ch.deliver(card())).toMatchObject({
      status: "sent",
      replaceError:
        "прежняя карточка не удалена: Telegram deleteMessage 403: Forbidden: not enough rights",
    });
    expect(edit).not.toHaveBeenCalled();
  });

  it("ключа прежней нет (сделка до 0068) или ключ чужой — просто новая карточка (B4)", async () => {
    for (const ref of [null, { ...oldRef, chatId: "-999" }, { id: 70 }]) {
      const { ch, remove } = cardChannel();
      expect(await ch.deliver(card(ref))).toMatchObject({
        status: "sent",
        replaced: "карточка новая — прежней нет",
      });
      expect(remove).not.toHaveBeenCalled();
    }
  });

  it("новая не ушла — прежнюю не трогаем", async () => {
    const { ch, remove } = cardChannel({
      send: async () => {
        throw new Error("Telegram sendMessage 403: Forbidden");
      },
    });
    expect((await ch.deliver(card())).status).toBe("failed");
    expect(remove).not.toHaveBeenCalled();
  });

  it("не production — ничего не шлёт и не удаляет, но видно, что заменила бы", async () => {
    const { ch, send, remove } = cardChannel({
      host: () => ({ production: false, server: false }),
    });
    expect(await ch.deliver(card())).toMatchObject({
      status: "skipped",
      reason: "не production",
      replaced: "карточка заменила бы прежнюю",
    });
    expect(send).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("HTML и ссылки-кнопки (spec 0068, вид — версия 3)", () => {
  it("links — один ряд кнопок, primary — синяя; ссылка в тексте не дублируется; html — parse_mode", async () => {
    const send = vi.fn<NonNullable<TelegramChannelDeps["send"]>>(async () => ({
      messageId: 5,
    }));
    const { ch } = channel({ send });
    const r = await ch.deliver(
      note({
        text: "BTC/USDT",
        html: "<b>BTC/USDT</b>",
        link: "https://x.test/experiments/S98",
        links: [
          { label: "📊 Эксперимент", url: "https://x.test/experiments/S98" },
          {
            label: "✍️ Выставить вручную на Binance",
            url: "https://www.binance.com/en/futures/BTCUSDT",
            kind: "primary",
          },
        ],
      }),
    );
    expect(send.mock.calls[0][2]).toBe("<b>BTC/USDT</b>");
    expect(send.mock.calls[0][3]).toEqual({
      messageThreadId: 14,
      silent: true,
      html: true,
      buttons: [
        [
          { text: "📊 Эксперимент", url: "https://x.test/experiments/S98" },
          {
            text: "✍️ Выставить вручную на Binance",
            url: "https://www.binance.com/en/futures/BTCUSDT",
            style: "primary",
          },
        ],
      ],
    });
    expect(r.ref).toMatchObject({ html: true, text: "<b>BTC/USDT</b>" });
  });

  it("без кнопок — ссылка текстом (в HTML — с экранированным &)", () => {
    expect(
      telegramMessageText({
        text: "a",
        link: "https://x/?a=1&b=2",
        html: "<b>a</b>",
      }),
    ).toBe("<b>a</b>\nhttps://x/?a=1&amp;b=2");
    expect(
      telegramMessageText({
        text: "a",
        link: "https://x",
        links: [{ label: "x", url: "https://x" }],
      }),
    ).toBe("a");
  });

  it("«⤵️ обновлено ниже» к HTML-карточке — с тем же parse_mode", async () => {
    const edit = vi.fn<NonNullable<TelegramChannelDeps["edit"]>>(
      async () => {},
    );
    const { ch } = channel({
      send: async () => ({ messageId: 9 }),
      remove: async () => {
        throw new Error("Telegram deleteMessage 400: message can't be deleted");
      },
      edit,
    });
    await ch.deliver(
      note({
        replaces: {
          ref: {
            chatId: "-1001234",
            messageId: 3,
            text: "<b>old</b>",
            html: true,
          },
          label: "карточка",
        },
      }),
    );
    expect(edit).toHaveBeenCalledWith(
      "bot-token",
      "-1001234",
      3,
      "<b>old</b>\n⤵️ обновлено ниже",
      { html: true },
    );
  });
});

describe("запасной вид: Telegram не принял разметку или кнопки (ревью PR #106)", () => {
  const card = (over: Partial<Notification> = {}) =>
    note({
      category: "trades",
      urgent: true,
      text: "⚠️ 📈 LONG\nBTC/USDT · USDⓈ-M · S98",
      html: "⚠️ 📈 LONG\n<b>BTC/USDT</b> · USDⓈ-M · S98",
      link: "https://x.test/experiments/S98",
      links: [
        { label: "📊 Эксперимент", url: "https://x.test/experiments/S98" },
      ],
      ...over,
    });

  it("400 на HTML/кнопках — один повтор простым текстом без кнопок, ссылка строкой; отметка для warn notify.fallback", async () => {
    const send = vi
      .fn<NonNullable<TelegramChannelDeps["send"]>>()
      .mockRejectedValueOnce(
        new Error("Telegram sendMessage 400: Bad Request: BUTTON_URL_INVALID"),
      )
      .mockResolvedValueOnce({ messageId: 8 });
    const { ch } = channel({ send });
    const r = await ch.deliver(card());
    expect(send.mock.calls[1][2]).toBe(
      "⚠️ 📈 LONG\nBTC/USDT · USDⓈ-M · S98\nhttps://x.test/experiments/S98",
    );
    expect(send.mock.calls[1][3]).toEqual({
      messageThreadId: 14,
      silent: false,
    });
    expect(r).toMatchObject({
      status: "sent",
      note: "разметка или кнопки не приняты (Telegram sendMessage 400: Bad Request: BUTTON_URL_INVALID) — отправлено простым текстом",
      ref: { messageId: 8, html: false },
    });
  });

  it("тема удалена и разметку не приняли — обе замены, карточка всё равно ушла", async () => {
    const send = vi
      .fn<NonNullable<TelegramChannelDeps["send"]>>()
      .mockRejectedValueOnce(
        new Error("Telegram sendMessage 400: message thread not found"),
      )
      .mockRejectedValueOnce(
        new Error("Telegram sendMessage 400: can't parse entities"),
      )
      .mockResolvedValueOnce({ messageId: 9 });
    const { ch } = channel({ send });
    const r = await ch.deliver(card());
    expect(send).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({
      status: "sent",
      target: { topicId: null },
      note: expect.stringMatching(
        /^тема 14 не найдена — отправлено в чат без темы; разметка или кнопки не приняты/,
      ),
    });
  });

  it("не 400 (403, сеть) — без повтора простым текстом; простой текст без кнопок — тоже без повтора", async () => {
    const forbidden = vi
      .fn<NonNullable<TelegramChannelDeps["send"]>>()
      .mockRejectedValue(new Error("Telegram sendMessage 403: Forbidden"));
    expect((await channel({ send: forbidden }).ch.deliver(card())).status).toBe(
      "failed",
    );
    expect(forbidden).toHaveBeenCalledTimes(1);
    const bad = vi
      .fn<NonNullable<TelegramChannelDeps["send"]>>()
      .mockRejectedValue(new Error("Telegram sendMessage 400: chat not found"));
    await channel({ send: bad }).ch.deliver(note());
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it("HTML длиннее лимита — сразу простым текстом (обрезка не режет тег)", async () => {
    const send = vi.fn<NonNullable<TelegramChannelDeps["send"]>>(async () => ({
      messageId: 1,
    }));
    const { ch } = channel({ send });
    const r = await ch.deliver(
      card({ text: "x".repeat(3000), html: `<b>${"x".repeat(4100)}</b>` }),
    );
    expect(send.mock.calls[0][3]).not.toHaveProperty("html");
    expect(send.mock.calls[0][3]).not.toHaveProperty("buttons");
    expect(r).toMatchObject({
      note: "HTML длиннее лимита — отправлено простым текстом",
    });
  });

  it("«⤵️ обновлено ниже» к HTML: Telegram не принял разметку — правка простым текстом", async () => {
    const edit = vi
      .fn<NonNullable<TelegramChannelDeps["edit"]>>()
      .mockRejectedValueOnce(
        new Error("Telegram editMessageText 400: can't parse entities"),
      )
      .mockResolvedValueOnce(undefined);
    const { ch } = channel({
      send: async () => ({ messageId: 9 }),
      remove: async () => {
        throw new Error("Telegram deleteMessage 400: message can't be deleted");
      },
      edit,
    });
    const r = await ch.deliver(
      note({
        replaces: {
          ref: {
            chatId: "-1001234",
            messageId: 3,
            text: "<b>A &amp; B</b>",
            html: true,
          },
          label: "карточка",
        },
      }),
    );
    expect(edit.mock.calls[1]).toEqual([
      "bot-token",
      "-1001234",
      3,
      "A & B\n⤵️ обновлено ниже",
      { html: false },
    ]);
    expect(r.replaceError).toMatch(
      /дописано «⤵️ обновлено ниже» простым текстом/,
    );
  });

  it("«⤵️» к HTML на грани лимита — простым текстом с хвостом, без разрезанного тега", async () => {
    const edit = vi.fn<NonNullable<TelegramChannelDeps["edit"]>>(
      async () => {},
    );
    const { ch } = channel({
      send: async () => ({ messageId: 9 }),
      remove: async () => {
        throw new Error("Telegram deleteMessage 400: message can't be deleted");
      },
      edit,
    });
    await ch.deliver(
      note({
        replaces: {
          ref: {
            chatId: "-1001234",
            messageId: 3,
            text: `<b>${"y".repeat(3990)}</b>`,
            html: true,
          },
          label: "карточка",
        },
      }),
    );
    const [, , , text, opts] = edit.mock.calls[0];
    expect(opts).toEqual({ html: false });
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text).not.toMatch(/</);
    expect(text.endsWith("\n⤵️ обновлено ниже")).toBe(true);
  });
});

describe("ключ сообщения — отправленный текст (обрезанный до лимита)", () => {
  it("длинный текст — в ключе ровно то, что ушло в Telegram", async () => {
    const send = vi.fn<NonNullable<TelegramChannelDeps["send"]>>(async () => ({
      messageId: 9,
    }));
    const { ch } = channel({ send });
    const r = await ch.deliver(note({ text: "x".repeat(5000) }));
    expect(r.ref).toEqual({
      chatId: "-1001234",
      messageId: 9,
      text: "x".repeat(4000),
      html: false,
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
