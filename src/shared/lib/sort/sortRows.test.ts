import { describe, expect, it } from "vitest";
import { sortRows } from "./sortRows";

const rows = [
  { id: "b", n: 2 as number | null, s: "Бета" },
  { id: "a", n: null, s: "альфа" },
  { id: "c", n: 10, s: "S10" },
  { id: "d", n: 2, s: "S2" },
];

describe("sortRows", () => {
  it("сортирует числа по возрастанию и убыванию, пустые — в конце", () => {
    expect(sortRows(rows, (r) => r.n, "asc").map((r) => r.id)).toEqual([
      "b",
      "d",
      "c",
      "a",
    ]);
    expect(sortRows(rows, (r) => r.n, "desc").map((r) => r.id)).toEqual([
      "c",
      "b",
      "d",
      "a",
    ]);
  });

  it("строки — по-русски (кириллица раньше латиницы), без учёта регистра, числа по значению", () => {
    expect(sortRows(rows, (r) => r.s, "asc").map((r) => r.s)).toEqual([
      "альфа",
      "Бета",
      "S2",
      "S10",
    ]);
  });

  it("булевы значения: true больше false", () => {
    const flags = [{ on: true }, { on: false }];
    expect(sortRows(flags, (r) => r.on, "asc")).toEqual([
      { on: false },
      { on: true },
    ]);
  });

  it("не меняет исходный массив", () => {
    const copy = [...rows];
    sortRows(rows, (r) => r.n, "desc");
    expect(rows).toEqual(copy);
  });
});
