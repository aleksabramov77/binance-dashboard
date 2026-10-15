// Telegram Bot API: уведомления владельцу и команды бота. Только сервер (токен бота).
const API = "https://api.telegram.org";

/** Вызов метода Bot API; ошибка — с описанием от Telegram. */
async function callTelegram(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    description?: string;
  } | null;
  if (!res.ok || body?.ok === false)
    throw new Error(
      `Telegram ${method} ${res.status}: ${body?.description ?? res.statusText}`,
    );
}

/** Отправить сообщение в чат (обычный текст, без разметки). */
export function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<void> {
  return callTelegram(token, "sendMessage", {
    chat_id: chatId,
    // Лимит Telegram — 4096 символов.
    text: text.slice(0, 4000),
    disable_web_page_preview: true,
  });
}

/**
 * Включить webhook: Telegram шлёт сообщения боту POST-запросом на url с секретом в заголовке
 * X-Telegram-Bot-Api-Secret-Token. Пока webhook включён, getUpdates не работает.
 */
export function setTelegramWebhook(
  token: string,
  input: { url: string; secret: string },
): Promise<void> {
  return callTelegram(token, "setWebhook", {
    url: input.url,
    secret_token: input.secret,
    allowed_updates: ["message"],
  });
}

/** Снять webhook — сообщения снова доступны через getUpdates. */
export function deleteTelegramWebhook(token: string): Promise<void> {
  return callTelegram(token, "deleteWebhook", {});
}

export interface TelegramCommand {
  /** Без «/», 1–32 символа: латиница в нижнем регистре, цифры, «_». */
  command: string;
  description: string;
}

/** Меню команд бота (кнопка «/» в чате). */
export function setTelegramCommands(
  token: string,
  commands: readonly TelegramCommand[],
): Promise<void> {
  return callTelegram(token, "setMyCommands", { commands });
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
