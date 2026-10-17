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
  /** Связь с прошлым сообщением (ответ, дописать, отметка итога) — без понятий канала (spec 0068). */
  thread?: NotifyThread;
}

/**
 * Ключ отправленного сообщения по каналам: { <канал>: <его ключ> }. Возвращает log.notify (поле ref ответа); место
 * вызова хранит его как есть и передаёт обратно в thread.ref, не разбирая: что внутри, знает только канал.
 */
export type NotifyRef = Record<string, unknown>;
export const notifyRefSchema = z.record(z.string(), z.unknown());

/** Отметка итога на прошлом сообщении: good — удачно, bad — неудачно. */
export type NotifyMark = "good" | "bad";

/**
 * Связь нового уведомления с прошлым сообщением (spec 0068): ответить на него, дописать к нему строку, отметить итог.
 * Ключа нет (null) или канал его не знает — уведомление уходит обычным сообщением; сбой дописывания или отметки не
 * мешает отправке — логгер пишет warn notify.amend.
 */
export interface NotifyThread {
  /** Ключ прошлого сообщения (ref из ответа log.notify); null — не известен. */
  ref: NotifyRef | null;
  /** Что это за сообщение — для журнала: «сообщение о входе». */
  label: string;
  /** Отправить ответом на прошлое сообщение. */
  reply?: boolean;
  /** Дописать строку в конец прошлого сообщения. */
  append?: string | null;
  /** Отметить прошлое сообщение итогом. */
  mark?: NotifyMark | null;
}

/** Связь с прошлым сообщением, как её получает канал: его собственный ключ (или null). */
export interface NotificationThread {
  ref: unknown;
  label: string;
  reply: boolean;
  append: string | null;
  mark: NotifyMark | null;
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
  /** Связь с прошлым сообщением; null — обычное сообщение. */
  thread: NotificationThread | null;
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
  /** Ответ ли это на прошлое сообщение: «ответ на сообщение о входе», «без ответа: сообщение о входе не известно». */
  reply: z.string().optional(),
  /** Что сделано с прошлым сообщением: «дописано, отметка 👍». */
  amend: z.string().optional(),
  /** Дописать или отметить прошлое сообщение не удалось — причина; логгер пишет warn notify.amend. */
  amendError: z.string().optional(),
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

/** Ответ log.notify: итог (как в записи журнала) и ключ отправленного сообщения по каналам (в запись не попадает). */
export type NotifyResult = NotifyRecord & {
  /** Ключ сообщения для thread.ref следующих уведомлений; null — ни один канал не отправил. */
  ref: NotifyRef | null;
};

/** Итог канала: доставка, куда слал и ключ отправленного сообщения (ref — только в ответ, не в журнал). */
export type ChannelResult = Omit<ChannelDelivery, "channel"> & {
  ref?: unknown;
};

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
