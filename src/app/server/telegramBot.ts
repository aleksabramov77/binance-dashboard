// Команды бота @binance_dashboard_gold_bot (платформа, spec 0021): webhook → разбор → ответ владельцу.
// Чужим чатам бот не отвечает. Вызывает POST /api/telegram/webhook; меню команд — pnpm telegram:setup.
import { formatDbSpace } from "@/features/db-space";
import {
  parseTelegramCommand,
  sendTelegramMessage,
  type TelegramCommand,
  telegramUpdateSchema,
} from "@/shared/api/telegram";
import type { TelegramConfig } from "@/shared/config/env.server";
import { log } from "@/shared/lib/logger.server";
import { getDbUsage } from "./dbSpace";

/** Меню команд бота; /start Telegram шлёт сам при первом запуске — отвечаем как на /help. */
export const BOT_COMMANDS: readonly TelegramCommand[] = [
  { command: "db", description: "Свободное место в базе" },
  { command: "help", description: "Список команд" },
];

export type BotAction = "db" | "help" | "foreign";

/** Что ответить: чужой чат — ничего; /db — место в базе; всё остальное — список команд. */
export function decideBotReply(input: {
  chatId: string;
  ownerChatId: string | null;
  text: string | undefined;
}): BotAction {
  if (!input.ownerChatId || input.chatId !== input.ownerChatId)
    return "foreign";
  return parseTelegramCommand(input.text) === "db" ? "db" : "help";
}

export const formatBotHelp = (): string =>
  [
    "🤖 Binance Dashboard — команды бота:",
    ...BOT_COMMANDS.map((c) => `/${c.command} — ${c.description}`),
  ].join("\n");

export interface BotDeps {
  /** Чат владельца (TELEGRAM_CHAT_ID); null — бот не отвечает никому. */
  ownerChatId: string | null;
  send: (chatId: string, text: string) => Promise<void>;
  /** Текст ответа на /db. */
  dbReport: () => Promise<string>;
}

export const createBotDeps = (telegram: TelegramConfig): BotDeps => ({
  ownerChatId: telegram.chatId,
  send: (chatId, text) => sendTelegramMessage(telegram.token, chatId, text),
  dbReport: async () => formatDbSpace(await getDbUsage()),
});

/** Обработать обновление webhook. ignored — не сообщение (правка, участник чата и т.п.). */
export async function handleTelegramUpdate(
  update: unknown,
  deps: BotDeps,
): Promise<BotAction | "ignored"> {
  const parsed = telegramUpdateSchema.safeParse(update);
  const message = parsed.success ? parsed.data.message : undefined;
  if (!message) return "ignored";
  const chatId = String(message.chat.id);
  const action = decideBotReply({
    chatId,
    ownerChatId: deps.ownerChatId,
    text: message.text,
  });
  if (action === "foreign") {
    log.warn("telegram.foreign", `Сообщение боту из чужого чата ${chatId}`, {
      chatId,
    });
    return action;
  }
  let text = formatBotHelp();
  if (action === "db")
    try {
      text = await deps.dbReport();
    } catch (error) {
      log.error(
        "telegram.db",
        "Не удалось замерить место в базе",
        undefined,
        error,
      );
      text = `⚠️ Не удалось замерить место в базе: ${error instanceof Error ? error.message : String(error)}`;
    }
  await deps.send(chatId, text);
  return action;
}
