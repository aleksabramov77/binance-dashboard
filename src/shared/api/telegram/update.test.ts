import { describe, expect, it } from "vitest";
import { parseTelegramCommand, telegramUpdateSchema } from "./update";

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
    ).toEqual({ chat: { id: 42 }, text: "/db" });
    expect(
      telegramUpdateSchema.parse({ update_id: 2, edited_message: {} }).message,
    ).toBeUndefined();
  });
});
