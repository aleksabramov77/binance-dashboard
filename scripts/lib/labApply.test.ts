import { describe, expect, it } from "vitest";
import { diffApply, planApply, renderApplyMarkdown } from "./labApply";

const current = [
  { id: "F17", name: "Скальп", enabled: true, demoMirror: false },
  { id: "F11", name: "MACD", enabled: true, demoMirror: false },
  { id: "S05", name: "EMA трейлинг", enabled: false, demoMirror: false },
];

describe("planApply", () => {
  it("нормализует id и собирает план", () => {
    expect(
      planApply({ disable: ["f17", " s05 ", "F17"], "mirror-on": ["F11"] }),
    ).toEqual({
      disable: ["F17", "S05"],
      enable: [],
      mirrorOn: ["F11"],
      mirrorOff: [],
      dryRun: false,
      local: false,
      out: undefined,
    });
    expect(planApply({ enable: ["S05"], local: true }).local).toBe(true);
  });
  it("принимает id приватных экспериментов во всех флагах (bug 0040)", () => {
    expect(
      planApply({
        disable: ["ps99", "S01"],
        enable: [" PF15 "],
        "mirror-on": ["PC05", "F20"],
        "mirror-off": ["PS01"],
      }),
    ).toMatchObject({
      disable: ["PS99", "S01"],
      enable: ["PF15"],
      mirrorOn: ["PC05", "F20"],
      mirrorOff: ["PS01"],
    });
  });
  it("отклоняет пустой набор, чужие id и противоречия", () => {
    expect(() => planApply({})).toThrow(/нечего применять/);
    expect(() => planApply({ disable: ["X1"] })).toThrow(/не похоже на id/);
    for (const bad of ["PZ01", "", "P01", "SF01", "S1"])
      expect(() => planApply({ enable: [bad] })).toThrow(
        /не похоже на id.*S01.*PS01/,
      );
    expect(() => planApply({ disable: ["F17"], enable: ["F17"] })).toThrow(
      /противоречие/,
    );
  });
});

describe("diffApply", () => {
  it("только реальные изменения; уже в нужном состоянии — пропуск", () => {
    const plan = planApply({ disable: ["F17", "S05"], "mirror-on": ["F11"] });
    expect(diffApply(plan, current)).toEqual([
      { id: "F17", name: "Скальп", field: "enabled", from: true, to: false },
      { id: "F11", name: "MACD", field: "demoMirror", from: false, to: true },
    ]);
  });
  it("неизвестный id — ошибка до записи", () => {
    expect(() => diffApply(planApply({ disable: ["F99"] }), current)).toThrow(
      /F99 нет в БД/,
    );
  });
});

describe("renderApplyMarkdown", () => {
  it("таблица было → стало с целью подключения", () => {
    const md = renderApplyMarkdown(
      "2026-10-15T10:00:00.000Z",
      "Postgres db.example:6543/postgres",
      diffApply(planApply({ disable: ["F17"] }), current),
      true,
    );
    expect(md).toContain("(dry-run, не применено)");
    expect(md).toContain("БД: Postgres db.example:6543/postgres.");
    expect(md).toContain("| F17 | Скальп | эксперимент | включён | выключен |");
  });
  it("без изменений — так и пишет", () => {
    expect(renderApplyMarkdown("t", "x", [], false)).toContain("Изменений нет");
  });
});
