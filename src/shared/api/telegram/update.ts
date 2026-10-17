import { z } from "zod";

// Входящие обновления webhook Telegram: берём только то, что нужно для команд.
export const telegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      chat: z.object({ id: z.number(), type: z.string().optional() }),
      /** Отправитель; в группе по нему узнаём владельца (в личке id чата = id пользователя). */
      from: z.object({ id: z.number() }).optional(),
      /** Тема группы (или ветка ответов), к которой относится сообщение. */
      message_thread_id: z.number().optional(),
      /** Сообщение в теме группы с темами (или в теме лички с ботом). */
      is_topic_message: z.boolean().optional(),
      text: z.string().optional(),
    })
    .optional(),
});

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
export type TelegramMessage = NonNullable<TelegramUpdate["message"]>;

/**
 * Команда из текста сообщения: «/db», «/db@bot», «/DB аргументы» → «db». Не команда — null.
 */
export function parseTelegramCommand(text: string | undefined): string | null {
  const match = /^\/([A-Za-z0-9_]+)(?:@\w+)?(?:\s|$)/.exec(text?.trim() ?? "");
  return match ? match[1].toLowerCase() : null;
}

/**
 * Куда отвечать: тот же чат и та же тема. Номер темы — только у сообщения в теме (is_topic_message): у ответа в обычной
 * группе message_thread_id — ветка ответов, sendMessage принимает его только для групп с темами.
 */
export function replyTargetOf(message: TelegramMessage): {
  chatId: string;
  threadId: number | null;
} {
  return {
    chatId: String(message.chat.id),
    threadId: message.is_topic_message
      ? (message.message_thread_id ?? null)
      : null,
  };
}
