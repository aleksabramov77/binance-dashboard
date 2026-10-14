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
      out: undefined,
    });
  });
  it("отклоняет пустой набор, чужие id и противоречия", () => {
    expect(() => planApply({})).toThrow(/нечего применять/);
    expect(() => planApply({ disable: ["X1"] })).toThrow(/не похоже на id/);
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
  it("таблица было → стало", () => {
    const md = renderApplyMarkdown(
      "2026-10-15T10:00:00.000Z",
      diffApply(planApply({ disable: ["F17"] }), current),
      true,
    );
    expect(md).toContain("(dry-run, не применено)");
    expect(md).toContain("| F17 | Скальп | эксперимент | включён | выключен |");
  });
});
