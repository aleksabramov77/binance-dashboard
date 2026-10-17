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
