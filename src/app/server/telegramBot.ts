// Команды бота @binance_dashboard_gold_bot (платформа, spec 0021): webhook → разбор → ответ владельцу. Ответ на команду —
// не уведомление (spec 0067): бот отвечает в тот же чат и ту же тему — в личке и в группе уведомлений. Чужим бот не
// отвечает. Вызывает POST /api/telegram/webhook; меню команд — pnpm telegram:setup.
import { formatDbSpace } from "@/features/db-space";
import {
  parseTelegramCommand,
  replyTargetOf,
  sendTelegramMessage,
  type TelegramCommand,
  telegramUpdateSchema,
} from "@/shared/api/telegram";
import {
  type TelegramConfig,
  telegramOwnerProblem,
} from "@/shared/config/env.server";
import { log } from "@/shared/lib/logger.server";
import { getDbUsage } from "./dbSpace";

/** Меню команд бота; /start Telegram шлёт сам при первом запуске — отвечаем как на /help. */
export const BOT_COMMANDS: readonly TelegramCommand[] = [
  { command: "db", description: "Свободное место в базе" },
  { command: "help", description: "Список команд" },
];

export type BotAction = "db" | "help" | "foreign" | "ignored";

export interface BotMessageInfo {
  chatId: string;
  /** Отправитель (в личке совпадает с chatId); нет — неизвестен. */
  fromId: string | null;
  /** Личка с ботом; иначе группа. */
  isPrivate: boolean;
  text: string | undefined;
}

/**
 * Что ответить. Владелец — в своей личке (id чата = id владельца) или в группе уведомлений (TELEGRAM_CHAT_ID) от своего
 * имени: /db — место в базе, остальное — список команд; в группе — только на команды, обычные сообщения бот не
 * замечает. Чужой чат или отправитель — ничего (foreign).
 */
export function decideBotReply(
  message: BotMessageInfo,
  who: { ownerId: string | null; groupChatId: string | null },
): BotAction {
  const command = parseTelegramCommand(message.text);
  if (!message.isPrivate && command === null) return "ignored";
  if (!who.ownerId) return "foreign";
  // Личка владельца — только личный чат: id группы по ошибке в TELEGRAM_OWNER_ID не пускает всех её участников.
  const owner =
    (message.isPrivate && message.chatId === who.ownerId) ||
    (message.fromId === who.ownerId && message.chatId === who.groupChatId);
  if (!owner) return "foreign";
  return command === "db" ? "db" : "help";
}

/** Запись telegram.foreign: из какого чата и от кого — по id новой группы её задают в TELEGRAM_CHAT_ID. */
export function foreignText(
  m: BotMessageInfo,
  groupChatId: string | null,
): string {
  if (m.isPrivate) return `Сообщение боту из чужого чата ${m.chatId}`;
  if (m.chatId === groupChatId)
    return `Команда боту в группе ${m.chatId} от чужого пользователя ${m.fromId ?? "(неизвестен)"}`;
  return `Команда боту из незнакомой группы ${m.chatId}${m.fromId ? ` (от ${m.fromId})` : ""}`;
}

export const formatBotHelp = (): string =>
  [
    "🤖 Binance Dashboard — команды бота:",
    ...BOT_COMMANDS.map((c) => `/${c.command} — ${c.description}`),
  ].join("\n");

/** Куда ответить: чат и тема входящего сообщения. */
export interface ReplyTarget {
  chatId: string;
  threadId: number | null;
}

export interface BotDeps {
  /** Владелец (TELEGRAM_OWNER_ID, по умолчанию личный TELEGRAM_CHAT_ID); null — бот не отвечает никому. */
  ownerId: string | null;
  /** Чат уведомлений (TELEGRAM_CHAT_ID): в группе с темами бот тоже отвечает владельцу. */
  groupChatId: string | null;
  /** TELEGRAM_OWNER_ID не принят (не id пользователя) — warn telegram.config при каждой команде; null — в порядке. */
  ownerProblem: string | null;
  send: (to: ReplyTarget, text: string) => Promise<void>;
  /** Текст ответа на /db. */
  dbReport: () => Promise<string>;
}

export const createBotDeps = (telegram: TelegramConfig): BotDeps => ({
  ownerId: telegram.ownerId,
  groupChatId: telegram.chatId,
  ownerProblem: telegramOwnerProblem(telegram),
  send: (to, text) =>
    sendTelegramMessage(telegram.token, to.chatId, text, {
      messageThreadId: to.threadId,
    }),
  dbReport: async () => formatDbSpace(await getDbUsage()),
});

/** Обработать обновление webhook. ignored — не сообщение (правка, участник чата и т.п.) или не команда в группе. */
export async function handleTelegramUpdate(
  update: unknown,
  deps: BotDeps,
): Promise<BotAction> {
  const parsed = telegramUpdateSchema.safeParse(update);
  const message = parsed.success ? parsed.data.message : undefined;
  if (!message) return "ignored";
  const target = replyTargetOf(message);
  const info: BotMessageInfo = {
    chatId: target.chatId,
    fromId: message.from ? String(message.from.id) : null,
    // Тип чата не пришёл — по id: у лички он положительный.
    isPrivate: message.chat.type
      ? message.chat.type === "private"
      : message.chat.id > 0,
    text: message.text,
  };
  const action = decideBotReply(info, {
    ownerId: deps.ownerId,
    groupChatId: deps.groupChatId,
  });
  if (action === "ignored") return action;
  if (deps.ownerProblem)
    log.warn("telegram.config", deps.ownerProblem, { chatId: info.chatId });
  if (action === "foreign") {
    // Id чата — в журнал: так владелец узнаёт id новой группы (spec 0067, «Действия владельца при выкатке»).
    log.warn("telegram.foreign", foreignText(info, deps.groupChatId), {
      chatId: info.chatId,
      fromId: info.fromId,
      threadId: target.threadId,
    });
    return action;
  }
  let text = formatBotHelp();
  if (action === "db")
    try {
      text = await deps.dbReport();
    } catch (error) {
      log.error(
        "telegram.db",
        "Не удалось замерить место в базе",
        undefined,
        error,
      );
      text = `⚠️ Не удалось замерить место в базе: ${error instanceof Error ? error.message : String(error)}`;
    }
  await deps.send(target, text);
  return action;
}
