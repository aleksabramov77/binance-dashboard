// Telegram Bot API: уведомления (через канал уведомлений, channel.server.ts), ответы бота на команды и настройка
// группы с темами (pnpm telegram:setup). Только сервер (токен бота).
import { z } from "zod";

const API = "https://api.telegram.org";

const responseSchema = z.object({
  ok: z.boolean().optional(),
  description: z.string().optional(),
  result: z.unknown().optional(),
});

/** Вызов метода Bot API; ошибка — с описанием от Telegram. Ответ — поле result. */
async function callTelegram(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  const parsed = responseSchema.safeParse(await res.json().catch(() => null));
  const body = parsed.success ? parsed.data : null;
  if (!res.ok || body?.ok === false)
    throw new Error(
      `Telegram ${method} ${res.status}: ${body?.description ?? res.statusText}`,
    );
  return body?.result;
}

export interface TelegramSendOptions {
  /** Тема группы (message_thread_id); null или не задана — в чат без темы. */
  messageThreadId?: number | null;
  /** Без звука (disable_notification): «сообщение придёт без звука». */
  silent?: boolean;
  /**
   * Ответить на сообщение этого чата (reply_parameters). Сообщения нет (удалено) — отправится обычным
   * (allow_sending_without_reply), а не ошибкой.
   */
  replyTo?: number | null;
}

/** Сколько символов текста отправляем и правим (лимит Telegram — 4096). */
export const TELEGRAM_TEXT_LIMIT = 4000;

const sentMessageSchema = z.object({
  message_id: z.number().int(),
  reply_to_message: z.unknown().optional(),
});

/** Отправленное сообщение: номер (null — Telegram не вернул) и ушло ли ответом. */
export interface TelegramSentMessage {
  messageId: number | null;
  replied: boolean;
}

/** Отправить сообщение в чат (обычный текст, без разметки), в тему, без звука и ответом — по options. */
export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  options: TelegramSendOptions = {},
): Promise<TelegramSentMessage> {
  const result = await callTelegram(token, "sendMessage", {
    chat_id: chatId,
    ...(options.messageThreadId != null && {
      message_thread_id: options.messageThreadId,
    }),
    text: text.slice(0, TELEGRAM_TEXT_LIMIT),
    ...(options.silent && { disable_notification: true }),
    ...(options.replyTo != null && {
      reply_parameters: {
        message_id: options.replyTo,
        allow_sending_without_reply: true,
      },
    }),
    link_preview_options: { is_disabled: true },
  });
  const sent = sentMessageSchema.safeParse(result);
  return sent.success
    ? {
        messageId: sent.data.message_id,
        replied: sent.data.reply_to_message != null,
      }
    : { messageId: null, replied: false };
}

/**
 * Заменить текст своего сообщения (editMessageText). Бот правит только свои сообщения; удалённое или слишком старое
 * — ошибка Telegram.
 */
export async function editTelegramMessageText(
  token: string,
  chatId: string,
  messageId: number,
  text: string,
): Promise<void> {
  await callTelegram(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: text.slice(0, TELEGRAM_TEXT_LIMIT),
    link_preview_options: { is_disabled: true },
  });
}

/** Поставить реакцию бота на сообщение (setMessageReaction): одно стандартное эмодзи; уведомления она не даёт. */
export async function setTelegramMessageReaction(
  token: string,
  chatId: string,
  messageId: number,
  emoji: string,
): Promise<void> {
  await callTelegram(token, "setMessageReaction", {
    chat_id: chatId,
    message_id: messageId,
    reaction: [{ type: "emoji", emoji }],
  });
}

/**
 * Включить webhook: Telegram шлёт сообщения боту POST-запросом на url с секретом в заголовке
 * X-Telegram-Bot-Api-Secret-Token. Пока webhook включён, getUpdates не работает.
 */
export async function setTelegramWebhook(
  token: string,
  input: { url: string; secret: string },
): Promise<void> {
  await callTelegram(token, "setWebhook", {
    url: input.url,
    secret_token: input.secret,
    allowed_updates: ["message"],
  });
}

/** Снять webhook — сообщения снова доступны через getUpdates. */
export async function deleteTelegramWebhook(token: string): Promise<void> {
  await callTelegram(token, "deleteWebhook", {});
}

export interface TelegramCommand {
  /** Без «/», 1–32 символа: латиница в нижнем регистре, цифры, «_». */
  command: string;
  description: string;
}

/** Меню команд бота (кнопка «/» в чате). */
export async function setTelegramCommands(
  token: string,
  commands: readonly TelegramCommand[],
): Promise<void> {
  await callTelegram(token, "setMyCommands", { commands });
}

const userSchema = z.object({
  id: z.number(),
  username: z.string().optional(),
});

/** Сам бот (getMe): id нужен, чтобы проверить его права в группе. */
export async function getTelegramMe(
  token: string,
): Promise<{ id: number; username: string | null }> {
  const me = userSchema.parse(await callTelegram(token, "getMe", {}));
  return { id: me.id, username: me.username ?? null };
}

const chatSchema = z.object({
  id: z.number(),
  type: z.string(),
  title: z.string().optional(),
  is_forum: z.boolean().optional(),
});

export interface TelegramChat {
  id: number;
  /** private, group, supergroup, channel. */
  type: string;
  title: string | null;
  /** Группа с темами (is_forum). */
  isForum: boolean;
}

/** Чат (getChat): тип и включены ли темы. */
export async function getTelegramChat(
  token: string,
  chatId: string,
): Promise<TelegramChat> {
  const chat = chatSchema.parse(
    await callTelegram(token, "getChat", { chat_id: chatId }),
  );
  return {
    id: chat.id,
    type: chat.type,
    title: chat.title ?? null,
    isForum: chat.is_forum === true,
  };
}

const memberSchema = z.object({
  status: z.string(),
  can_manage_topics: z.boolean().optional(),
});

export interface TelegramChatMember {
  /** creator, administrator, member, restricted, left, kicked. */
  status: string;
  /** Может создавать темы: владелец группы — всегда, админ — с правом can_manage_topics. */
  canManageTopics: boolean;
}

/** Участник чата (getChatMember): статус и право управлять темами. */
export async function getTelegramChatMember(
  token: string,
  chatId: string,
  userId: number,
): Promise<TelegramChatMember> {
  const member = memberSchema.parse(
    await callTelegram(token, "getChatMember", {
      chat_id: chatId,
      user_id: userId,
    }),
  );
  return {
    status: member.status,
    canManageTopics:
      member.status === "creator" ||
      (member.status === "administrator" && member.can_manage_topics === true),
  };
}

const topicSchema = z.object({
  message_thread_id: z.number(),
  name: z.string(),
});

/** Создать тему группы (createForumTopic, у бота — админ с can_manage_topics); ответ — номер темы. */
export async function createTelegramForumTopic(
  token: string,
  chatId: string,
  name: string,
): Promise<{ id: number; name: string }> {
  const topic = topicSchema.parse(
    await callTelegram(token, "createForumTopic", { chat_id: chatId, name }),
  );
  return { id: topic.message_thread_id, name: topic.name };
}

/** Последние чаты, написавшие боту (после /start) — чтобы узнать chat id владельца. */
export async function fetchTelegramChats(
  token: string,
): Promise<{ id: string; username: string | null }[]> {
  const res = await fetch(`${API}/bot${token}/getUpdates`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}`);
  const body = (await res.json()) as {
    result?: { message?: { chat?: { id: number; username?: string } } }[];
  };
  const chats = new Map<string, string | null>();
  for (const u of body.result ?? []) {
    const chat = u.message?.chat;
    if (chat) chats.set(String(chat.id), chat.username ?? null);
  }
  return [...chats].map(([id, username]) => ({ id, username }));
}
