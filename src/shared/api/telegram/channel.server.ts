// Telegram-канал уведомлений (spec 0067): категория → тема закрытой группы (message_thread_id), не срочное — без звука
// (disable_notification). Политика категории — внедрённая функция-источник: сейчас таблица и env
// (src/app/server/notify.ts), потом — ручные настройки из базы. Только сервер (токен бота).
import { z } from "zod";
import { getAppHost, type TelegramConfig } from "@/shared/config/env.server";
import {
  type ChannelResult,
  type NotificationThread,
  type NotifyCategory,
  type NotifyChannel,
  type NotifyHost,
  type NotifyTarget,
  notifyGate,
} from "@/shared/notify";
import {
  editTelegramMessageText,
  sendTelegramMessage,
  setTelegramMessageReaction,
  TELEGRAM_TEXT_LIMIT,
} from "./client.server";

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
  /** Правка своего сообщения — подменяется в тестах. */
  edit?: typeof editTelegramMessageText;
  /** Реакция на сообщение — подменяется в тестах. */
  react?: typeof setTelegramMessageReaction;
  /** Где работает процесс: отправляет только прод-сервер (NODE_ENV=production и APP_HOST=vm). */
  host?: () => NotifyHost;
}

/** Процесс — прод-сервер на VM: production-сборка и APP_HOST=vm (как у фоновых задач, spec 0048). */
const processHost = (): NotifyHost => ({
  production: process.env.NODE_ENV === "production",
  server: getAppHost() === "vm",
});

/**
 * Ключ отправленного сообщения для связи следующих уведомлений с ним (spec 0068): чат, номер и отправленный текст —
 * Bot API не умеет «дописать», только заменить текст целиком. Для места вызова ключ непрозрачен.
 */
export const telegramMessageRefSchema = z.object({
  chatId: z.string(),
  messageId: z.number().int(),
  text: z.string(),
});
export type TelegramMessageRef = z.infer<typeof telegramMessageRefSchema>;

/** Реакция бота — отметка итога: только стандартные эмодзи-реакции Telegram. */
const MARK_EMOJI = { good: "👍", bad: "👎" } as const;

/** Bot API: темы с таким номером нет (удалили или номер устарел). */
const THREAD_GONE = /message thread not found|TOPIC_DELETED/i;

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Текст сообщения: текст уведомления и ссылка строкой ниже. */
export const telegramMessageText = (n: { text: string; link: string | null }) =>
  [n.text, n.link].filter(Boolean).join("\n");

const NOT_CONFIGURED =
  "Telegram не настроен (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)";

/** Ключ прошлого сообщения этого чата; чужой чат или не наш формат — null (обычное сообщение). */
function threadRef(
  thread: NotificationThread | null,
  chatId: string | null,
): TelegramMessageRef | null {
  if (!thread) return null;
  const ref = telegramMessageRefSchema.safeParse(thread.ref);
  return ref.success && ref.data.chatId === chatId ? ref.data : null;
}

/** Для журнала: ответ ли это на прошлое сообщение (до отправки — каким он будет). */
function replyNote(
  thread: NotificationThread | null,
  ref: TelegramMessageRef | null,
  replied: boolean | null,
): string | undefined {
  if (!thread?.reply) return undefined;
  if (!ref) return `без ответа: ${thread.label} не известно`;
  if (replied === false) return `без ответа: ${thread.label} не найдено`;
  return `ответ на ${thread.label}`;
}

export function createTelegramChannel(
  deps: TelegramChannelDeps,
): NotifyChannel {
  const send = deps.send ?? sendTelegramMessage;
  const edit = deps.edit ?? editTelegramMessageText;
  const react = deps.react ?? setTelegramMessageReaction;
  const host = deps.host ?? processHost;

  /** Дописать строку к прошлому сообщению и отметить итог; сбой не мешает отправленному уведомлению. */
  async function amend(
    token: string,
    thread: NotificationThread,
    ref: TelegramMessageRef | null,
  ): Promise<Pick<ChannelResult, "amend" | "amendError">> {
    // Ключа нет — дописывать некуда; это не сбой: в журнале уже «без ответа: … не известно».
    if (!ref || (!thread.append && !thread.mark)) return {};
    const done: string[] = [];
    const errors: string[] = [];
    if (thread.append)
      await edit(
        token,
        ref.chatId,
        ref.messageId,
        `${ref.text}\n${thread.append}`,
      ).then(
        () => done.push("дописано"),
        (e: unknown) => errors.push(`не дописано: ${errorText(e)}`),
      );
    if (thread.mark) {
      const emoji = MARK_EMOJI[thread.mark];
      await react(token, ref.chatId, ref.messageId, emoji).then(
        () => done.push(`отметка ${emoji}`),
        (e: unknown) => errors.push(`без отметки ${emoji}: ${errorText(e)}`),
      );
    }
    return {
      ...(done.length && { amend: done.join(", ") }),
      ...(errors.length && { amendError: errors.join("; ") }),
    };
  }

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
      const ref = threadRef(n.thread, config?.chatId ?? null);
      const reply = replyNote(n.thread, ref, null);
      const asked = { target, ...(reply && { reply }) };
      const skip = !policy.enabled
        ? "категория выключена"
        : (notifyGate(n, host()) ?? (config?.chatId ? null : NOT_CONFIGURED));
      if (skip || !config?.chatId)
        return { status: "skipped", reason: skip ?? NOT_CONFIGURED, ...asked };
      const { token, chatId } = config;
      const text = telegramMessageText(n);
      const replyTo = n.thread?.reply && ref ? ref.messageId : null;
      /** Отправлено: ключ нового сообщения, отметка ответа, правка прошлого. */
      const sent = async (
        message: Awaited<ReturnType<typeof send>>,
        over: Partial<ChannelResult>,
      ): Promise<ChannelResult> => {
        const messageId = message.messageId;
        const note = replyNote(
          n.thread,
          ref,
          replyTo === null ? null : message.replied,
        );
        return {
          status: "sent",
          target,
          ...over,
          ...(note && { reply: note }),
          ...(n.thread && (await amend(token, n.thread, ref))),
          ...(messageId !== null && {
            // Тот текст, что ушёл в Telegram (обрезанный до лимита): дописывание продолжает его.
            ref: {
              chatId,
              messageId,
              text: text.slice(0, TELEGRAM_TEXT_LIMIT),
            } satisfies TelegramMessageRef,
          }),
        };
      };
      try {
        return await sent(
          await send(token, chatId, text, {
            messageThreadId: policy.topicId,
            silent,
            ...(replyTo !== null && { replyTo }),
          }),
          {},
        );
      } catch (error) {
        const reason = errorText(error);
        if (policy.topicId === null || !THREAD_GONE.test(reason))
          return { status: "failed", reason, ...asked };
        // Тему удалили или номер устарел: один повтор в чат без темы, чтобы срочное (например, «без защиты») не
        // потерялось; логгер отметит это warn notify.fallback.
        const fallback: NotifyTarget = { ...target, topicId: null };
        return send(token, chatId, text, {
          messageThreadId: null,
          silent,
          ...(replyTo !== null && { replyTo }),
        }).then(
          (message) =>
            sent(message, {
              target: fallback,
              note: `тема ${policy.topicId} не найдена — отправлено в чат без темы`,
            }),
          (retryError: unknown): ChannelResult => ({
            status: "failed",
            reason: `${reason}; без темы — ${errorText(retryError)}`,
            target: fallback,
            ...(reply && { reply }),
          }),
        );
      }
    },
  };
}
