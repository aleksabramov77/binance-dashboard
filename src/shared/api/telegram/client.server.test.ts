import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTelegramForumTopic,
  deleteTelegramMessage,
  editTelegramMessageText,
  getTelegramChat,
  getTelegramChatMember,
  getTelegramMe,
  sendTelegramMessage,
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

  it("возвращает номер отправленного сообщения (ключ карточки, spec 0068)", async () => {
    stubFetch({ message_id: 77 });
    expect(await sendTelegramMessage("T", "-1001", "карточка")).toEqual({
      messageId: 77,
    });
    stubFetch({});
    expect(await sendTelegramMessage("T", "-1001", "карточка")).toEqual({
      messageId: null,
    });
  });

  it("Telegram не принял — ошибка с описанием", async () => {
    stubFetch(null, { ok: false, status: 400 });
    await expect(sendTelegramMessage("T", "1", "x")).rejects.toThrow(
      "Telegram sendMessage 400: Bad Request: chat not found",
    );
  });
});

describe("удаление и правка своего сообщения (spec 0068)", () => {
  it("deleteMessage — чат и номер", async () => {
    const { call } = stubFetch(true);
    await deleteTelegramMessage("T", "-1001", 70);
    expect(call().url).toBe("https://api.telegram.org/botT/deleteMessage");
    expect(call().body).toEqual({ chat_id: "-1001", message_id: 70 });
  });

  it("editMessageText — чат, номер и новый текст", async () => {
    const { call } = stubFetch({ message_id: 70 });
    await editTelegramMessageText(
      "T",
      "-1001",
      70,
      "карточка\n⤵️ обновлено ниже",
    );
    expect(call().url).toBe("https://api.telegram.org/botT/editMessageText");
    expect(call().body).toEqual({
      chat_id: "-1001",
      message_id: 70,
      text: "карточка\n⤵️ обновлено ниже",
      link_preview_options: { is_disabled: true },
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
