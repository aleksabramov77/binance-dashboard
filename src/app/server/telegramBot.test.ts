import { describe, expect, it, vi } from "vitest";
import {
  type BotDeps,
  decideBotReply,
  formatBotHelp,
  handleTelegramUpdate,
} from "./telegramBot";

const OWNER = "42";

function deps(over: Partial<BotDeps> = {}) {
  const send = vi.fn<BotDeps["send"]>(async () => {});
  const dbReport = vi.fn<BotDeps["dbReport"]>(async () => "💾 База: …");
  return { send, dbReport, ownerChatId: OWNER, ...over };
}

const update = (chatId: number, text?: string) => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: chatId, type: "private" }, text },
});

describe("decideBotReply", () => {
  it("владелец: /db — место, остальное — список команд", () => {
    const owner = { chatId: OWNER, ownerChatId: OWNER };
    expect(decideBotReply({ ...owner, text: "/db" })).toBe("db");
    expect(decideBotReply({ ...owner, text: "/db@some_bot" })).toBe("db");
    expect(decideBotReply({ ...owner, text: "/start" })).toBe("help");
    expect(decideBotReply({ ...owner, text: "/help" })).toBe("help");
    expect(decideBotReply({ ...owner, text: "/unknown" })).toBe("help");
    expect(decideBotReply({ ...owner, text: "привет" })).toBe("help");
    expect(decideBotReply({ ...owner, text: undefined })).toBe("help");
  });

  it("чужой чат или владелец не задан — не отвечаем", () => {
    expect(
      decideBotReply({ chatId: "7", ownerChatId: OWNER, text: "/db" }),
    ).toBe("foreign");
    expect(
      decideBotReply({ chatId: OWNER, ownerChatId: null, text: "/db" }),
    ).toBe("foreign");
  });
});

describe("handleTelegramUpdate", () => {
  it("/db от владельца — ответ с замером в его чат", async () => {
    const d = deps();
    expect(await handleTelegramUpdate(update(42, "/db"), d)).toBe("db");
    expect(d.send).toHaveBeenCalledWith(OWNER, "💾 База: …");
  });

  it("/start и /help — список команд", async () => {
    for (const text of ["/start", "/help", "что-то"]) {
      const d = deps();
      expect(await handleTelegramUpdate(update(42, text), d)).toBe("help");
      expect(d.send).toHaveBeenCalledWith(OWNER, formatBotHelp());
      expect(d.dbReport).not.toHaveBeenCalled();
    }
    expect(formatBotHelp()).toContain("/db — Свободное место в базе");
  });

  it("чужой чат — ничего не отправляет и не замеряет", async () => {
    const d = deps();
    expect(await handleTelegramUpdate(update(7, "/db"), d)).toBe("foreign");
    expect(d.send).not.toHaveBeenCalled();
    expect(d.dbReport).not.toHaveBeenCalled();
  });

  it("не сообщение или мусор — игнорируем", async () => {
    const d = deps();
    expect(
      await handleTelegramUpdate({ update_id: 1, edited_message: {} }, d),
    ).toBe("ignored");
    expect(await handleTelegramUpdate(null, d)).toBe("ignored");
    expect(d.send).not.toHaveBeenCalled();
  });

  it("замер не удался — владелец получает текст ошибки", async () => {
    const d = deps({
      dbReport: async () => {
        throw new Error("нет связи с БД");
      },
    });
    expect(await handleTelegramUpdate(update(42, "/db"), d)).toBe("db");
    expect(d.send).toHaveBeenCalledWith(
      OWNER,
      "⚠️ Не удалось замерить место в базе: нет связи с БД",
    );
  });
});
