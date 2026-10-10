// Telegram Bot API: уведомления владельцу. Только сервер (токен бота).
const API = "https://api.telegram.org";

/** Отправить сообщение в чат (обычный текст, без разметки). */
export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<void> {
  const res = await fetch(`${API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      // Лимит Telegram — 4096 символов.
      text: text.slice(0, 4000),
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      description?: string;
    } | null;
    throw new Error(
      `Telegram ${res.status}: ${body?.description ?? res.statusText}`,
    );
  }
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
