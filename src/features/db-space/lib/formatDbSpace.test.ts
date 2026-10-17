import { describe, expect, it } from "vitest";
import {
  type DbUsage,
  formatDbSpace,
  formatMb,
  formatSpaceAlert,
  freePctOf,
} from "./formatDbSpace";

const MB = 1024 * 1024;
const usage: DbUsage = {
  usedBytes: 312 * MB,
  limitBytes: 500 * MB,
  tables: [
    { name: "app_logs", bytes: 120 * MB },
    { name: "paper_trades", bytes: 4.2 * MB },
    { name: "auth.users", bytes: 0.35 * MB },
  ],
};

describe("formatDbSpace", () => {
  it("свободно в % от лимита", () => {
    expect(freePctOf(usage)).toBeCloseTo(37.6);
  });

  it("МБ: крупные — целыми, мелкие — с дробной частью", () => {
    expect(formatMb(312 * MB)).toBe("312 МБ");
    expect(formatMb(4.24 * MB)).toBe("4,2 МБ");
    expect(formatMb(0.354 * MB)).toBe("0,35 МБ");
  });

  it("ответ на /db: занято, лимит, свободно и топ таблиц", () => {
    expect(formatDbSpace(usage)).toBe(
      [
        "💾 База: занято 312 МБ из 500 МБ, свободно 188 МБ (38 %)",
        "Самые большие таблицы:",
        "• app_logs — 120 МБ",
        "• paper_trades — 4,2 МБ",
        "• auth.users — 0,35 МБ",
      ].join("\n"),
    );
  });

  it("меньше 10 % — с десятыми; без таблиц — одна строка", () => {
    expect(
      formatDbSpace({ usedBytes: 477 * MB, limitBytes: 500 * MB, tables: [] }),
    ).toBe("💾 База: занято 477 МБ из 500 МБ, свободно 23 МБ (4,6 %)");
  });

  it("лимит превышен — свободно 0 и на сколько превышен", () => {
    expect(
      formatDbSpace({ usedBytes: 510 * MB, limitBytes: 500 * MB, tables: [] }),
    ).toBe(
      "💾 База: занято 510 МБ из 500 МБ, свободно 0 МБ (0 %), лимит превышен на 10 МБ",
    );
  });

  it("уведомление о пороге: заголовок, цифры, таблицы и ссылка на журнал", () => {
    const text = formatSpaceAlert(
      30,
      { ...usage, usedBytes: 352 * MB },
      "https://x/logs",
    );
    expect(text.split("\n")).toEqual([
      "⚠️ Свободного места в базе ≤ 30 %",
      "Занято 352 МБ из 500 МБ, свободно 148 МБ (30 %).",
      "Самые большие таблицы:",
      "• app_logs — 120 МБ",
      "• paper_trades — 4,2 МБ",
      "• auth.users — 0,35 МБ",
      "",
      "Журнал: https://x/logs",
    ]);
  });

  it("где замер — строкой под цифрами: хост и файл; база в памяти — так и написано (spec 0068, B8)", () => {
    const where = { host: "VM apps-tokyo", file: "/var/lib/binance/app.db" };
    expect(formatDbSpace({ ...usage, where }).split("\n")[1]).toBe(
      "Где: VM apps-tokyo · /var/lib/binance/app.db",
    );
    expect(
      formatSpaceAlert(
        30,
        { ...usage, where: { host: "локально, mac", file: null } },
        null,
      ).split("\n")[2],
    ).toBe("Где: локально, mac · база в памяти");
  });

  it("без адреса сайта — уведомление без строки журнала", () => {
    const text = formatSpaceAlert(30, { ...usage, usedBytes: 352 * MB }, null);
    expect(text).not.toContain("Журнал:");
    expect(text.split("\n").at(-1)).toBe("• auth.users — 0,35 МБ");
  });
});
