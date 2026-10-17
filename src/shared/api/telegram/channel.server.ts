// Telegram-канал уведомлений (spec 0067): категория → тема закрытой группы (message_thread_id), не срочное — без звука
// (disable_notification). Политика категории — внедрённая функция-источник: сейчас таблица и env
// (src/app/server/notify.ts), потом — ручные настройки из базы. Замена прошлого сообщения (spec 0068) — отправить
// новое, потом удалить прежнее. Только сервер (токен бота).
import { z } from "zod";
import { getAppHost, type TelegramConfig } from "@/shared/config/env.server";
import {
  type ChannelResult,
  type Notification,
  type NotificationReplace,
  type NotifyCategory,
  type NotifyChannel,
  type NotifyHost,
  type NotifyTarget,
  notifyGate,
} from "@/shared/notify";
import {
  deleteTelegramMessage,
  editTelegramMessageText,
  sendTelegramMessage,
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
  /** Удаление своего сообщения — подменяется в тестах. */
  remove?: typeof deleteTelegramMessage;
  /** Правка своего сообщения — подменяется в тестах. */
  edit?: typeof editTelegramMessageText;
  /** Где работает процесс: отправляет только прод-сервер (NODE_ENV=production и APP_HOST=vm). */
  host?: () => NotifyHost;
}

/** Процесс — прод-сервер на VM: production-сборка и APP_HOST=vm (как у фоновых задач, spec 0048). */
const processHost = (): NotifyHost => ({
  production: process.env.NODE_ENV === "production",
  server: getAppHost() === "vm",
});

/**
 * Ключ отправленного сообщения (spec 0068): чат, номер и отправленный текст. Его заменит следующее уведомление; если
 * удалить нельзя (старше 48 ч), к нему дописывается «⤵️ обновлено ниже» — Bot API меняет текст только целиком.
 * Для места вызова ключ непрозрачен.
 */
export const telegramMessageRefSchema = z.object({
  chatId: z.string(),
  messageId: z.number().int(),
  text: z.string(),
  /** Текст — HTML: правка «⤵️ обновлено ниже» — с тем же parse_mode. */
  html: z.boolean().default(false),
});
export type TelegramMessageRef = z.infer<typeof telegramMessageRefSchema>;

/** Строка к прежнему сообщению, которое не удалить (старше 48 ч): новое — ниже. */
export const UPDATED_BELOW = "⤵️ обновлено ниже";

/** Bot API: темы с таким номером нет (удалили или номер устарел). */
const THREAD_GONE = /message thread not found|TOPIC_DELETED/i;
/** Bot API: удаляемого сообщения уже нет (удалил владелец или кто-то ещё). */
const MESSAGE_GONE = /message to delete not found|message not found/i;
/** Bot API: удалить нельзя — старше 48 ч: пробуем дописать «⤵️ обновлено ниже». */
const CANT_DELETE = /message can't be deleted/i;

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Текст сообщения: текст уведомления и ссылка строкой ниже. Есть ссылки-кнопки — ссылка не дублируется в тексте. В
 * HTML ссылка экранируется (& в адресе).
 */
export const telegramMessageText = (n: {
  text: string;
  link: string | null;
  links?: readonly unknown[];
  html?: boolean;
}) =>
  [
    n.text,
    n.links?.length ? null : n.html ? n.link?.replaceAll("&", "&amp;") : n.link,
  ]
    .filter(Boolean)
    .join("\n");

/** Ссылки уведомления → один ряд кнопок; primary — синяя. */
const buttonsOf = (n: Notification) =>
  n.links.length
    ? [
        n.links.map((l) => ({
          text: l.label,
          url: l.url,
          ...(l.kind === "primary" && { style: "primary" as const }),
        })),
      ]
    : undefined;

const NOT_CONFIGURED =
  "Telegram не настроен (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)";

/** Ключ заменяемого сообщения этого чата; чужой чат или не наш формат — null (просто новое сообщение). */
function replacedRef(
  replaces: NotificationReplace | null,
  chatId: string | null,
): TelegramMessageRef | null {
  if (!replaces) return null;
  const ref = telegramMessageRefSchema.safeParse(replaces.ref);
  return ref.success && ref.data.chatId === chatId ? ref.data : null;
}

type ReplaceOutcome = Pick<ChannelResult, "replaced" | "replaceError">;

export function createTelegramChannel(
  deps: TelegramChannelDeps,
): NotifyChannel {
  const send = deps.send ?? sendTelegramMessage;
  const remove = deps.remove ?? deleteTelegramMessage;
  const edit = deps.edit ?? editTelegramMessageText;
  const host = deps.host ?? processHost;

  /**
   * Убрать прежнее сообщение после отправки нового (spec 0068, B2–B3). Не бросает: уже удалено — так и записано;
   * старше 48 ч — дописать «⤵️ обновлено ниже»; любой сбой — replaceError (warn), новое сообщение остаётся.
   */
  async function removeOld(
    token: string,
    label: string,
    ref: TelegramMessageRef,
  ): Promise<ReplaceOutcome> {
    try {
      await remove(token, ref.chatId, ref.messageId);
      return { replaced: `${label} заменена` };
    } catch (error) {
      const reason = errorText(error);
      if (MESSAGE_GONE.test(reason))
        return { replaced: `${label} заменена (прежней уже нет)` };
      const notRemoved = `прежняя ${label} не удалена: ${reason}`;
      if (!CANT_DELETE.test(reason)) return { replaceError: notRemoved };
      try {
        await edit(
          token,
          ref.chatId,
          ref.messageId,
          `${ref.text}\n${UPDATED_BELOW}`,
          { html: ref.html },
        );
        return { replaceError: `${notRemoved}; дописано «${UPDATED_BELOW}»` };
      } catch (editError) {
        return {
          replaceError: `${notRemoved}; «${UPDATED_BELOW}» не дописано: ${errorText(editError)}`,
        };
      }
    }
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
      const old = replacedRef(n.replaces, config?.chatId ?? null);
      // Прежнего нет (сделка до 0068, карточки ещё не было) — просто новое сообщение (B4).
      const noOld: ReplaceOutcome =
        n.replaces && !old
          ? { replaced: `${n.replaces.label} новая — прежней нет` }
          : {};
      const skip = !policy.enabled
        ? "категория выключена"
        : (notifyGate(n, host()) ?? (config?.chatId ? null : NOT_CONFIGURED));
      if (skip || !config?.chatId)
        return {
          status: "skipped",
          reason: skip ?? NOT_CONFIGURED,
          target,
          ...(old && n.replaces
            ? { replaced: `${n.replaces.label} заменила бы прежнюю` }
            : noOld),
        };
      const { token, chatId } = config;
      const text = telegramMessageText(n);
      const format = {
        ...(n.html && { html: true }),
        ...(buttonsOf(n) && { buttons: buttonsOf(n) }),
      };
      /** Отправлено: прежнее убирается только после успешной отправки нового (B2); ключ — нового. */
      const sent = async (
        message: Awaited<ReturnType<typeof send>>,
        over: Partial<ChannelResult>,
      ): Promise<ChannelResult> => ({
        status: "sent",
        target,
        ...over,
        ...(old && n.replaces
          ? await removeOld(token, n.replaces.label, old)
          : noOld),
        ...(message.messageId !== null && {
          // Тот текст, что ушёл в Telegram (обрезанный до лимита): к нему допишется «⤵️ обновлено ниже».
          ref: {
            chatId,
            messageId: message.messageId,
            text: text.slice(0, TELEGRAM_TEXT_LIMIT),
            html: n.html,
          } satisfies TelegramMessageRef,
        }),
      });
      try {
        return await sent(
          await send(token, chatId, text, {
            messageThreadId: policy.topicId,
            silent,
            ...format,
          }),
          {},
        );
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
          ...format,
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
          }),
        );
      }
    },
  };
}
