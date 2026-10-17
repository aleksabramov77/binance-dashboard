// Telegram-канал уведомлений (spec 0067): категория → тема закрытой группы (message_thread_id), не срочное — без звука
// (disable_notification). Политика категории — внедрённая функция-источник: сейчас таблица и env
// (src/app/server/notify.ts), потом — ручные настройки из базы. Только сервер (токен бота).
import type { TelegramConfig } from "@/shared/config/env.server";
import {
  type NotifyCategory,
  type NotifyChannel,
  type NotifyTarget,
  notifyGate,
} from "@/shared/notify";
import { sendTelegramMessage } from "./client.server";

/** Политика категории: тема, звук, включена ли. */
export interface TelegramTopicPolicy {
  /** Название темы для людей: «🧪 Лаборатория». */
  title: string;
  /** Тема группы (message_thread_id); null — сообщение в чат без темы. */
  topicId: number | null;
  /** false — категория выключена: не отправлять. */
  enabled: boolean;
  /** Когда со звуком: urgent — только срочное, always — всё, never — ничего. */
  sound: "urgent" | "always" | "never";
}

export interface TelegramChannelDeps {
  /** Бот и чат (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID) — читаются на каждую отправку. */
  config: () => TelegramConfig | null;
  /** Политика категории — единственный источник темы и звука; может читать базу (async). */
  policy: (
    category: NotifyCategory,
  ) => TelegramTopicPolicy | Promise<TelegramTopicPolicy>;
  /** Отправка — подменяется в тестах. */
  send?: typeof sendTelegramMessage;
  /** NODE_ENV процесса (только production отправляет). */
  nodeEnv?: () => string | undefined;
}

/** Текст сообщения: текст уведомления и ссылка строкой ниже. */
export const telegramMessageText = (n: { text: string; link: string | null }) =>
  [n.text, n.link].filter(Boolean).join("\n");

const NOT_CONFIGURED =
  "Telegram не настроен (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)";

export function createTelegramChannel(
  deps: TelegramChannelDeps,
): NotifyChannel {
  const send = deps.send ?? sendTelegramMessage;
  const nodeEnv = deps.nodeEnv ?? (() => process.env.NODE_ENV);
  return {
    name: "telegram",
    async deliver(n) {
      const policy = await deps.policy(n.category);
      const config = deps.config();
      const silent =
        policy.sound === "never" || (policy.sound === "urgent" && !n.urgent);
      // Запрос пишется в журнал и тогда, когда не отправляется (не production, фикстура): видно, куда ушло бы.
      const target: NotifyTarget = {
        topic: policy.title,
        topicId: policy.topicId,
        to: config?.chatId ?? null,
        silent,
      };
      const skip = !policy.enabled
        ? "категория выключена"
        : (notifyGate(n, nodeEnv()) ??
          (config?.chatId ? null : NOT_CONFIGURED));
      if (skip || !config?.chatId)
        return { status: "skipped", reason: skip ?? NOT_CONFIGURED, target };
      try {
        await send(config.token, config.chatId, telegramMessageText(n), {
          messageThreadId: policy.topicId,
          silent,
        });
        return { status: "sent", target };
      } catch (error) {
        return {
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
          target,
        };
      }
    },
  };
}
