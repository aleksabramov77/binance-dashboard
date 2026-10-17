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
  const vm = { production: true, server: true };

  it("только прод-сервер; локальный сервер worktree и скрипты — «не production»", () => {
    expect(notifyGate(plain, vm)).toBeNull();
    expect(notifyGate(plain, { production: false, server: false })).toBe(
      "не production",
    );
  });

  it("локальная прод-сборка (pnpm build && pnpm start, APP_HOST не vm) — не отправляет (ревью PR #105)", () => {
    expect(notifyGate(plain, { production: true, server: false })).toBe(
      "не прод-сервер: production-сборка вне VM (APP_HOST ≠ vm)",
    );
  });

  it("фикстура — никогда; явная пробная команда — откуда угодно", () => {
    expect(notifyGate({ ...plain, fixture: true }, vm)).toBe("фикстура");
    expect(
      notifyGate(
        { ...plain, test: true },
        { production: false, server: false },
      ),
    ).toBeNull();
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
