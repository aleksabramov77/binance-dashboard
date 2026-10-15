import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Имена таблиц заводят их слайсы, shared о них не знает — поэтому повторы ищем по исходникам src.
// Повтор имени — две таблицы с одной сортировкой в localStorage (spec 009).

const SRC = path.resolve(import.meta.dirname, "../../..");

const sources = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
  .map((file) => readFileSync(path.join(SRC, file), "utf8"));
// Вызов — с явным дженериком или без; объявление `function defineSortTable<K…>(` вызовом не считается.
const calls = sources.flatMap((text) => [
  ...text.matchAll(/(?<!function )\bdefineSortTable\s*(?:<[^>]*>)?\(/g),
]);
const names = sources.flatMap((text) =>
  [
    ...text.matchAll(
      /(?<!function )\bdefineSortTable\s*(?:<[^>]*>)?\(\s*"([^"]+)"/g,
    ),
  ].map((match) => match[1]),
);

describe("имена таблиц с сортировкой", () => {
  it("заданы строковым литералом — иначе повтор не найти", () => {
    expect(names.length).toBeGreaterThan(0);
    expect(names).toHaveLength(calls.length);
  });

  it("уникальны во всём приложении", () => {
    expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([]);
  });
});
