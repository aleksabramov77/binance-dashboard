import { beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "@/shared/lib/logger.server";
import {
  type BotDeps,
  type BotMessageInfo,
  decideBotReply,
  foreignText,
  formatBotHelp,
  handleTelegramUpdate,
} from "./telegramBot";

vi.mock("@/shared/lib/logger.server", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const OWNER = "42";
const GROUP = "-1001234567890";

function deps(over: Partial<BotDeps> = {}) {
  const send = vi.fn<BotDeps["send"]>(async () => {});
  const dbReport = vi.fn<BotDeps["dbReport"]>(async () => "💾 База: …");
  return {
    send,
    dbReport,
    ownerId: OWNER,
    groupChatId: GROUP,
    ownerProblem: null,
    ...over,
  };
}

const privateUpdate = (chatId: number, text?: string) => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: chatId, type: "private" }, text },
});

const groupUpdate = (
  fromId: number,
  text: string | undefined,
  topic: { thread?: number; isTopic?: boolean } = {},
  chatId = Number(GROUP),
) => ({
  update_id: 2,
  message: {
    message_id: 7,
    chat: { id: chatId, type: "supergroup", is_forum: true },
    from: { id: fromId, is_bot: false },
    ...(topic.thread !== undefined && { message_thread_id: topic.thread }),
    ...(topic.isTopic !== undefined && { is_topic_message: topic.isTopic }),
    text,
  },
});

const who = { ownerId: OWNER, groupChatId: GROUP };
const priv = (text?: string, chatId = OWNER): BotMessageInfo => ({
  chatId,
  fromId: chatId,
  isPrivate: true,
  text,
});

describe("decideBotReply", () => {
  it("владелец в личке: /db — место, остальное — список команд", () => {
    expect(decideBotReply(priv("/db"), who)).toBe("db");
    expect(decideBotReply(priv("/db@some_bot"), who)).toBe("db");
    expect(decideBotReply(priv("/start"), who)).toBe("help");
    expect(decideBotReply(priv("/help"), who)).toBe("help");
    expect(decideBotReply(priv("/unknown"), who)).toBe("help");
    expect(decideBotReply(priv("привет"), who)).toBe("help");
    expect(decideBotReply(priv(undefined), who)).toBe("help");
  });

  it("владелец по ошибке — id группы: участники группы не становятся владельцем (ревью PR #105)", () => {
    const groupAsOwner = { ownerId: GROUP, groupChatId: GROUP };
    expect(
      decideBotReply(
        { chatId: GROUP, fromId: "7", isPrivate: false, text: "/db" },
        groupAsOwner,
      ),
    ).toBe("foreign");
  });

  it("чужая личка или владелец не задан — не отвечаем", () => {
    expect(decideBotReply(priv("/db", "7"), who)).toBe("foreign");
    expect(
      decideBotReply(priv("/db"), { ownerId: null, groupChatId: GROUP }),
    ).toBe("foreign");
  });

  it("группа уведомлений (spec 0067): команды владельца — ответ, чужих — нет; не команды — не замечаем", () => {
    const inGroup = (fromId: string, text: string | undefined) => ({
      chatId: GROUP,
      fromId,
      isPrivate: false,
      text,
    });
    expect(decideBotReply(inGroup(OWNER, "/db"), who)).toBe("db");
    expect(decideBotReply(inGroup(OWNER, "/help"), who)).toBe("help");
    expect(decideBotReply(inGroup("7", "/db"), who)).toBe("foreign");
    expect(decideBotReply(inGroup(OWNER, "заметка в теме"), who)).toBe(
      "ignored",
    );
    expect(decideBotReply(inGroup("7", undefined), who)).toBe("ignored");
    // Незнакомая группа — даже от владельца: её id попадает в журнал записью telegram.foreign.
    expect(
      decideBotReply({ ...inGroup(OWNER, "/help"), chatId: "-100999" }, who),
    ).toBe("foreign");
  });
});

describe("handleTelegramUpdate", () => {
  it("/db от владельца в личке — ответ с замером в его чат, без темы", async () => {
    const d = deps();
    expect(await handleTelegramUpdate(privateUpdate(42, "/db"), d)).toBe("db");
    expect(d.send).toHaveBeenCalledWith(
      { chatId: OWNER, threadId: null },
      "💾 База: …",
    );
  });

  it("/start и /help — список команд", async () => {
    for (const text of ["/start", "/help", "что-то"]) {
      const d = deps();
      expect(await handleTelegramUpdate(privateUpdate(42, text), d)).toBe(
        "help",
      );
      expect(d.send).toHaveBeenCalledWith(
        { chatId: OWNER, threadId: null },
        formatBotHelp(),
      );
      expect(d.dbReport).not.toHaveBeenCalled();
    }
    expect(formatBotHelp()).toContain("/db — Свободное место в базе");
  });

  it("команда владельца в теме группы — ответ в ту же группу и ту же тему", async () => {
    const d = deps();
    expect(
      await handleTelegramUpdate(
        groupUpdate(42, "/db@binance_dashboard_gold_bot", {
          thread: 5,
          isTopic: true,
        }),
        d,
      ),
    ).toBe("db");
    expect(d.send).toHaveBeenCalledWith(
      { chatId: GROUP, threadId: 5 },
      "💾 База: …",
    );
  });

  it("ответ на сообщение в обычной группе — без темы (ветка ответов — не тема)", async () => {
    const d = deps();
    await handleTelegramUpdate(groupUpdate(42, "/help", { thread: 9 }), d);
    expect(d.send).toHaveBeenCalledWith(
      { chatId: GROUP, threadId: null },
      formatBotHelp(),
    );
  });

  it("чужой чат — ничего не отправляет и не замеряет, id чата — в журнал", async () => {
    const d = deps();
    expect(await handleTelegramUpdate(privateUpdate(7, "/db"), d)).toBe(
      "foreign",
    );
    expect(d.send).not.toHaveBeenCalled();
    expect(d.dbReport).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      "telegram.foreign",
      "Сообщение боту из чужого чата 7",
      { chatId: "7", fromId: null, threadId: null },
    );
  });

  it("незнакомая группа (ещё не TELEGRAM_CHAT_ID) — без ответа, id группы в журнале", async () => {
    const d = deps({ groupChatId: OWNER });
    expect(
      await handleTelegramUpdate(groupUpdate(42, "/help", {}, -100777), d),
    ).toBe("foreign");
    expect(d.send).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      "telegram.foreign",
      "Команда боту из незнакомой группы -100777 (от 42)",
      expect.objectContaining({ chatId: "-100777", fromId: "42" }),
    );
  });

  it("TELEGRAM_OWNER_ID не принят — warn telegram.config на команду, бот работает с владельцем по умолчанию", async () => {
    const d = deps({
      ownerProblem: "TELEGRAM_OWNER_ID (-100) — не id пользователя",
    });
    expect(await handleTelegramUpdate(privateUpdate(42, "/help"), d)).toBe(
      "help",
    );
    expect(log.warn).toHaveBeenCalledWith(
      "telegram.config",
      "TELEGRAM_OWNER_ID (-100) — не id пользователя",
      { chatId: OWNER },
    );
    // Обычное сообщение в группе — без записей.
    vi.clearAllMocks();
    await handleTelegramUpdate(groupUpdate(42, "заметка"), d);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("не сообщение, мусор или не команда в группе — игнорируем", async () => {
    const d = deps();
    expect(
      await handleTelegramUpdate({ update_id: 1, edited_message: {} }, d),
    ).toBe("ignored");
    expect(await handleTelegramUpdate(null, d)).toBe("ignored");
    expect(await handleTelegramUpdate(groupUpdate(7, undefined), d)).toBe(
      "ignored",
    );
    expect(d.send).not.toHaveBeenCalled();
  });

  it("замер не удался — владелец получает текст ошибки", async () => {
    const d = deps({
      dbReport: async () => {
        throw new Error("нет связи с БД");
      },
    });
    expect(await handleTelegramUpdate(privateUpdate(42, "/db"), d)).toBe("db");
    expect(d.send).toHaveBeenCalledWith(
      { chatId: OWNER, threadId: null },
      "⚠️ Не удалось замерить место в базе: нет связи с БД",
    );
  });
});

describe("foreignText", () => {
  it("личка, чужой в группе, незнакомая группа", () => {
    expect(foreignText(priv("/db", "7"), GROUP)).toBe(
      "Сообщение боту из чужого чата 7",
    );
    expect(
      foreignText(
        { chatId: GROUP, fromId: "7", isPrivate: false, text: "/db" },
        GROUP,
      ),
    ).toBe(`Команда боту в группе ${GROUP} от чужого пользователя 7`);
  });
});
