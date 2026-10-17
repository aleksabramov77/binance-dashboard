// Бот Telegram (spec 0021, 0067): webhook на прод, меню команд, группа с темами и пробные сообщения в темы.
//   pnpm telegram:setup           — setWebhook на ${SITE_URL}/api/telegram/webhook с секретом + setMyCommands
//   pnpm telegram:setup --delete  — снять webhook (снова работает getUpdates: pnpm monitor:supabase chat-id)
//   pnpm telegram:setup --topics  — проверить группу TELEGRAM_CHAT_ID (темы включены, бот — админ с правом управлять
//                                   темами), создать недостающие темы и напечатать строки TELEGRAM_TOPIC_* для app.env;
//                                   заданные TELEGRAM_TOPIC_* не пересоздаются
//   pnpm telegram:setup --test    — по одному тихому пробному сообщению в каждую тему (вместе с --topics — и в только
//                                   что созданные); явная проверка — отправляется и вне production
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_OWNER_ID, TELEGRAM_TOPIC_*, TELEGRAM_WEBHOOK_SECRET (тот же, что
// у прода), SITE_URL (адрес прода, обязателен для setWebhook). Берутся из .env.local и
// ~/.config/vercel/binance-dashboard-prod.env; заданные в окружении — главнее. Значения секретов не печатаем.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  createNotifyChannels,
  NOTIFY_CATEGORIES,
  NOTIFY_TOPICS,
} from "@/app/server/notify";
import { BOT_COMMANDS } from "@/app/server/telegramBot";
import {
  createTelegramForumTopic,
  deleteTelegramWebhook,
  getTelegramChat,
  getTelegramChatMember,
  getTelegramMe,
  setTelegramCommands,
  setTelegramWebhook,
} from "@/shared/api/telegram";
import {
  getSiteUrl,
  getTelegramConfig,
  type TelegramConfig,
} from "@/shared/config/env.server";
import { log, setNotifyChannels } from "@/shared/lib/logger.server";
import {
  forumProblems,
  ownerWarning,
  parseSetupArgs,
  planTopics,
  topicEnvLines,
} from "./lib/telegramSetup";

function fail(message: string): never {
  console.error(`[telegram:setup] ${message}`);
  process.exit(1);
}

const TOPICS = NOTIFY_CATEGORIES.map((category) => ({
  category,
  ...NOTIFY_TOPICS[category],
}));

/** Группа с темами: проверка прав, недостающие темы, строки для app.env. Новые номера — и в env процесса (для --test). */
async function setupTopics(telegram: TelegramConfig, chatId: string) {
  const chat = await getTelegramChat(telegram.token, chatId);
  const me = await getTelegramMe(telegram.token);
  const member = await getTelegramChatMember(telegram.token, chatId, me.id);
  const problems = forumProblems(chatId, chat, member);
  if (problems.length)
    fail(`группа не готова к темам:\n  - ${problems.join("\n  - ")}`);
  const plan = planTopics(TOPICS, process.env);
  if (plan.invalid.length)
    fail(
      plan.invalid
        .map(
          (t) =>
            `${t.env}=${t.value} — не номер темы: исправьте или удалите строку (иначе появится вторая тема «${t.title}»)`,
        )
        .join("\n"),
    );
  const ids = new Map(plan.existing.map((t) => [t.env, t.id]));
  for (const t of plan.existing)
    console.log(`Тема «${t.title}» уже задана: ${t.env}=${t.id}`);
  for (const t of plan.missing) {
    const topic = await createTelegramForumTopic(
      telegram.token,
      chatId,
      t.title,
    );
    ids.set(t.env, topic.id);
    process.env[t.env] = String(topic.id);
    console.log(`Создана тема «${t.title}»: ${t.env}=${topic.id}`);
  }
  console.log(
    `\nСтроки для /etc/binance/app.env (группа «${chat.title ?? chatId}»):\n${topicEnvLines(
      TOPICS.flatMap((t) => {
        const id = ids.get(t.env);
        return id === undefined ? [] : [{ env: t.env, id }];
      }),
    ).join("\n")}`,
  );
}

/** Пробное сообщение в каждую тему — тем же каналом, что у приложения (тихо, явная проверка). */
async function sendTests(): Promise<boolean> {
  setNotifyChannels(createNotifyChannels());
  let ok = true;
  for (const t of TOPICS) {
    const r = await log.notify({
      level: "info",
      event: "telegram.test",
      message: `Пробное сообщение в тему «${t.title}»`,
      category: t.category,
      test: true,
      text: `🧪 Binance Dashboard: пробное сообщение — тема «${t.title}». Уведомления этой категории приходят сюда.`,
    });
    const topicId = r.channels[0]?.target?.topicId ?? null;
    const where = topicId === null ? "без темы" : `тема ${topicId}`;
    if (r.status !== "sent") ok = false;
    console.log(
      r.status === "sent"
        ? `✅ ${t.title} (${where}): отправлено`
        : `✖ ${t.title} (${where}): не отправлено — ${r.reason}`,
    );
  }
  return ok;
}

async function main() {
  const mode = parseSetupArgs(process.argv.slice(2));
  if ("error" in mode) fail(mode.error);
  // Уже заданные переменные loadEnvFile не перезаписывает: первым — .env.local.
  for (const file of [
    ".env.local",
    path.join(homedir(), ".config/vercel/binance-dashboard-prod.env"),
  ])
    if (existsSync(file)) process.loadEnvFile(file);

  const telegram = getTelegramConfig();
  if (!telegram) fail("TELEGRAM_BOT_TOKEN не задан");
  const warning = ownerWarning(process.env);
  if (warning) console.warn(`⚠️ ${warning}`);

  if (mode.delete) {
    await deleteTelegramWebhook(telegram.token);
    console.log(
      "Webhook снят: бот не отвечает на команды, getUpdates снова работает.",
    );
    return;
  }

  if (mode.topics || mode.test) {
    if (mode.topics) {
      if (!telegram.chatId)
        fail("TELEGRAM_CHAT_ID не задан — нужен id группы с темами");
      await setupTopics(telegram, telegram.chatId);
    }
    if (mode.test && !(await sendTests()))
      fail("не все пробные сообщения отправлены");
    return;
  }

  if (!telegram.webhookSecret)
    fail(
      "TELEGRAM_WEBHOOK_SECRET не задан. Сгенерируйте (openssl rand -hex 32), задайте в переменных Vercel и в .env.local, передеплойте и повторите.",
    );
  const site = getSiteUrl();
  if (!site)
    fail(
      "SITE_URL не задан: передайте адрес прода, например SITE_URL=https://binance.<ip>.sslip.io pnpm telegram:setup",
    );
  const url = `${site}/api/telegram/webhook`;
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
