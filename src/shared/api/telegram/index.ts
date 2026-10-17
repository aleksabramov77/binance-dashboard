// Только для сервера: использует токен бота. Уведомления — только через канал (log.notify, spec 0067):
// sendTelegramMessage вызывают Telegram-канал и бот (ответы на команды) — проверяет notifyBoundary.test.ts.
export {
  createTelegramChannel,
  type TelegramChannelDeps,
  type TelegramMessageRef,
  type TelegramTopicPolicy,
  telegramMessageText,
} from "./channel.server";
export {
  createTelegramForumTopic,
  deleteTelegramWebhook,
  editTelegramMessageText,
  fetchTelegramChats,
  getTelegramChat,
  getTelegramChatMember,
  getTelegramMe,
  sendTelegramMessage,
  setTelegramCommands,
  setTelegramMessageReaction,
  setTelegramWebhook,
  type TelegramChat,
  type TelegramChatMember,
  type TelegramCommand,
  type TelegramSendOptions,
  type TelegramSentMessage,
} from "./client.server";
export {
  parseTelegramCommand,
  replyTargetOf,
  type TelegramMessage,
  type TelegramUpdate,
  telegramUpdateSchema,
} from "./update";
