// Telegram-канал уведомлений (spec 0067): категория → тема закрытой группы (message_thread_id), не срочное — без звука
// (disable_notification). Политика категории — внедрённая функция-источник: сейчас таблица и env
// (src/app/server/notify.ts), потом — ручные настройки из базы. Только сервер (токен бота).
import { getAppHost, type TelegramConfig } from "@/shared/config/env.server";
import {
  type ChannelResult,
  type NotifyCategory,
  type NotifyChannel,
  type NotifyHost,
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
  /** Где работает процесс: отправляет только прод-сервер (NODE_ENV=production и APP_HOST=vm). */
  host?: () => NotifyHost;
}

/** Процесс — прод-сервер на VM: production-сборка и APP_HOST=vm (как у фоновых задач, spec 0048). */
const processHost = (): NotifyHost => ({
  production: process.env.NODE_ENV === "production",
  server: getAppHost() === "vm",
});

/** Bot API: темы с таким номером нет (удалили или номер устарел). */
const THREAD_GONE = /message thread not found|TOPIC_DELETED/i;

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Текст сообщения: текст уведомления и ссылка строкой ниже. */
export const telegramMessageText = (n: { text: string; link: string | null }) =>
  [n.text, n.link].filter(Boolean).join("\n");

const NOT_CONFIGURED =
  "Telegram не настроен (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)";

export function createTelegramChannel(
  deps: TelegramChannelDeps,
): NotifyChannel {
  const send = deps.send ?? sendTelegramMessage;
  const host = deps.host ?? processHost;
  return {
    name: "telegram",
    async deliver(n) {
      const policy = await deps.policy(n.category);
      const config = deps.config();
      const silent =
        policy.sound === "never" || (policy.sound === "urgent" && !n.urgent);
      // Запрос пишется в журнал и тогда, когда не отправляется (не прод-сервер, фикстура): видно, куда ушло бы.
      const target: NotifyTarget = {
        topic: policy.title,
        topicId: policy.topicId,
        to: config?.chatId ?? null,
        silent,
      };
      const skip = !policy.enabled
        ? "категория выключена"
        : (notifyGate(n, host()) ?? (config?.chatId ? null : NOT_CONFIGURED));
      if (skip || !config?.chatId)
        return { status: "skipped", reason: skip ?? NOT_CONFIGURED, target };
      const { token, chatId } = config;
      const text = telegramMessageText(n);
      try {
        await send(token, chatId, text, {
          messageThreadId: policy.topicId,
          silent,
        });
        return { status: "sent", target };
      } catch (error) {
        const reason = errorText(error);
        if (policy.topicId === null || !THREAD_GONE.test(reason))
          return { status: "failed", reason, target };
        // Тему удалили или номер устарел: один повтор в чат без темы, чтобы срочное (например, «без защиты») не
        // потерялось; логгер отметит это warn notify.fallback.
        const fallback: NotifyTarget = { ...target, topicId: null };
        return send(token, chatId, text, {
          messageThreadId: null,
          silent,
        }).then(
          (): ChannelResult => ({
            status: "sent",
            target: fallback,
            note: `тема ${policy.topicId} не найдена — отправлено в чат без темы`,
          }),
          (retryError: unknown): ChannelResult => ({
            status: "failed",
            reason: `${reason}; без темы — ${errorText(retryError)}`,
            target: fallback,
          }),
        );
      }
    },
  };
}
