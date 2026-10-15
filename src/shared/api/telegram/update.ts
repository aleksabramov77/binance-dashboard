import { z } from "zod";

// Входящие обновления webhook Telegram: берём только то, что нужно для команд.
export const telegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      chat: z.object({ id: z.number() }),
      text: z.string().optional(),
    })
    .optional(),
});

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

/**
 * Команда из текста сообщения: «/db», «/db@bot», «/DB аргументы» → «db». Не команда — null.
 */
export function parseTelegramCommand(text: string | undefined): string | null {
  const match = /^\/([A-Za-z0-9_]+)(?:@\w+)?(?:\s|$)/.exec(text?.trim() ?? "");
  return match ? match[1].toLowerCase() : null;
}
