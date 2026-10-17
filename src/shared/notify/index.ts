// Уведомления из вызова логгера (spec 0067): контракт между местом вызова (log.notify), логгером и каналами. Без Node
// API: схема поля notify записи журнала нужна и клиенту (/logs). Категории shared не знает — их список задаёт
// приложение (NotifyCategories), темы и звук решает канал.
import { z } from "zod";

/**
 * Категории уведомлений. Список задаёт приложение расширением интерфейса (`declare module` в
 * src/app/server/notify.ts), поэтому категория в месте вызова log.notify проверяется компилятором.
 */
// biome-ignore lint/suspicious/noEmptyInterface: интерфейс расширяет приложение (declaration merging)
export interface NotifyCategories {}

export type NotifyCategory = Extract<keyof NotifyCategories, string>;

/** Уровень записи журнала с уведомлением: debug в базу не попадает — такую запись не увидеть в /logs. */
export type NotifyLevel = "info" | "warn" | "error";

/**
 * Вызов log.notify: одна запись журнала и одно уведомление. Место вызова называет категорию и срочность, а не канал:
 * никаких Telegram, chat id и номеров тем — куда и как слать, решает канал (setNotifyChannels).
 */
export interface NotifyInput {
  level: NotifyLevel;
  event: string;
  /** Текст записи журнала. */
  message: string;
  data?: Record<string, unknown>;
  error?: unknown;
  category: NotifyCategory;
  /** true — со звуком; по умолчанию тихо (рутина). */
  urgent?: boolean;
  /** Текст уведомления; по умолчанию message. */
  text?: string;
  /** Ссылка строкой под текстом; null или не задана — без ссылки. */
  link?: string | null;
  /** Событие фикстуры (готовые данные для проверки): канал не отправляет. */
  fixture?: boolean;
  /** Явная пробная команда, её запускают руками: отправляется и вне production. */
  test?: boolean;
  /** Не отправлять (причина, например «повтор — сообщение было»): запись с итогом skipped, каналы не вызываются. */
  skip?: string;
}

/** Уведомление, которое получает канал. */
export interface Notification {
  category: NotifyCategory;
  urgent: boolean;
  text: string;
  link: string | null;
  level: NotifyLevel;
  event: string;
  fixture: boolean;
  test: boolean;
}

export const NOTIFY_STATUSES = ["sent", "failed", "skipped"] as const;
export type NotifyStatus = (typeof NOTIFY_STATUSES)[number];

const outcome = {
  status: z.enum(NOTIFY_STATUSES),
  /** Почему не отправлено (failed, skipped). */
  reason: z.string().optional(),
};

/** Куда и как канал слал (или слал бы) — для журнала и /logs. */
export const notifyTargetSchema = z.object({
  /** Тема для людей: «🧪 Лаборатория». */
  topic: z.string(),
  /** Номер темы у канала; null — без темы, в общий чат. */
  topicId: z.number().int().nullable(),
  /** Получатель (чат); null — не задан. */
  to: z.string().nullable(),
  /** Без звука. */
  silent: z.boolean(),
});
export type NotifyTarget = z.infer<typeof notifyTargetSchema>;

export const channelDeliverySchema = z.object({
  /** Имя канала: telegram. */
  channel: z.string(),
  ...outcome,
  target: notifyTargetSchema.optional(),
  /** Доставлено не так, как просили (тема не найдена — в чат без темы): логгер пишет warn notify.fallback. */
  note: z.string().optional(),
});
export type ChannelDelivery = z.infer<typeof channelDeliverySchema>;

/** Поле notify записи журнала и ответ log.notify: категория, срочность, итог по всем каналам и по каждому. */
export const notifyRecordSchema = z.object({
  category: z.string(),
  urgent: z.boolean(),
  ...outcome,
  channels: z.array(channelDeliverySchema),
});
export type NotifyRecord = z.infer<typeof notifyRecordSchema>;

/** Итог канала: доставка и куда слал. */
export type ChannelResult = Omit<ChannelDelivery, "channel">;

/**
 * Канал уведомлений: получает уведомление, возвращает итог. Подключается при старте (setNotifyChannels в
 * instrumentation.ts), как приёмник журнала; второй канал добавляется там же, без правок мест вызова.
 */
export interface NotifyChannel {
  name: string;
  /** Сбой отправки — итог failed; исключение логгер тоже запишет как failed. */
  deliver: (notification: Notification) => Promise<ChannelResult>;
}

/** Где работает процесс: production-сборка и прод-сервер (VM: APP_HOST=vm). */
export interface NotifyHost {
  production: boolean;
  server: boolean;
}

/**
 * Отправлять ли из этого процесса: только прод-сервер (NODE_ENV=production и APP_HOST=vm) и не фикстуры. Локальный
 * сервер worktree, локальная прод-сборка и скрипты пишут только журнал: .env.local общий с основным checkout. Явная
 * проверка (test) отправляется откуда угодно. Возвращает причину пропуска; null — отправлять.
 */
export function notifyGate(
  n: Pick<Notification, "fixture" | "test">,
  host: NotifyHost,
): string | null {
  if (n.fixture) return "фикстура";
  if (n.test) return null;
  if (!host.production) return "не production";
  if (!host.server)
    return "не прод-сервер: production-сборка вне VM (APP_HOST ≠ vm)";
  return null;
}

/** Канала нет — итог без отправки. */
export const NO_CHANNEL = "канал не подключён";

const reasonsOf = (deliveries: ChannelDelivery[], single: boolean) =>
  deliveries
    .map((d) =>
      single ? (d.reason ?? d.status) : `${d.channel}: ${d.reason ?? d.status}`,
    )
    .join("; ");

/**
 * Итог вызова: доставил хотя бы один канал — sent; иначе был сбой — failed; иначе skipped. Причина — по каналам (у
 * одного канала — его причина).
 */
export function summarizeNotify(
  input: { category: string; urgent: boolean; skip?: string },
  deliveries: ChannelDelivery[],
): NotifyRecord {
  const base = {
    category: input.category,
    urgent: input.urgent,
    channels: deliveries,
  };
  if (input.skip !== undefined)
    return { ...base, status: "skipped", reason: input.skip };
  if (deliveries.length === 0)
    return { ...base, status: "skipped", reason: NO_CHANNEL };
  if (deliveries.some((d) => d.status === "sent"))
    return { ...base, status: "sent" };
  const failed = deliveries.filter((d) => d.status === "failed");
  const single = deliveries.length === 1;
  return failed.length
    ? { ...base, status: "failed", reason: reasonsOf(failed, single) }
    : { ...base, status: "skipped", reason: reasonsOf(deliveries, single) };
}
