import { describe, expect, it } from "vitest";
import {
  type ApplyFlags,
  diffApply,
  planApply,
  renderApplyMarkdown,
} from "./labApply";

const flags = (
  id: string,
  name: string,
  enabled: boolean,
  extra: Partial<ApplyFlags> = {},
): ApplyFlags => ({
  id,
  name,
  enabled,
  demoMirror: false,
  parentId: null,
  disabledReason: null,
  disabledNote: null,
  ...extra,
});

const current = [
  flags("F17", "Скальп", true),
  flags("F11", "MACD", true),
  flags("S05", "EMA трейлинг", false),
];

// Контрольный F96 и его варианты F97 (usdm) и PS99 (spot) — фиктивные id (spec 0015).
const family = [
  flags("F96", "Контроль", true),
  flags("F97", "Вариант A", true, { parentId: "F96" }),
  flags("PS99", "Вариант B", true, { parentId: "F96" }),
];

describe("planApply", () => {
  it("нормализует id и собирает план", () => {
    expect(
      planApply({
        disable: ["f17", " s05 ", "F17"],
        reason: ["f17=loser", "S05=duplicate"],
        note: ["F17=минус за эпоху"],
        "mirror-on": ["F11"],
      }),
    ).toEqual({
      disable: ["F17", "S05"],
      enable: [],
      mirrorOn: ["F11"],
      mirrorOff: [],
      reasons: { F17: "loser", S05: "duplicate" },
      notes: { F17: "минус за эпоху" },
      forceControl: false,
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
        reason: ["PS99=costs", "S01=manual"],
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
    expect(() => planApply({ disable: ["X1"], reason: ["X1=loser"] })).toThrow(
      /не похоже на id/,
    );
    for (const bad of ["PZ01", "", "P01", "SF01", "S1"])
      expect(() => planApply({ enable: [bad] })).toThrow(
        /не похоже на id.*S01.*PS01/,
      );
    expect(() =>
      planApply({ disable: ["F17"], reason: ["F17=loser"], enable: ["F17"] }),
    ).toThrow(/противоречие/);
  });
  it("выключение без причины — ошибка до записи (spec 0046)", () => {
    expect(() =>
      planApply({ disable: ["F96", "F97"], reason: ["F97=loser"] }),
    ).toThrow(/выключение без причины: F96.*--reason.*loser/);
  });
  it("неизвестная категория — ошибка со списком категорий", () => {
    expect(() => planApply({ disable: ["F96"], reason: ["F96=bad"] })).toThrow(
      /категории «bad» нет; есть: loser \(убыточный\).*manual/,
    );
  });
  it("причина и текст — только выключаемому; текст до 200 символов; повтор id — ошибка", () => {
    expect(() => planApply({ enable: ["F96"], reason: ["F96=loser"] })).toThrow(
      /--reason F96: нет --disable F96/,
    );
    expect(() =>
      planApply({
        disable: ["F96"],
        reason: ["F96=loser"],
        note: ["F97=текст"],
      }),
    ).toThrow(/--note F97: нет --disable F97/);
    expect(() =>
      planApply({
        disable: ["F96"],
        reason: ["F96=loser"],
        note: [`F96=${"я".repeat(201)}`],
      }),
    ).toThrow(/длиннее 200/);
    expect(() =>
      planApply({ disable: ["F96"], reason: ["F96=loser", "F96=costs"] }),
    ).toThrow(/F96 указан дважды/);
    expect(() => planApply({ disable: ["F96"], reason: ["F96"] })).toThrow(
      /--reason F96=<значение>/,
    );
  });
});

describe("diffApply", () => {
  it("только реальные изменения; уже в нужном состоянии — пропуск", () => {
    const plan = planApply({
      disable: ["F17"],
      reason: ["F17=loser"],
      enable: ["F11"],
      "mirror-on": ["F11"],
    });
    expect(diffApply(plan, current)).toEqual([
      {
        id: "F17",
        name: "Скальп",
        field: "enabled",
        from: true,
        to: false,
        reason: { reason: "loser", note: null },
      },
      { id: "F11", name: "MACD", field: "demoMirror", from: false, to: true },
    ]);
  });
  it("неизвестный id — ошибка до записи", () => {
    expect(() =>
      diffApply(
        planApply({ disable: ["F99"], reason: ["F99=loser"] }),
        current,
      ),
    ).toThrow(/F99 нет в БД/);
  });
  it("уже выключенный + причина — смена причины; та же причина — без изменений", () => {
    const off = [
      flags("F96", "Контроль", false, {
        disabledReason: "loser",
        disabledNote: "старый текст",
      }),
    ];
    expect(
      diffApply(
        planApply({
          disable: ["F96"],
          reason: ["F96=costs"],
          note: ["F96=новый"],
        }),
        off,
      ),
    ).toEqual([
      {
        id: "F96",
        name: "Контроль",
        field: "reason",
        from: { reason: "loser", note: "старый текст" },
        to: { reason: "costs", note: "новый" },
      },
    ]);
    expect(
      diffApply(
        planApply({
          disable: ["F96"],
          reason: ["F96=loser"],
          note: ["F96=старый текст"],
        }),
        off,
      ),
    ).toEqual([]);
  });
  it("контрольный с включёнными вариантами — ошибка без --force-control", () => {
    expect(() =>
      diffApply(planApply({ disable: ["F96"], reason: ["F96=loser"] }), family),
    ).toThrow(/F96 — контрольный для F97, PS99.*--force-control/);
    // Варианты выключаются тем же действием — контрольный можно.
    expect(
      diffApply(
        planApply({
          disable: ["F96", "F97", "PS99"],
          reason: ["F96=loser", "F97=loser", "PS99=worse-than-control"],
        }),
        family,
      ),
    ).toHaveLength(3);
    expect(
      diffApply(
        planApply({
          disable: ["F96"],
          reason: ["F96=manual"],
          "force-control": true,
        }),
        family,
      ),
    ).toHaveLength(1);
  });
  it("вариант хуже контрольного выключается без флага", () => {
    expect(
      diffApply(
        planApply({ disable: ["F97"], reason: ["F97=worse-than-control"] }),
        family,
      ),
    ).toMatchObject([{ id: "F97", field: "enabled", to: false }]);
  });
});

describe("renderApplyMarkdown", () => {
  it("таблица было → стало с целью подключения и строкой причины", () => {
    const md = renderApplyMarkdown(
      "2026-10-15T10:00:00.000Z",
      "Postgres db.example:6543/postgres",
      diffApply(
        planApply({
          disable: ["F17"],
          reason: ["F17=loser"],
          note: ["F17=минус | за эпоху"],
        }),
        current,
      ),
      true,
    );
    expect(md).toContain("(dry-run, не применено)");
    expect(md).toContain("БД: Postgres db.example:6543/postgres.");
    expect(md).toContain("| F17 | Скальп | эксперимент | включён | выключен |");
    expect(md).toContain(
      "| F17 | Скальп | причина | — | убыточный: минус \\| за эпоху |",
    );
  });
  it("смена причины уже выключенного — строка «причина»", () => {
    const md = renderApplyMarkdown(
      "t",
      "x",
      diffApply(
        planApply({ disable: ["S05"], reason: ["S05=duplicate"] }),
        current,
      ),
      false,
    );
    expect(md).toContain("| S05 | EMA трейлинг | причина | — | дубль |");
  });
  it("без изменений — так и пишет", () => {
    expect(renderApplyMarkdown("t", "x", [], false)).toContain("Изменений нет");
  });
});
