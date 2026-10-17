import type { NotifyRecord } from "@/shared/notify";

type Outcome = Pick<NotifyRecord, "status" | "reason">;

const outcomeText = (o: Outcome) =>
  o.status === "sent" ? "отправлено" : `не отправлено: ${o.reason ?? o.status}`;

const soundText = (silent: boolean) => (silent ? "тихо" : "со звуком");

/**
 * Уведомление записи журнала для людей (spec 0067, детали записи в /logs): по строке на канал — тема, звук и итог
 * доставки: «telegram: 🧪 Лаборатория (без темы), тихо — не отправлено: не production». Канала нет — категория из
 * вызова и запрошенная срочность. Ответ на прошлое сообщение и его правка — хвостом строки: «· ответ на сообщение о
 * входе; дописано, отметка 👍».
 */
export function notifyLines(notify: NotifyRecord): string[] {
  if (notify.channels.length === 0)
    return [
      `${notify.category}, ${soundText(!notify.urgent)} — ${outcomeText(notify)}`,
    ];
  return notify.channels.map((c) => {
    const where = c.target
      ? `${c.target.topic} (${c.target.topicId === null ? "без темы" : `тема ${c.target.topicId}`}), ${soundText(c.target.silent)}`
      : `${notify.category}, ${soundText(!notify.urgent)}`;
    // Связь с прошлым сообщением (spec 0068): ответ ли это и что сделано с прошлым.
    const thread = [
      c.reply,
      c.amend,
      c.amendError && `не изменено: ${c.amendError}`,
    ]
      .filter(Boolean)
      .join("; ");
    return `${c.channel}: ${where} — ${outcomeText(c)}${c.note ? ` (${c.note})` : ""}${thread ? ` · ${thread}` : ""}`;
  });
}
