import { describe, expect, it } from "vitest";
import { diffApply, planApply, renderApplyMarkdown } from "./labApply";

const current = [
  {
    id: "F17",
    name: "Скальп",
    enabled: true,
    demoMirror: false,
    demoMirrorMode: "auto" as const,
  },
  {
    id: "F11",
    name: "MACD",
    enabled: true,
    demoMirror: false,
    demoMirrorMode: "auto" as const,
  },
  {
    id: "S05",
    name: "EMA трейлинг",
    enabled: false,
    demoMirror: true,
    demoMirrorMode: "on" as const,
  },
  {
    id: "PC99",
    name: "COIN-M",
    enabled: true,
    demoMirror: false,
    demoMirrorMode: "auto" as const,
  },
].map((e) => ({
  ...e,
  market: e.id === "PC99" ? ("coinm" as const) : ("usdm" as const),
}));

describe("planApply", () => {
  it("нормализует id и собирает план", () => {
    expect(
      planApply({ disable: ["f17", " s05 ", "F17"], "mirror-on": ["F11"] }),
    ).toEqual({
      disable: ["F17", "S05"],
      enable: [],
      mirrorOn: ["F11"],
      mirrorOff: [],
      mirrorAuto: [],
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
        enable: [" PF99 "],
        "mirror-on": ["PC99", "F20"],
        "mirror-off": ["PF100"],
      }),
    ).toMatchObject({
      disable: ["PS99", "S01"],
      enable: ["PF99"],
      mirrorOn: ["PC99", "F20"],
      mirrorOff: ["PF100"],
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
    expect(() =>
      planApply({ "mirror-auto": ["F17"], "mirror-off": ["f17"] }),
    ).toThrow(/два положения демо-зеркала/);
  });
});

describe("diffApply", () => {
  it("только реальные изменения; уже в нужном состоянии — пропуск", () => {
    const plan = planApply({ disable: ["F17", "S05"], "mirror-on": ["F11"] });
    expect(diffApply(plan, current)).toEqual([
      { id: "F17", name: "Скальп", field: "enabled", from: true, to: false },
      {
        id: "F11",
        name: "MACD",
        field: "demoMirrorMode",
        from: "auto",
        to: "on",
        demoMirror: false,
      },
    ]);
  });
  it("положение зеркала (spec 0043): ручное «Выкл», «Авто»; то же положение — пропуск", () => {
    const plan = planApply({
      "mirror-off": ["F17"],
      "mirror-auto": ["S05", "F11"],
    });
    expect(diffApply(plan, current)).toEqual([
      {
        id: "F17",
        name: "Скальп",
        field: "demoMirrorMode",
        from: "auto",
        to: "off",
        demoMirror: false,
      },
      {
        id: "S05",
        name: "EMA трейлинг",
        field: "demoMirrorMode",
        from: "on",
        to: "auto",
        demoMirror: true,
      },
    ]);
  });
  it("«Вкл» и «Авто» для COIN-M — ошибка с причиной из UI; «Выкл» можно", () => {
    for (const flag of ["mirror-on", "mirror-auto"] as const)
      expect(() => diffApply(planApply({ [flag]: ["PC99"] }), current)).toThrow(
        /PC99: Демо-зеркало COIN-M — позже/,
      );
    expect(
      diffApply(planApply({ "mirror-off": ["PC99"] }), current),
    ).toMatchObject([{ id: "PC99", to: "off" }]);
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
  it("положение зеркала и решение автомата после перевода в «Авто»", () => {
    const md = renderApplyMarkdown(
      "t",
      "x",
      diffApply(
        planApply({ "mirror-off": ["F17"], "mirror-auto": ["S05"] }),
        current,
      ),
      false,
      ["S05 → демо-зеркало выключено: эксперимент выключен"],
    );
    expect(md).toContain(
      "| F17 | Скальп | демо-зеркало | Авто · выкл | Выкл (вручную) |",
    );
    expect(md).toContain(
      "| S05 | EMA трейлинг | демо-зеркало | Вкл (вручную) | Авто (решит автомат) |",
    );
    expect(md).toContain(
      "- S05 → демо-зеркало выключено: эксперимент выключен",
    );
  });
  it("без изменений — так и пишет", () => {
    expect(renderApplyMarkdown("t", "x", [], false)).toContain("Изменений нет");
  });
});
