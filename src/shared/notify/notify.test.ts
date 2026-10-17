import { describe, expect, it } from "vitest";
import {
  type ChannelDelivery,
  NO_CHANNEL,
  notifyGate,
  notifyRecordSchema,
  summarizeNotify,
} from ".";

describe("notifyGate — отправлять ли из этого процесса (spec 0067)", () => {
  const plain = { fixture: false, test: false };

  it("только production; локальный сервер worktree и скрипты — «не production»", () => {
    expect(notifyGate(plain, "production")).toBeNull();
    expect(notifyGate(plain, "development")).toBe("не production");
    expect(notifyGate(plain, undefined)).toBe("не production");
  });

  it("фикстура — никогда; явная пробная команда — и вне production", () => {
    expect(notifyGate({ ...plain, fixture: true }, "production")).toBe(
      "фикстура",
    );
    expect(notifyGate({ ...plain, test: true }, "development")).toBeNull();
  });
});

describe("summarizeNotify — итог вызова по каналам", () => {
  const base = { category: "lab", urgent: false };
  const sent: ChannelDelivery = { channel: "telegram", status: "sent" };
  const failed: ChannelDelivery = {
    channel: "mail",
    status: "failed",
    reason: "SMTP 550",
  };
  const skipped: ChannelDelivery = {
    channel: "telegram",
    status: "skipped",
    reason: "не production",
  };

  it("канала нет — skipped «канал не подключён»", () => {
    expect(summarizeNotify(base, [])).toEqual({
      ...base,
      status: "skipped",
      reason: NO_CHANNEL,
      channels: [],
    });
  });

  it("причина вызова (skip) — главнее каналов", () => {
    expect(summarizeNotify({ ...base, skip: "повтор" }, [])).toMatchObject({
      status: "skipped",
      reason: "повтор",
    });
  });

  it("хотя бы один доставил — sent; иначе сбой — failed; иначе skipped с причиной канала", () => {
    expect(summarizeNotify(base, [sent, failed]).status).toBe("sent");
    expect(summarizeNotify(base, [failed])).toMatchObject({
      status: "failed",
      reason: "SMTP 550",
    });
    expect(summarizeNotify(base, [skipped, failed])).toMatchObject({
      status: "failed",
      reason: "mail: SMTP 550",
    });
    expect(summarizeNotify(base, [skipped])).toMatchObject({
      status: "skipped",
      reason: "не production",
    });
  });

  it("итог проходит схему записи журнала (её читает /logs)", () => {
    expect(
      notifyRecordSchema.safeParse(summarizeNotify(base, [sent, failed]))
        .success,
    ).toBe(true);
  });
});
