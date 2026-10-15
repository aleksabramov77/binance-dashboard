// Команды бота Telegram (spec 0021): webhook на прод и меню команд.
//   pnpm telegram:setup           — setWebhook на ${SITE_URL}/api/telegram/webhook с секретом + setMyCommands
//   pnpm telegram:setup --delete  — снять webhook (снова работает getUpdates: pnpm monitor:supabase chat-id)
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (тот же, что в переменных Vercel), SITE_URL (необязательно).
// Берутся из .env.local и ~/.config/vercel/binance-dashboard-prod.env; значения не печатаем.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { BOT_COMMANDS } from "@/app/server/telegramBot";
import {
  deleteTelegramWebhook,
  setTelegramCommands,
  setTelegramWebhook,
} from "@/shared/api/telegram";
import { getSiteUrl, getTelegramConfig } from "@/shared/config/env.server";

function fail(message: string): never {
  console.error(`[telegram:setup] ${message}`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--delete");
  if (unknown.length)
    fail(`неизвестные аргументы: ${unknown.join(" ")}. Есть только --delete`);
  // Уже заданные переменные loadEnvFile не перезаписывает: первым — .env.local.
  for (const file of [
    ".env.local",
    path.join(homedir(), ".config/vercel/binance-dashboard-prod.env"),
  ])
    if (existsSync(file)) process.loadEnvFile(file);

  const telegram = getTelegramConfig();
  if (!telegram) fail("TELEGRAM_BOT_TOKEN не задан");

  if (args.includes("--delete")) {
    await deleteTelegramWebhook(telegram.token);
    console.log(
      "Webhook снят: бот не отвечает на команды, getUpdates снова работает.",
    );
    return;
  }

  if (!telegram.webhookSecret)
    fail(
      "TELEGRAM_WEBHOOK_SECRET не задан. Сгенерируйте (openssl rand -hex 32), задайте в переменных Vercel и в .env.local, передеплойте и повторите.",
    );
  const url = `${getSiteUrl()}/api/telegram/webhook`;
  await setTelegramWebhook(telegram.token, {
    url,
    secret: telegram.webhookSecret,
  });
  console.log(`Webhook: ${url}`);
  await setTelegramCommands(telegram.token, BOT_COMMANDS);
  console.log(
    `Меню команд: ${BOT_COMMANDS.map((c) => `/${c.command}`).join(", ")}`,
  );
}

main().catch((error) =>
  fail(error instanceof Error ? error.message : String(error)),
);
