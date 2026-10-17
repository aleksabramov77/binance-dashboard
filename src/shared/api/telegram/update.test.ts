import { describe, expect, it } from "vitest";
import {
  parseTelegramCommand,
  replyTargetOf,
  telegramUpdateSchema,
} from "./update";

describe("parseTelegramCommand", () => {
  it("команда с суффиксом бота и аргументами", () => {
    expect(parseTelegramCommand("/db")).toBe("db");
    expect(parseTelegramCommand("/db@binance_dashboard_gold_bot")).toBe("db");
    expect(parseTelegramCommand("  /DB сейчас")).toBe("db");
    expect(parseTelegramCommand("/start")).toBe("start");
  });

  it("не команда — null", () => {
    expect(parseTelegramCommand("сколько места?")).toBeNull();
    expect(parseTelegramCommand("db")).toBeNull();
    expect(parseTelegramCommand("/dbx-1")).toBeNull();
    expect(parseTelegramCommand(undefined)).toBeNull();
  });
});

describe("telegramUpdateSchema", () => {
  it("сообщение с текстом и обновление без сообщения", () => {
    expect(
      telegramUpdateSchema.parse({
        update_id: 1,
        message: {
          message_id: 5,
          chat: { id: 42, type: "private" },
          text: "/db",
        },
      }).message,
    ).toEqual({ chat: { id: 42, type: "private" }, text: "/db" });
    expect(
      telegramUpdateSchema.parse({ update_id: 2, edited_message: {} }).message,
    ).toBeUndefined();
  });

  it("сообщение в теме группы: отправитель и тема (spec 0067)", () => {
    expect(
      telegramUpdateSchema.parse({
        update_id: 3,
        message: {
          message_id: 9,
          chat: { id: -1001, type: "supergroup", is_forum: true },
          from: { id: 42, is_bot: false, first_name: "A" },
          message_thread_id: 5,
          is_topic_message: true,
          text: "/db",
        },
      }).message,
    ).toEqual({
      chat: { id: -1001, type: "supergroup" },
      from: { id: 42 },
      message_thread_id: 5,
      is_topic_message: true,
      text: "/db",
    });
  });
});

describe("replyTargetOf", () => {
  it("тема — только у сообщения в теме; ветка ответов обычной группы и личка — без темы", () => {
    expect(
      replyTargetOf({
        chat: { id: -1001 },
        message_thread_id: 5,
        is_topic_message: true,
      }),
    ).toEqual({ chatId: "-1001", threadId: 5 });
    expect(
      replyTargetOf({ chat: { id: -1002 }, message_thread_id: 9 }),
    ).toEqual({ chatId: "-1002", threadId: null });
    expect(replyTargetOf({ chat: { id: 42 } })).toEqual({
      chatId: "42",
      threadId: null,
    });
  });
});
