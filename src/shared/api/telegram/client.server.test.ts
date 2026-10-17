import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTelegramForumTopic,
  editTelegramMessageText,
  getTelegramChat,
  getTelegramChatMember,
  getTelegramMe,
  sendTelegramMessage,
  setTelegramMessageReaction,
} from "./client.server";

// Запросы к Bot API без сети: fetch подменён, проверяем метод и тело (spec 0067).
function stubFetch(
  result: unknown,
  init: { ok?: boolean; status?: number } = {},
) {
  const fetchMock = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify(
          init.ok === false
            ? { ok: false, description: "Bad Request: chat not found" }
            : { ok: true, result },
        ),
        { status: init.status ?? 200 },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const call = (i = 0) => {
    const [url, req] = fetchMock.mock.calls[i] ?? [];
    return {
      url: String(url),
      body: JSON.parse(String(req?.body ?? "{}")) as Record<string, unknown>,
    };
  };
  return { fetchMock, call };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendTelegramMessage", () => {
  it("тема и без звука — message_thread_id и disable_notification; превью ссылок выключено", async () => {
    const { call } = stubFetch({ message_id: 1 });
    await sendTelegramMessage("T", "-1001", "текст", {
      messageThreadId: 12,
      silent: true,
    });
    expect(call().url).toBe("https://api.telegram.org/botT/sendMessage");
    expect(call().body).toEqual({
      chat_id: "-1001",
      message_thread_id: 12,
      text: "текст",
      disable_notification: true,
      link_preview_options: { is_disabled: true },
    });
  });

  it("без темы и со звуком — полей нет (как раньше, в чат)", async () => {
    const { call } = stubFetch({ message_id: 1 });
    await sendTelegramMessage("T", "42", "текст", {
      messageThreadId: null,
      silent: false,
    });
    expect(call().body).toEqual({
      chat_id: "42",
      text: "текст",
      link_preview_options: { is_disabled: true },
    });
  });

  it("ответ — reply_parameters с allow_sending_without_reply; возвращает номер и ушло ли ответом (spec 0068)", async () => {
    const { call } = stubFetch({
      message_id: 77,
      reply_to_message: { message_id: 70 },
    });
    expect(
      await sendTelegramMessage("T", "-1001", "итог", { replyTo: 70 }),
    ).toEqual({ messageId: 77, replied: true });
    expect(call().body).toMatchObject({
      reply_parameters: { message_id: 70, allow_sending_without_reply: true },
    });
    // Сообщения, на которое отвечали, нет — Telegram отправил обычным: replied false.
    stubFetch({ message_id: 78 });
    expect(
      await sendTelegramMessage("T", "-1001", "итог", { replyTo: 70 }),
    ).toEqual({ messageId: 78, replied: false });
  });

  it("Telegram не принял — ошибка с описанием", async () => {
    stubFetch(null, { ok: false, status: 400 });
    await expect(sendTelegramMessage("T", "1", "x")).rejects.toThrow(
      "Telegram sendMessage 400: Bad Request: chat not found",
    );
  });
});

describe("правка своего сообщения и реакция (spec 0068)", () => {
  it("editMessageText — чат, номер и новый текст", async () => {
    const { call } = stubFetch({ message_id: 70 });
    await editTelegramMessageText("T", "-1001", 70, "вход\nИтог: 🟢");
    expect(call().url).toBe("https://api.telegram.org/botT/editMessageText");
    expect(call().body).toEqual({
      chat_id: "-1001",
      message_id: 70,
      text: "вход\nИтог: 🟢",
      link_preview_options: { is_disabled: true },
    });
  });

  it("setMessageReaction — одно эмодзи", async () => {
    const { call } = stubFetch(true);
    await setTelegramMessageReaction("T", "-1001", 70, "👍");
    expect(call().url).toBe("https://api.telegram.org/botT/setMessageReaction");
    expect(call().body).toEqual({
      chat_id: "-1001",
      message_id: 70,
      reaction: [{ type: "emoji", emoji: "👍" }],
    });
  });
});

describe("группа с темами: getMe, getChat, getChatMember, createForumTopic", () => {
  it("getMe — id бота", async () => {
    stubFetch({ id: 777, is_bot: true, username: "x_bot" });
    expect(await getTelegramMe("T")).toEqual({ id: 777, username: "x_bot" });
  });

  it("getChat — тип и включены ли темы", async () => {
    const { call } = stubFetch({
      id: -1001,
      type: "supergroup",
      title: "Binance",
      is_forum: true,
    });
    expect(await getTelegramChat("T", "-1001")).toEqual({
      id: -1001,
      type: "supergroup",
      title: "Binance",
      isForum: true,
    });
    expect(call().body).toEqual({ chat_id: "-1001" });
    stubFetch({ id: 42, type: "private" });
    expect((await getTelegramChat("T", "42")).isForum).toBe(false);
  });

  it("getChatMember — право управлять темами: админ с can_manage_topics, владелец группы — всегда", async () => {
    const { call } = stubFetch({
      status: "administrator",
      can_manage_topics: true,
      user: { id: 777 },
    });
    expect(await getTelegramChatMember("T", "-1001", 777)).toEqual({
      status: "administrator",
      canManageTopics: true,
    });
    expect(call().body).toEqual({ chat_id: "-1001", user_id: 777 });
    stubFetch({ status: "administrator", user: { id: 777 } });
    expect(
      (await getTelegramChatMember("T", "-1001", 777)).canManageTopics,
    ).toBe(false);
    stubFetch({ status: "creator", user: { id: 777 } });
    expect(
      (await getTelegramChatMember("T", "-1001", 777)).canManageTopics,
    ).toBe(true);
    stubFetch({ status: "member", user: { id: 777 } });
    expect(
      (await getTelegramChatMember("T", "-1001", 777)).canManageTopics,
    ).toBe(false);
  });

  it("createForumTopic — номер новой темы", async () => {
    const { call } = stubFetch({
      message_thread_id: 12,
      name: "💰 Сделки",
      icon_color: 7322096,
    });
    expect(await createTelegramForumTopic("T", "-1001", "💰 Сделки")).toEqual({
      id: 12,
      name: "💰 Сделки",
    });
    expect(call().url).toBe("https://api.telegram.org/botT/createForumTopic");
    expect(call().body).toEqual({ chat_id: "-1001", name: "💰 Сделки" });
  });
});
