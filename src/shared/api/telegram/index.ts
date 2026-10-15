// Только для сервера: использует токен бота.
export {
  deleteTelegramWebhook,
  fetchTelegramChats,
  sendTelegramMessage,
  setTelegramCommands,
  setTelegramWebhook,
  type TelegramCommand,
} from "./client.server";
export {
  parseTelegramCommand,
  type TelegramUpdate,
  telegramUpdateSchema,
} from "./update";
