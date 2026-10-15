import { createBotDeps, handleTelegramUpdate } from "@/app/server/telegramBot";
import { getTelegramConfig } from "@/shared/config/env.server";
import { checkSecretHeader } from "@/shared/lib/auth/cronAuth.server";
import { log } from "@/shared/lib/logger.server";
import { withLogging } from "@/shared/lib/route.server";

// Webhook бота Telegram (spec 0021): команды владельца (/db, /help). Сессии здесь нет — Telegram
// присылает секрет из setWebhook в заголовке X-Telegram-Bot-Api-Secret-Token. Регистрация —
// pnpm telegram:setup. После проверки секрета отвечаем 200 всегда, чтобы Telegram не повторял запрос.
export const POST = withLogging(
  "telegram.webhook",
  async (request) => {
    const telegram = getTelegramConfig();
    if (!telegram?.webhookSecret)
      return Response.json(
        {
          error: telegram
            ? "TELEGRAM_WEBHOOK_SECRET не задан"
            : "TELEGRAM_BOT_TOKEN не задан",
        },
        { status: 503 },
      );
    const auth = checkSecretHeader(
      request.headers.get("x-telegram-bot-api-secret-token"),
      telegram.webhookSecret,
    );
    if (auth !== "ok")
      return Response.json({ error: "Неверный секрет" }, { status: 401 });
    const update: unknown = await request.json().catch(() => null);
    try {
      const action = await handleTelegramUpdate(
        update,
        createBotDeps(telegram),
      );
      return Response.json({ ok: true, action });
    } catch (error) {
      log.error(
        "telegram.webhook",
        "Не удалось ответить на сообщение боту",
        undefined,
        error,
      );
      return Response.json({ ok: false });
    }
  },
  { quiet: true },
);
