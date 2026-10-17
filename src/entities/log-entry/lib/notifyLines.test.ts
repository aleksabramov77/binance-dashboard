import { describe, expect, it } from "vitest";
import { notifyLines } from "./notifyLines";

describe("notifyLines — уведомление в деталях записи /logs (spec 0067, AC8)", () => {
  it("тумблер с локального сервера: «Лаборатория, тихо, не отправлено: не production»", () => {
    expect(
      notifyLines({
        category: "lab",
        urgent: false,
        status: "skipped",
        reason: "не production",
        channels: [
          {
            channel: "telegram",
            status: "skipped",
            reason: "не production",
            target: {
              topic: "🧪 Лаборатория",
              topicId: null,
              to: "42",
              silent: true,
            },
          },
        ],
      }),
    ).toEqual([
      "telegram: 🧪 Лаборатория (без темы), тихо — не отправлено: не production",
    ]);
  });

  it("тема и звук; сбой — с причиной; по строке на канал", () => {
    expect(
      notifyLines({
        category: "trades",
        urgent: true,
        status: "sent",
        channels: [
          {
            channel: "telegram",
            status: "sent",
            target: {
              topic: "💰 Сделки",
              topicId: 12,
              to: "-1001",
              silent: false,
            },
          },
          { channel: "mail", status: "failed", reason: "SMTP 550" },
        ],
      }),
    ).toEqual([
      "telegram: 💰 Сделки (тема 12), со звуком — отправлено",
      "mail: trades, со звуком — не отправлено: SMTP 550",
    ]);
  });

  it("отметка канала — в скобках после итога", () => {
    expect(
      notifyLines({
        category: "trades",
        urgent: true,
        status: "sent",
        channels: [
          {
            channel: "telegram",
            status: "sent",
            target: {
              topic: "💰 Сделки",
              topicId: null,
              to: "-1001",
              silent: false,
            },
            note: "тема 12 не найдена — отправлено в чат без темы",
          },
        ],
      }),
    ).toEqual([
      "telegram: 💰 Сделки (без темы), со звуком — отправлено (тема 12 не найдена — отправлено в чат без темы)",
    ]);
  });

  it("ответ на прошлое сообщение и его правка — хвостом строки (spec 0068, AC10)", () => {
    const target = {
      topic: "💰 Сделки",
      topicId: 5,
      to: "-1001",
      silent: false,
    };
    expect(
      notifyLines({
        category: "trades",
        urgent: true,
        status: "sent",
        channels: [
          {
            channel: "telegram",
            status: "sent",
            target,
            reply: "ответ на сообщение о входе",
            amend: "отметка 👍",
            amendError: "не дописано: message to edit not found",
          },
        ],
      }),
    ).toEqual([
      "telegram: 💰 Сделки (тема 5), со звуком — отправлено · ответ на сообщение о входе; отметка 👍; не изменено: не дописано: message to edit not found",
    ]);
    expect(
      notifyLines({
        category: "trades",
        urgent: true,
        status: "skipped",
        reason: "не production",
        channels: [
          {
            channel: "telegram",
            status: "skipped",
            reason: "не production",
            target,
            reply: "без ответа: сообщение о входе не известно",
          },
        ],
      }),
    ).toEqual([
      "telegram: 💰 Сделки (тема 5), со звуком — не отправлено: не production · без ответа: сообщение о входе не известно",
    ]);
  });

  it("канал не подключён — категория и запрошенный звук", () => {
    expect(
      notifyLines({
        category: "server",
        urgent: true,
        status: "skipped",
        reason: "канал не подключён",
        channels: [],
      }),
    ).toEqual(["server, со звуком — не отправлено: канал не подключён"]);
  });
});
